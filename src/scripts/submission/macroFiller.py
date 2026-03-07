import asyncio
import sys
import traceback

from scripts.core.browser import spawn_new_browser
from scripts.core.httpClient import (
    find_report_by_id,
    http_get,
    http_patch,
    recompute_report_status,
    update_macro_submit_state,
    update_report_status_by_id,
)
from scripts.core.processControl import (
    check_and_wait,
    clear_process,
    create_process,
    emit_progress,
    get_process_manager,
    update_progress,
)
from scripts.core.utils import wait_for_element
from scripts.submission.checkMacroStatus import RunCheckMacroStatus
from scripts.submission.validateReport import validate_for_retry

from .formFiller import fill_form
from .formSteps import macro_form_config


def balanced_chunks(lst, n):
    """Split list into n balanced chunks"""
    k, m = divmod(len(lst), n)
    chunks = []
    start = 0
    for i in range(n):
        size = k + (1 if i < m else 0)
        chunks.append(lst[start : start + size])
        start += size
    return chunks


def is_asset_complete(asset):
    val = asset.get("submitState")
    return val == 1 or val == "1" or val is True


async def wait_for_process_state(process_manager, process_id, retries=6, delay=0.2):
    """Wait briefly for process creation to avoid command race conditions."""
    state = process_manager.get_process(process_id)
    if state:
        return state

    for _ in range(retries):
        await asyncio.sleep(delay)
        state = process_manager.get_process(process_id)
        if state:
            return state

    return None


async def update_report_completion_status(record_id):
    """
    Update report completion status based on asset submitState values using API

    Args:
        record_id: The MongoDB _id of the report
    """
    try:
        # Fetch the report via API
        report, collection_name, _ = await find_report_by_id(record_id)
        if not report:
            print(
                f"[API] ERROR: Report with _id {record_id} not found",
                file=sys.stderr,
            )
            return None

        assets = report.get("asset_data", [])
        any_incomplete = (
            any(not is_asset_complete(asset) for asset in assets) if assets else False
        )

        if any_incomplete:
            new_status = "incomplete"
        else:
            current_status = (report.get("report_status") or "").lower()
            if current_status in ["sent", "approved"]:
                new_status = report.get("report_status")
            else:
                new_status = "complete"

        # Update status via API
        success = await update_report_status_by_id(record_id, new_status)

        if success:
            print(
                f"[API] Updated report {record_id} status to {new_status}",
                file=sys.stderr,
            )
            return new_status
        else:
            print(
                f"[API] Failed to update report {record_id} status",
                file=sys.stderr,
            )
            return None

    except Exception as e:
        print(f"[API ERROR] update_report_completion_status: {e}", file=sys.stderr)
        return None


async def fill_macro_form(page, macro_id, macro_data, field_map, field_types):
    await page.get(f"https://qima.taqeem.gov.sa/report/macro/{macro_id}/edit")
    await wait_for_element(page, "#asset_usage_id", timeout=30)
    # Reduced delay - element is already loaded by wait_for_element
    await asyncio.sleep(0.1)

    try:
        result = await fill_form(
            page,
            macro_data,
            field_map,
            field_types,
            is_last_step=True,
        )
        return result
    except Exception as e:
        print(f"Filling macro {macro_id} failed: {e}", file=sys.stderr)
        return {"status": "FAILED", "error": str(e)}


