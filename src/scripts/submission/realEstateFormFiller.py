import asyncio
import json
import sys
import traceback

import httpx

from scripts.core.browser import spawn_new_browser
from scripts.core.company_context import (
    build_report_create_url,
    get_selected_company,
    require_selected_company,
    set_selected_company,
)
from scripts.core.httpClient import http_get, http_patch
from scripts.core.processControl import (
    check_and_wait,
    clear_process,
    create_process,
    emit_progress,
    get_process_manager,
    update_progress,
)
from scripts.core.utils import log, wait_for_element

from .ElRajhiFiller import (
    finalize_report_submission,
    navigate_page_resilient,
    open_workflow_page,
)
from .formFiller import fill_form, scrape_region_city_table
from .realEstateSteps import extract_record_values, form_steps


async def fetch_record_by_id(record_id):
    """Fetch a single realEstate record by its _id."""
    data = await http_get(f"transactions/{record_id}")
    print(data, file=sys.stderr, flush=True)
    return data.get("item")


async def fetch_records_by_ids(record_ids):
    """Fetch multiple realEstate records by their _ids."""
    data = await http_get(
        "transactions/bulk",
        json={"ids": [str(r) for r in record_ids]},
    )
    return data.get("items") or data.get("records") or data.get("data") or []


async def create_and_submit_report(
    page, record, create_url, pdf_path=None, approach_selections=None
):
    """
    Fill the three form steps for a single record.
    Returns a result dict with status SUCCESS or FAILED.
    """
    record_id = str(record["id"])
    print(
        "DEBUG record from API:",
        record.get("clientName"),
        record.get("contactNo"),
        record.get("email_address"),
        file=sys.stderr,
        flush=True,
    )
    try:
        nav = await navigate_page_resilient(
            page, create_url, label="report creation page", timeout=40, settle_seconds=1
        )
        if nav.get("status") != "SUCCESS":
            return {
                "status": "FAILED",
                "step": "navigate_create",
                "error": nav.get("error") or "Failed to open create report page",
                "record_id": record_id,
            }

        client_field_selector = form_steps[0]["field_map"].get("clientName")
        if client_field_selector:
            await wait_for_element(page, client_field_selector)

        for step_num, step_config in enumerate(form_steps, 1):
            is_last = step_num == len(form_steps)
            valuers = record.get("valuers")
            is_valuers_step = bool(valuers) and step_config.get(
                "is_valuers_step", False
            )

            record_values = extract_record_values(
                record, approach_selections=approach_selections
            )
            if pdf_path:
                record_values["report_asset_file"] = pdf_path

            result = await fill_form(
                page,
                record_values,
                step_config["field_map"],
                step_config["field_types"],
                is_last,
                is_valuers=is_valuers_step,
            )

            if isinstance(result, dict) and result.get("status") == "FAILED":
                return {
                    "status": "FAILED",
                    "step": step_num,
                    "error": result.get("error"),
                    "record_id": record_id,
                }

            if is_last:
                # Derive the report_id from the final URL
                current_url = await page.evaluate("window.location.href")
                report_id = current_url.rstrip("/").split("/")[-1]

                if not report_id:
                    return {
                        "status": "FAILED",
                        "step": "report_id",
                        "error": "Could not determine report_id from URL",
                        "record_id": record_id,
                    }

                # Persist report_id back to the record
                await http_patch(
                    f"transactions/{record['_id']}/set-report-id",
                    json={"report_id": report_id},
                )

                return {
                    "status": "SUCCESS",
                    "report_id": report_id,
                    "record_id": record_id,
                }

    except Exception as e:
        return {
            "status": "FAILED",
            "error": str(e),
            "traceback": traceback.format_exc(),
            "record_id": record_id,
        }


# ── Main entry points ─────────────────────────────────────────────────────────


async def run_real_estate_form_fill(
    browser,
    record_id,
    finalize_submission=False,
    pdf_path=None,
    approach_selections=None,
):
    """
    Submit a single realEstate record.
    Called from commandHandler with action='real-estate-form-fill'.
    """
    try:
        record = await fetch_record_by_id(record_id)
        if not record:
            return {"status": "FAILED", "error": f"Record not found: {record_id}"}
        return await _run_filler(
            browser=browser,
            records=[record],
            process_id=f"real-estate-filler-{record_id}",
            finalize_submission=finalize_submission,
            pdf_path=pdf_path,
            approach_selections=approach_selections,
        )
    except Exception as e:
        return {
            "status": "FAILED",
            "error": str(e),
            "traceback": traceback.format_exc(),
        }


async def run_real_estate_form_fill_bulk(
    browser, record_ids, finalize_submission=False, approach_selections=None
):
    """
    Submit multiple realEstate records.
    Called from commandHandler with action='real-estate-form-fill-bulk'.
    """
    try:
        records = await fetch_records_by_ids(record_ids)
        if not records:
            return {
                "status": "FAILED",
                "error": "No records found for the provided IDs",
            }

        process_id = (
            f"real-estate-filler-bulk-"
            f"{hash(tuple(sorted([str(r) for r in record_ids])))}"
        )
        return await _run_filler(
            browser=browser,
            records=records,
            process_id=process_id,
            finalize_submission=finalize_submission,
            approach_selections=approach_selections,
        )
    except Exception as e:
        return {
            "status": "FAILED",
            "error": str(e),
            "traceback": traceback.format_exc(),
        }


async def _run_filler(
    browser,
    records,
    process_id,
    finalize_submission=True,
    pdf_path=None,
    approach_selections=None,
):
    """
    Core logic: fill all three form steps sequentially, then finalize each report.
    No macro phase — realEstate reports are self-contained.
    Always spawns a new browser.
    """
    new_browser = None
    try:
        try:
            require_selected_company()

            # udpate this later
            create_url = "https://qima.taqeem.gov.sa/report/create/1/137"
        except Exception as ctx_err:
            return {"status": "FAILED", "error": str(ctx_err)}

        total_records = len(records)

        create_process(
            process_id=process_id,
            process_type="real-estate-filler",
            total=total_records,
            finalize_submission=finalize_submission,
        )

        # Always spawn a fresh browser for realEstate
        new_browser = await spawn_new_browser(browser, headless=False)
        main_page = new_browser.main_tab

        if main_page is None:
            return {"status": "FAILED", "error": "No browser tab available."}

        # Optionally land on the company page first (scopes the session correctly)
        try:
            company_ctx = get_selected_company()
            org_url = (company_ctx.get("url") or "").strip()
            if org_url:
                emit_progress(process_id, message="Opening company page...")
                await navigate_page_resilient(
                    main_page,
                    org_url,
                    label="company page",
                    timeout=35,
                    settle_seconds=2,
                )
                emit_progress(
                    process_id, message="Company page ready. Starting submissions..."
                )
        except Exception as nav_err:
            log(
                f"RealEstateFiller: optional company page nav failed: {nav_err}", "WARN"
            )

        completed = 0
        failed = 0
        results = []

        emit_progress(process_id, message="Starting report submissions...")

        for idx, record in enumerate(records):
            action = await check_and_wait(process_id)
            if action == "stop":
                clear_process(process_id)
                return {
                    "status": "STOPPED",
                    "message": "Stopped by user",
                    "completed": completed,
                    "failed": failed,
                    "total": total_records,
                }

            await update_progress(process_id, completed=completed, failed=failed)
            emit_progress(
                process_id,
                current_item=str(record["id"]),
                message=f"Submitting report {idx + 1}/{total_records}",
            )

            result = await create_and_submit_report(
                main_page,
                record,
                create_url,
                pdf_path=pdf_path,
                approach_selections=approach_selections,
            )
            results.append(result)

            if result.get("status") == "SUCCESS":
                completed += 1
            else:
                failed += 1
                log(
                    f"RealEstateFiller: failed for {record['id']}: {result.get('error')}",
                    "ERROR",
                )

            await update_progress(process_id, completed=completed, failed=failed)
            emit_progress(
                process_id,
                current_item=str(record["id"]),
                message=f"Submitted {completed}/{total_records} reports",
            )

        clear_process(process_id)

        return {
            "status": "SUCCESS",
            "reports_submitted": completed,
            "reports_failed": failed,
            "total_records": total_records,
            "results": results,
        }

    except Exception as e:
        if "process_id" in locals():
            clear_process(process_id)
        return {
            "status": "FAILED",
            "error": str(e),
            "traceback": traceback.format_exc(),
        }

    finally:
        if new_browser:
            new_browser.stop()