async def handle_macro_edits(
    browser,
    record,
    tabs_num=3,
    record_id=None,
    progress_callback=None,
    collection=None,
    initialize_process=True,
    clear_process_on_exit=True,
    emit_internal_progress=True,
):
    asset_data = record.get("asset_data", [])
    if not asset_data:
        return {"status": "SUCCESS", "message": "No assets to edit"}

    total_assets = len(asset_data)

    # Verify all assets have IDs
    missing_ids = [i for i, asset in enumerate(asset_data) if not asset.get("id")]
    if missing_ids:
        error_msg = f"Missing macro IDs for assets at indices: {missing_ids}"
        return {"status": "FAILED", "error": error_msg}

    print(
        f"Asset data with IDs: {[(i, asset.get('id')) for i, asset in enumerate(asset_data)]}"
    )

    # Create process state using modular system
    process_manager = get_process_manager()
    existing_state = process_manager.get_process(record_id)
    if initialize_process or existing_state is None:
        create_process(
            process_id=record_id,
            process_type="macro-edit",
            total=total_assets,
            report_id=record_id,
            tabs_num=tabs_num,
        )
    elif not existing_state.total:
        existing_state.total = total_assets

    # Create pages for parallel processing
    main_page = browser.tabs[0]
    effective_tabs = min(tabs_num, total_assets)
    pages = [main_page] + [
        await browser.get("", new_tab=True) for _ in range(effective_tabs - 1)
    ]

    # Split assets into balanced chunks
    asset_chunks = balanced_chunks(asset_data, tabs_num)

    completed = 0
    failed = 0

    # Get record_id for API calls
    mongo_record_id = record.get("_id")

    async def process_chunk(asset_chunk, page, chunk_index):
        nonlocal completed, failed
        print(f"Processing chunk {chunk_index} with {len(asset_chunk)} assets")

        for asset_index, asset in enumerate(asset_chunk):
            # Check pause/stop state before processing each asset
            action = await check_and_wait(record_id)
            if action == "stop":
                print(f"Chunk {chunk_index} stopped by user request")
                return {"status": "STOPPED"}

            macro_id = asset.get("id")

            if macro_id is None:
                print(
                    f"ERROR: macro_id is None for asset index {asset_index} in chunk {chunk_index}"
                )
                lock = process_manager.get_lock(record_id)
                if lock:
                    async with lock:
                        failed += 1
                if emit_internal_progress:
                    await update_progress(
                        record_id, completed=completed, failed=failed
                    )
                continue

            try:
                print(
                    f"Editing macro {macro_id} (chunk {chunk_index}, asset {asset_index})"
                )

                # Get current progress for emission
                lock = process_manager.get_lock(record_id)
                if lock:
                    async with lock:
                        current_completed = completed
                        current_failed = failed
                else:
                    current_completed = completed
                    current_failed = failed

                # Process the macro form (progress emitted after completion)
                result = await fill_macro_form(
                    page,
                    macro_id,
                    asset,
                    macro_form_config["field_map"],
                    macro_form_config["field_types"],
                )

                # Update submitState via API if save was successful
                if result.get("status") == "SAVED" and mongo_record_id:
                    try:
                        # Update macro submit state via API
                        update_success = await update_macro_submit_state(
                            mongo_record_id, macro_id, 1
                        )

                        if update_success:
                            print(
                                f"[API] Successfully updated submitState for macro {macro_id}",
                                file=sys.stderr,
                            )
                        else:
                            print(
                                f"[API] Failed to update submitState for macro {macro_id}",
                                file=sys.stderr,
                            )
                    except Exception as e:
                        print(
                            f"[API ERROR] updating submitState for macro {macro_id}: {e}",
                            file=sys.stderr,
                        )

                # Update counters (batch progress update)
                lock = process_manager.get_lock(record_id)
                if lock:
                    async with lock:
                        if result.get("status") == "FAILED":
                            failed += 1
                        completed += 1
                        current_completed = completed
                        current_failed = failed
                else:
                    if result.get("status") == "FAILED":
                        failed += 1
                    completed += 1
                    current_completed = completed
                    current_failed = failed

                # Batch progress update (emit once per asset instead of multiple times)
                if emit_internal_progress:
                    await update_progress(
                        record_id,
                        completed=current_completed,
                        failed=current_failed,
                        emit=True,
                    )

                    # Emit progress message after completion
                    emit_progress(
                        record_id,
                        current_item=str(macro_id),
                        message=f"Completed macro {macro_id} ({current_completed}/{total_assets})",
                    )

                # Call custom progress callback if provided
                if progress_callback:
                    try:
                        progress_callback(current_completed, total_assets)
                    except Exception as e:
                        print(f"Error in progress callback: {e}", file=sys.stderr)

            except Exception as e:
                lock = process_manager.get_lock(record_id)
                if lock:
                    async with lock:
                        failed += 1
                        current_completed = completed
                        current_failed = failed
                else:
                    failed += 1
                    current_completed = completed
                    current_failed = failed

                # Emit error progress
                if emit_internal_progress:
                    await update_progress(
                        record_id, completed=current_completed, failed=current_failed
                    )
                    emit_progress(
                        record_id,
                        current_item=str(macro_id),
                        message=f"Error processing macro {macro_id}: {str(e)}",
                    )

        return {"status": "SUCCESS"}

    # Create tasks for parallel processing
    tasks = []
    for i, (page, asset_chunk) in enumerate(zip(pages, asset_chunks)):
        if asset_chunk:
            tasks.append(process_chunk(asset_chunk, page, i))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Close extra tabs
    for page in pages[1:]:
        await page.close()

    # Clear process state after completion unless caller is managing lifecycle.
    if clear_process_on_exit:
        clear_process(record_id)

    # Check if any chunk was stopped
    was_stopped = any(
        isinstance(r, dict) and r.get("status") == "STOPPED" for r in results
    )

    if was_stopped:
        return {
            "status": "STOPPED",
            "message": f"Process stopped. Completed {completed}/{total_assets} macros",
            "completed": completed,
            "failed": failed,
            "total": total_assets,
        }

    # Update report completion status via API
    if mongo_record_id:
        await update_report_completion_status(mongo_record_id)

    return {
        "status": "SUCCESS",
        "message": f"Completed editing {completed} macros",
        "completed": completed,
        "failed": failed,
        "total": total_assets,
    }