def save_region_city_excel(rows, path="region_city_codes.xlsx"):
    """Writes (region_name, region_id, city_name, city_id) rows to an xlsx file."""
    from openpyxl import Workbook  # pip install openpyxl --break-system-packages

    wb = Workbook()
    ws = wb.active
    ws.title = "RegionsCities"
    ws.append(["region_name", "region_id", "city_name", "city_id"])
    for region_name, region_id, city_name, city_id in rows:
        ws.append([region_name, region_id, city_name, city_id])
    wb.save(path)
    print(f"[INFO] Saved {len(rows)} rows to {path}", file=sys.stderr)


async def debug_scrape_region_city_codes(
    browser, record_id, pdf_path, output_path="region_city_codes.xlsx"
):
    """
    TEMPORARY DEBUG ENTRY POINT — remove once the lookup table is generated.
    Fills step 1 only for `record_id` (including the required PDF upload),
    lets it advance to step 2, scrapes every region/city pair, and writes
    them to an Excel file.
    """
    new_browser = None
    try:
        require_selected_company()
        create_url = "https://qima.taqeem.gov.sa/report/create/1/137"

        record = await fetch_record_by_id(record_id)
        if not record:
            return {"status": "FAILED", "error": f"Record not found: {record_id}"}

        new_browser = await spawn_new_browser(browser, headless=False)
        main_page = new_browser.main_tab
        if main_page is None:
            return {"status": "FAILED", "error": "No browser tab available."}

        nav = await navigate_page_resilient(
            main_page,
            create_url,
            label="report creation page",
            timeout=40,
            settle_seconds=1,
        )
        if nav.get("status") != "SUCCESS":
            return {"status": "FAILED", "error": nav.get("error")}

        client_field_selector = form_steps[0]["field_map"].get("clientName")
        if client_field_selector:
            await wait_for_element(main_page, client_field_selector)

        record_values = extract_record_values(record)
        if pdf_path:
            record_values["report_asset_file"] = (
                pdf_path  # required for step 1 to submit
            )

        step1 = form_steps[0]
        valuers = record.get("valuers")
        is_valuers_step = bool(valuers) and step1.get("is_valuers_step", False)

        # Fill step 1 only — this uploads the PDF, clicks "continue", lands on step 2
        result = await fill_form(
            main_page,
            record_values,
            step1["field_map"],
            step1["field_types"],
            is_last_step=False,
            is_valuers=is_valuers_step,
        )
        if isinstance(result, dict) and result.get("status") == "FAILED":
            return {
                "status": "FAILED",
                "step": 1,
                "error": result.get("error"),
                "record_id": record_id,
            }

        # Now on step 2 — scrape the region/city table
        rows = await scrape_region_city_table(main_page)
        save_region_city_excel(rows, path=output_path)

        return {"status": "SUCCESS", "rows_scraped": len(rows)}

    except Exception as e:
        return {
            "status": "FAILED",
            "error": str(e),
            "traceback": traceback.format_exc(),
        }
    finally:
        if new_browser:
            new_browser.stop()


# ── Pause / Resume / Stop ─────────────────────────────────────────────────────


async def pause_real_estate_filler(record_id):
    try:
        pm = get_process_manager()
        for prefix in ["real-estate-filler-", "real-estate-filler-bulk-"]:
            state = pm.pause_process(f"{prefix}{record_id}")
            if state:
                return {"status": "SUCCESS", "message": f"Paused {prefix}{record_id}"}
        return {"status": "FAILED", "error": f"No active process for {record_id}"}
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def resume_real_estate_filler(record_id):
    try:
        pm = get_process_manager()
        for prefix in ["real-estate-filler-", "real-estate-filler-bulk-"]:
            state = pm.resume_process(f"{prefix}{record_id}")
            if state:
                return {"status": "SUCCESS", "message": f"Resumed {prefix}{record_id}"}
        return {"status": "FAILED", "error": f"No active process for {record_id}"}
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def stop_real_estate_filler(record_id):
    try:
        pm = get_process_manager()
        for prefix in ["real-estate-filler-", "real-estate-filler-bulk-"]:
            state = pm.stop_process(f"{prefix}{record_id}")
            if state:
                return {"status": "SUCCESS", "message": f"Stopped {prefix}{record_id}"}
        return {"status": "FAILED", "error": f"No active process for {record_id}"}
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}