async def run_macro_edit(browser, report_id, tabs_num=3, collection=None):
    try:
        record_data = await http_get(f"/new-scripts/report-id/{report_id}")
        record = record_data.get("data", [])
        if not record:
            return {"status": "FAILED", "error": "Record not found"}

        asset_data = record.get("asset_data", [])
        if not asset_data:
            return {"status": "SUCCESS", "message": "No assets to edit"}

        # Verify assets have macro IDs
        assets_without_ids = [
            i for i, asset in enumerate(asset_data) if not asset.get("id")
        ]
        if assets_without_ids:
            error_msg = f"Assets missing macro IDs at indices: {assets_without_ids}"
            return {"status": "FAILED", "error": error_msg}

        await http_patch(
            f"new-scripts/update-report-timestamp/{record['_id']}",
            json={"type": "editStartTime"},
        )

        # Send initial progress
        emit_progress(report_id, message="Starting macro fill process...")

        # Process macro edits
        edit_result = await handle_macro_edits(
            browser, record, tabs_num=tabs_num, record_id=report_id
        )

        # Update end time
        await http_patch(
            f"new-scripts/update-report-timestamp/{record['_id']}",
            json={"type": "editEndTime"},
        )

        if edit_result.get("status") == "FAILED":
            return edit_result

        return {"status": "SUCCESS", "recordId": str(report_id), "result": edit_result}

    except Exception as e:
        # Clear process state on error
        clear_process(report_id)
        tb = traceback.format_exc()
        return {"status": "FAILED", "error": str(e), "traceback": tb}


async def run_macro_edit_retry(browser, report_id, tabs_num=3, collection=None):
    new_browser = None
    try:
        record_data = await http_get(f"/new-scripts/report-id/{report_id}")
        record = record_data.get("data", [])
        if not record:
            return {"status": "FAILED", "error": "Record not found"}

        asset_data = record.get("asset_data", [])
        if not asset_data:
            return {"status": "SUCCESS", "message": "No assets found"}

        # Verify Report
        new_browser = await spawn_new_browser(browser)

        validation_result = await validate_for_retry(new_browser, report_id, asset_data)

        if validation_result["status"] == "RE-GRABBED":
            record_data = await http_get(f"/new-scripts/report-id/{report_id}")
            record = record_data.get("data", [])
            asset_data = record.get("asset_data", [])

        elif validation_result["status"] == "FAILED":
            return {"status": "FAILED", "message": "Validation failed"}

        # Filter retryable assets (submit_state == 0)
        retry_assets = [
            asset for asset in asset_data if asset.get("submitState", 0) == 0
        ]

        if not retry_assets:
            return {
                "status": "SUCCESS",
                "message": "No retryable assets found (all macros already submitted)",
            }

        # Update retry start time
        await http_patch(
            f"new-scripts/update-report-timestamp/{record['_id']}",
            json={"type": "retryEditStartTime"},
        )

        emit_progress(
            report_id, message=f"Starting retry for {len(retry_assets)} macros..."
        )

        # Create a shallow copy of record with filtered assets
        retry_record = {**record, "asset_data": retry_assets}

        result = await handle_macro_edits(
            new_browser, retry_record, tabs_num=tabs_num, record_id=report_id
        )

        await http_patch(
            f"new-scripts/update-report-timestamp/{record['_id']}",
            json={"type": "retryEditEndTime"},
        )

        await RunCheckMacroStatus(
            browser=new_browser, report_id=report_id, tabs_num=tabs_num, same=True
        )

        return result

    except Exception as e:
        clear_process(report_id)
        return {
            "status": "FAILED",
            "error": str(e),
            "traceback": traceback.format_exc(),
        }

    finally:
        if new_browser:
            new_browser.stop()


async def pause_macro_edit(report_id):
    """Pause macro editing for a report"""
    try:
        process_manager = get_process_manager()
        state = await wait_for_process_state(process_manager, report_id)

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active process found for report {report_id}",
            }

        if state.paused:
            return {
                "status": "SUCCESS",
                "message": f"Report {report_id} is already paused",
                "paused": True,
            }

        if state.stopped:
            return {
                "status": "FAILED",
                "error": f"Process for report {report_id} is already stopped",
            }

        state = process_manager.pause_process(report_id)

        # Emit progress update immediately to notify UI
        emit_progress(report_id, message=f"Paused macro editing for report {report_id}")

        return {
            "status": "SUCCESS",
            "message": f"Paused macro editing for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def resume_macro_edit(report_id):
    """Resume macro editing for a report"""
    try:
        process_manager = get_process_manager()
        state = await wait_for_process_state(process_manager, report_id)

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active process found for report {report_id}",
            }

        if state.stopped:
            return {
                "status": "FAILED",
                "error": f"Cannot resume report {report_id} because it has been stopped",
            }

        if not state.paused:
            return {
                "status": "SUCCESS",
                "message": f"Report {report_id} is already running",
                "paused": False,
            }

        state = process_manager.resume_process(report_id)

        # Emit progress update immediately to notify UI
        emit_progress(
            report_id, message=f"Resumed macro editing for report {report_id}"
        )

        return {
            "status": "SUCCESS",
            "message": f"Resumed macro editing for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def stop_macro_edit(report_id):
    """Stop macro editing for a report"""
    try:
        process_manager = get_process_manager()
        state = await wait_for_process_state(process_manager, report_id)

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active process found for report {report_id}",
            }

        if state.stopped:
            return {
                "status": "SUCCESS",
                "message": f"Report {report_id} is already stopped",
                "stopped": True,
            }

        state = process_manager.stop_process(report_id)

        return {
            "status": "SUCCESS",
            "message": f"Stopped macro editing for report {report_id}",
            "stopped": state.stopped,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}
