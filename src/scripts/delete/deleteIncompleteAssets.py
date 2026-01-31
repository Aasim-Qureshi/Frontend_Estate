import asyncio, re, json
from datetime import datetime
from scripts.core.utils import log
from scripts.core.company_context import build_report_url, require_selected_company
from scripts.core.browser import new_tab
from scripts.submission.validateReport import (
    extract_report_info_from_html,
    wait_for_report_info_html,
    calculate_total_assets
)
from motor.motor_asyncio import AsyncIOMotorClient
from scripts.core.processControl import (
    get_process_manager,
    check_and_wait,
    create_process,
    clear_process,
    update_progress,
    emit_progress
)

TABLE_CSS = "#m-table"
ROW_CSS   = "#m-table tbody tr"

TBODY_XPATH_FALLBACK = "/html/body/div/div[5]/div[2]/div/div[8]/div/div/div/div[2]/div[2]/table/tbody"

INCOMPLETE_AR = "غير مكتملة"
macro_link_re = re.compile(r"/report/macro/(\d+)/(?:show|edit|delete)")

# DataTables subpage pagination
DATATABLE_NEXT_SEL = (
    'a.paginate_button.next#m-table_next, '
    'a.paginate_button.next[aria-controls="m-table"], '
    '#m-table_next, '
    'a.paginate_button.next'
)
DATATABLE_PREV_SEL = (
    'a.paginate_button.previous#m-table_previous, '
    'a.paginate_button.previous[aria-controls="m-table"], '
    '#m-table_previous, '
    'a.paginate_button.previous'
)

# Main (outer) pagination
MAIN_NEXT_SEL = 'a.page-link[rel="next"]'

DRAFT_STATUS_AR = "مسودة"
DRAFT_STATUS_EN = "draft"

MONGO_URI = "mongodb+srv://Aasim:userAasim123@electron.cwbi8id.mongodb.net"
_mongo_client = AsyncIOMotorClient(MONGO_URI)
_mongo_db = _mongo_client["test"]
_delete_status_coll = _mongo_db["report_deletions"]
_check_report_coll = _mongo_db["report_deletions"]

async def _record_delete_status(
    report_id: str,
    total_assets: int | None,
    remaining_assets: int | None,
    delete_type: str,
    deleted: bool,
    user_id: str | None = None,
    company_office_id: str | None = None
):
    if not report_id:
        return
    now = datetime.utcnow()
    payload = {
        "report_id": str(report_id),
        "user_id": str(user_id) if user_id else None,
        "company_office_id": str(company_office_id) if company_office_id else None,
        "total_assets": total_assets,
        "remaining_assets": remaining_assets,
        "deleted": bool(deleted),
        "delete_type": delete_type,
        "updated_at": now
    }
    if deleted:
        payload["deleted_at"] = now
    try:
        query = {"report_id": str(report_id), "delete_type": delete_type}
        if user_id:
            query["user_id"] = str(user_id)
        if company_office_id:
            query["company_office_id"] = str(company_office_id)
        await _delete_status_coll.update_one(
            query,
            {"$set": payload},
            upsert=True
        )
        # Note: We no longer delete records from report_deletions after deletion
        # All actions (Delete Report, Delete Assets, Check Report) are stored in report_deletions
    except Exception as e:
        log(f"[db] failed to update delete status: {e}", "WARN")

async def _ensure_confirm_ok(page):
    js = r"""
    (() => {
      function hardPatch(win){
        try{
          const yes  = () => true;
          const noop = () => {};
          try{ win.confirm = yes; }catch(_){}
          try{ win.alert   = noop; }catch(_){}
          try{ win.prompt  = () => ""; }catch(_){}
          try{ Object.defineProperty(win,'confirm',{value:yes,configurable:true}); }catch(_){}
          try{ Object.defineProperty(win,'alert',  {value:noop,configurable:true}); }catch(_){}
          try{ Object.defineProperty(win,'prompt', {value:()=>"",configurable:true}); }catch(_){}
          try{ win.onbeforeunload = null; }catch(_){}
          try{
            Object.defineProperty(win,'onbeforeunload',{
              configurable:true,
              get(){ return null; },
              set(_v){}
            });
          }catch(_){}
        }catch(_){}
      }
      hardPatch(window);
      return 1;
    })()
    """
    try:
        await page.evaluate(js)
    except Exception:
        pass


async def _try_click_inline_confirm(page):
    try:
        await page.evaluate("""
        () => {
          const labels = ["OK","Ok","Confirm","CONFIRM","Yes","Delete","حذف","تأكيد"];
          const els = Array.from(document.querySelectorAll('button, [type=button], [type=submit], a'));
          for (const el of els) {
            const t = (el.innerText || el.value || "").trim();
            if (!t) continue;
            for (const key of labels) {
              if (t.includes(key)) { el.click(); return true; }
            }
          }
          return false;
        }
        """)
    except Exception:
        pass

async def _debug_table_snapshot(page):
    table = await page.find(TABLE_CSS)
    log(f"[debug] table {TABLE_CSS} present: {bool(table)}", "INFO")
    if table:
        tbody = await table.find("tbody")
        log(f"[debug] tbody under {TABLE_CSS}: {bool(tbody)}", "INFO")
        if tbody:
            rows = await tbody.find_all("tr")
            log(f"[debug] row count via CSS: {len(rows or [])}", "INFO")
    try:
        tbody2 = await page.find_xpath(TBODY_XPATH_FALLBACK)
        log(f"[debug] tbody via XPATH present: {bool(tbody2)}", "INFO")
        if tbody2:
            rows2 = await tbody2.find_all("tr")
            log(f"[debug] row count via XPATH: {len(rows2 or [])}", "INFO")
    except Exception as e:
        log(f"[debug] tbody XPATH lookup error: {e}", "ERR")


async def _find_rows(page):
    """Try CSS (#m-table tbody tr) then fallback XPath."""
    rows = await page.find_all(ROW_CSS)
    if rows and len(rows) > 0:
        log(f"[table-scan] Found {len(rows)} rows via CSS", "INFO")
        return rows

    try:
        tbody = await page.find_xpath(TBODY_XPATH_FALLBACK)
        if tbody:
            xrows = await tbody.find_all("tr")
            if xrows and len(xrows) > 0:
                log(f"[table-scan] Found {len(xrows)} rows via XPATH", "INFO")
                return xrows
    except Exception as e:
        log(f"[table-scan] XPATH error: {e}", "ERR")

    log("No rows found.", "ERR")
    await _debug_table_snapshot(page)
    return []

async def _parse_asset_rows(page):
    assets = []
    non_assets = 0

    rows = await _find_rows(page)
    if not rows:
        log("No rows found", "ERR")
        return assets, non_assets

    preview_cap = 4
    for idx, row in enumerate(rows, start=1):
        try:
            html = (await row.get_html()) or ""
        except Exception as e:
            log(f"[row {idx}] failed to get html: {e}", "ERR")
            continue

        if idx <= preview_cap:
            log(f"[row {idx} preview] {html[:200].replace(chr(10),' ')}…", "INFO")

        m = re.search(r'href="https?://[^"]*/report/macro/(\d+)/(?:show|edit|delete)"', html)
        if not m:
            m = macro_link_re.search(html)

        macro_id = m.group(1) if m else None
        is_incomplete = (INCOMPLETE_AR in html)

        if macro_id:
            assets.append({
                "idx": idx,
                "macro_id": macro_id,
                "incomplete": is_incomplete
            })
            log(f"[row {idx}] ASSET macro_id={macro_id} incomplete={is_incomplete}", "INFO")
        else:
            non_assets += 1
            log(f"[row {idx}] NON-ASSET row", "INFO")

    log(f"Total assets found: {len(assets)} | non-asset rows: {non_assets}", "INFO")
    return assets, non_assets


async def _delete_assets_by_macro_list(
    page,
    to_delete_set: set | None,
    _unused_concurrency: int = 0,
    process_id: str = None,
    total_assets_state: dict | None = None
):
    # Check pause/stop state
    if process_id:
        action = await check_and_wait(process_id)
        if action == "stop":
            log(f"[deleter] Process {process_id} stopped by user request", "INFO")
            return 0

    seen = set()

    rows = await _find_rows(page)
    if not rows:
        log("[deleter] No rows found", "ERR")
        return 0

    # Build list of macro ids to delete on this subpage
    pending_macros: list[str] = []
    for idx, row in enumerate(rows, start=1):
        try:
            html = (await row.get_html()) or ""
        except Exception as e:
            log(f"[deleter] Failed to read row {idx}: {e}", "ERR")
            continue

        m = re.search(
            r'href="https?://[^"]*/report/macro/(\d+)/(?:show|edit|delete)"',
            html
        ) or macro_link_re.search(html)
        macro_id = m.group(1) if m else None
        if not macro_id:
            continue

        should_delete = (macro_id in to_delete_set) if to_delete_set is not None else (INCOMPLETE_AR in html)
        if should_delete and macro_id not in seen:
            pending_macros.append(macro_id)
            seen.add(macro_id)

    if not pending_macros:
        log("[deleter] nothing to delete on this subpage.", "INFO")
        return 0

    log(f"[deleter] pending macros on this subpage: {pending_macros}", "INFO")

    deleted = 0
    for idx, mid in enumerate(pending_macros, start=1):
        if process_id:
            action = await check_and_wait(process_id)
            if action == "stop":
                log(f"[deleter] Process {process_id} stopped by user request", "INFO")
                break

        delete_url = f"https://qima.taqeem.sa/report/macro/{mid}/delete"
        log(f"[deleter] ({idx}/{len(pending_macros)}) deleting macro_id={mid}", "INFO")

        page2 = None
        try:
            page2 = await new_tab(delete_url)
            await asyncio.sleep(1.0)
            await _ensure_confirm_ok(page2)
            await asyncio.sleep(0.8)
            await _try_click_inline_confirm(page2)
            await asyncio.sleep(1.2)
            await _try_click_inline_confirm(page2)
            await asyncio.sleep(0.8)
            deleted += 1
            if total_assets_state and total_assets_state.get("remaining") is not None:
                total_assets_state["remaining"] = max(
                    int(total_assets_state["remaining"]) - 1,
                    0
                )
                if process_id and total_assets_state.get("total") is not None:
                    total_assets = int(total_assets_state["total"])
                    remaining_assets = int(total_assets_state["remaining"])
                    completed_assets = max(total_assets - remaining_assets, 0)
                    await update_progress(
                        process_id,
                        completed=completed_assets,
                        total=total_assets,
                        emit=False
                    )
                    emit_progress(
                        process_id,
                        message=f"Deleted {completed_assets}/{total_assets} assets. Remaining {remaining_assets}."
                    )
        except Exception as e:
            log(f"[deleter] delete url failed for {mid}: {e}", "WARN")
        finally:
            if page2:
                try:
                    await page2.close()
                except Exception:
                    pass

        await asyncio.sleep(0.3)

    log(f"[deleter] Total delete tabs attempted: {deleted}/{len(pending_macros)} assets", "INFO")
    return deleted


async def delete_incomplete_assets_and_leave_one(page, process_id: str = None, total_assets_state: dict | None = None):
    # Check pause/stop state
    if process_id:
        action = await check_and_wait(process_id)
        if action == "stop":
            log(f"Process {process_id} stopped by user request", "INFO")
            return (None, 0, False, 0)

    assets, non_assets = await _parse_asset_rows(page)
    if not assets:
        log("No asset rows detected.", "INFO")
        return (None, 0, False, 0)

    # Delete ALL assets on this subpage (both complete and incomplete)
    all_ids = [a["macro_id"] for a in assets]
    total_assets = len(all_ids)
    all_assets_flag = (total_assets > 0)

    kept = None
    to_delete_set = set(all_ids)
    log(f"Deleting ALL assets on subpage: {all_ids}", "INFO")

    deleted = await _delete_assets_by_macro_list(
        page,
        to_delete_set,
        process_id=process_id,
        total_assets_state=total_assets_state
    )

    return (kept, deleted, all_assets_flag, total_assets)


async def _elem_is_disabled(el) -> bool:
    """Check disabled on the element and also its parent (DataTables often disables the <li>)."""
    try:
        cls = (await el.get_attribute('class') or '').lower()
        aria = (await el.get_attribute('aria-disabled') or '').lower()
        tabindex = (await el.get_attribute('tabindex') or '')
        href = (await el.get_attribute('href') or '')
        if 'disabled' in cls:
            return True
        if aria in ('true', '1'):
            return True
        if tabindex.strip() == '-1':
            return True
        if href.strip() == '':
            return True

        # parent <li> may carry disabled state
        try:
            parent = await el.get_property('parentElement')
            if parent:
                pcls = (await parent.get_attribute('class') or '').lower()
                paria = (await parent.get_attribute('aria-disabled') or '').lower()
                if 'disabled' in pcls:
                    return True
                if paria in ('true', '1'):
                    return True
        except Exception:
            pass
    except Exception:
        pass
    return False


async def _wait_for_rows(page, timeout=8.0, poll=0.25) -> bool:
    """Wait until table rows appear or timeout."""
    end = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < end:
        rows = await _find_rows(page)
        if rows:
            return True
        await asyncio.sleep(poll)
    log("[wait] rows did not appear in time.", "ERR")
    return False


async def _click_and_wait_table_redraw(page, button_el, timeout=6.0, poll=0.12) -> bool:
    """
    Click a pager button and wait until the table's signature changes.
    Returns True only if we detect a change; otherwise False.
    """
    try:
        loop = asyncio.get_running_loop()
        before = await _tbody_signature(page)
        await button_el.click()
        end = loop.time() + timeout
        while loop.time() < end:
            await asyncio.sleep(poll)
            after = await _tbody_signature(page)
            if after and after != before:
                return True
        return False
    except Exception as e:
        log(f"[pager] click_and_wait_table_redraw error: {e}", "ERR")
        return False


async def _datatable_prev_if_enabled(page) -> bool:
    prev_btn = await page.find(DATATABLE_PREV_SEL)
    if not prev_btn:
        return False
    if await _elem_is_disabled(prev_btn):
        return False
    try:
        changed = await _click_and_wait_table_redraw(page, prev_btn)
        if not changed:
            log("[dt-prev] click produced no redraw", "INFO")
        return changed
    except Exception as e:
        log(f"[dt-prev] click failed: {e}", "ERR")
        return False


async def _datatable_next_if_enabled(page) -> bool:
    next_btn = await page.find(DATATABLE_NEXT_SEL)
    if not next_btn:
        log("[dt-next] not found", "INFO")
        return False
    if await _elem_is_disabled(next_btn):
        log("[dt-next] disabled", "INFO")
        return False
    try:
        changed = await _click_and_wait_table_redraw(page, next_btn)
        if not changed:
            log("[dt-next] click produced no redraw", "INFO")
        return changed
    except Exception as e:
        log(f"[dt-next] click failed: {e}", "ERR")
        return False


# --- stable signature of current table body ---
async def _tbody_signature(page) -> str:
    try:
        rows = await _find_rows(page)
        if not rows:
            return "rows:0"
        parts = []
        for r in rows:
            try:
                html = (await r.get_html()) or ""
                m = macro_link_re.search(html)
                # Prefer macro id if present; otherwise a short html slice
                parts.append(m.group(1) if m else html[:40])
            except Exception:
                parts.append("err")
        return "|".join(parts)
    except Exception:
        return "sig-error"


async def _main_next_if_enabled(page) -> bool:
    """Click main paginator 'next' (rel=next) if enabled. True only if the table changed."""
    nxt = await page.find(MAIN_NEXT_SEL)
    if not nxt:
        log("[main-next] rel=next link not present; assuming last page.", "INFO")
        return False
    if await _elem_is_disabled(nxt):
        log("[main-next] disabled; reached final page.", "INFO")
        return False
    try:
        loop = asyncio.get_running_loop()
        before = await _tbody_signature(page)
        await nxt.click()
        end = loop.time() + 12.0
        while loop.time() < end:
            await asyncio.sleep(0.25)
            after = await _tbody_signature(page)
            if after and after != before:
                return True
        log("[main-next] rows didn't change signature; maybe already last page?", "INFO")
        return False
    except Exception as e:
        log(f"[main-next] click failed: {e}", "ERR")
        return False

async def _process_current_main_page_with_subpages(
    page,
    process_id: str = None,
    report_id: str | None = None,
    total_assets_state: dict | None = None,
    delete_type: str = "assets",
    user_id: str | None = None,
    company_office_id: str | None = None
):
    kept_ids = []
    deleted_total = 0

    # Check pause/stop state
    if process_id:
        action = await check_and_wait(process_id)
        if action == "stop":
            log(f"Process {process_id} stopped by user request", "INFO")
            return {"kept_ids": kept_ids, "deleted_total": deleted_total}

    # Ensure table is ready
    await _wait_for_rows(page, timeout=10.0)

    # Reset to subpage 1: click 'previous' until no more movement (safety cap)
    nudges = 0
    for _ in range(10):
        moved = await _datatable_prev_if_enabled(page)
        if not moved:
            break
        nudges += 1
        await _wait_for_rows(page, timeout=5.0)
    if nudges:
        log(f"[subpages] moved back {nudges} step(s) to subpage 1.", "INFO")
    else:
        log("[subpages] already at first subpage or no prev control.", "INFO")

    # Walk subpages forward: 1..N
    subpage_index = 1
    while True:
        # Check pause/stop state before each subpage
        if process_id:
            action = await check_and_wait(process_id)
            if action == "stop":
                log(f"Process {process_id} stopped by user request", "INFO")
                break

        await _wait_for_rows(page, timeout=8.0)
        kept, deleted, all_incomplete, page_asset_count = await delete_incomplete_assets_and_leave_one(
            page,
            process_id,
            total_assets_state
        )
        # kept is always None with new behaviour, but keep structure for compatibility
        if kept:
            kept_ids.append(kept)
        deleted_total += deleted
        if total_assets_state and total_assets_state.get("remaining") is not None:
            if process_id and total_assets_state.get("total") is not None:
                total_assets = int(total_assets_state["total"])
                remaining_assets = int(total_assets_state["remaining"])
                await _record_delete_status(
                    report_id=report_id,
                    total_assets=total_assets,
                    remaining_assets=remaining_assets,
                    delete_type=delete_type,
                    deleted=(remaining_assets == 0),
                    user_id=user_id,
                    company_office_id=company_office_id
                )
        log(
            f"[subpage {subpage_index}] kept={kept} deleted={deleted} all_incomplete={all_incomplete} "
            f"remaining_assets={total_assets_state.get('remaining') if total_assets_state else 'n/a'}",
            "OK"
        )

        moved = await _datatable_next_if_enabled(page)
        if not moved:
            log(f"[subpages] reached last subpage at index {subpage_index}.", "INFO")
            break

        subpage_index += 1

    return {
        "kept_ids": kept_ids,           # will usually be []
        "deleted_total": deleted_total, # total deletions on this main page
    }


# ==============================
# Orchestrator (top-level)
# ==============================



async def delete_incomplete_assets_until_delete_or_empty(page, max_rounds: int = 10, process_id: str = None):
    for round_idx in range(1, max_rounds + 1):
        # Check pause/stop state before each round
        if process_id:
            action = await check_and_wait(process_id)
            if action == "stop":
                log(f"Process {process_id} stopped by user request", "INFO")
                return {
                    "status": "STOPPED",
                    "rounds": round_idx - 1,
                }

        log(f"[loop] Cleanup round #{round_idx}", "STEP")
        # 1) Gather all assets visible in the table and delete them
        assets, _ = await _parse_asset_rows(page)
        all_ids = [a["macro_id"] for a in assets]

        if not all_ids:
            log("[loop] No assets found in DataTable; stopping loop.", "INFO")
            return {
                "status": "NO_ASSETS",
                "rounds": round_idx,
            }

        log(f"[loop] Round #{round_idx}: deleting ALL macros: {all_ids}", "INFO")
        await _delete_assets_by_macro_list(page, set(all_ids), process_id=process_id)

        # Wait for the table to settle after the batch of deletions
        await _wait_for_rows(page, timeout=10.0)

    log(f"[loop] Reached max_rounds={max_rounds} without emptying the table.", "WARN")
    return {
        "status": "MAX_ROUNDS_REACHED",
        "rounds": max_rounds,
    }

async def delete_incomplete_assets_across_pages(
    page,
    process_id: str = None,
    report_id: str | None = None,
    total_assets_state: dict | None = None,
    delete_type: str = "assets",
    user_id: str | None = None,
    company_office_id: str | None = None
):
    total_deleted = 0
    main_pages = 0

    while True:
        # Check pause/stop state before each main page
        if process_id:
            action = await check_and_wait(process_id)
            if action == "stop":
                log(f"Process {process_id} stopped by user request", "INFO")
                break

        main_pages += 1
        log(f"[main-page] processing page #{main_pages}", "STEP")

        # Process current main page (all DataTables subpages 1..N)
        res = await _process_current_main_page_with_subpages(
            page,
            process_id,
            report_id=report_id,
            total_assets_state=total_assets_state,
            delete_type=delete_type,
            user_id=user_id,
            company_office_id=company_office_id
        )
        deleted_here = int(res.get("deleted_total") or 0)
        total_deleted += deleted_here
        log(
            f"[main-page] page #{main_pages} deleted_total={deleted_here}, "
            f"running_total_deleted={total_deleted}",
            "INFO",
        )

        # Try to go to the next main page; if not possible, stop the crawl
        if not await _main_next_if_enabled(page):
            log("[main-page] no further main pages; stopping crawl.", "INFO")
            break

        # Wait for the table to be ready on the new main page
        await _wait_for_rows(page, timeout=10.0)

    summary = {
        "total_deleted": total_deleted,
        "main_pages_processed": main_pages,
    }
    log(f"[summary] {summary}", "OK")
    return summary

async def _has_any_assets(page) -> bool:
    try:
        has = await page.evaluate("""
        () => {
          const rows = Array.from(document.querySelectorAll('#m-table tbody tr'));
          return rows.some(tr => tr.querySelector('a[href*="/report/macro/"]'));
        }
        """)
        return bool(has)
    except Exception as e:
        log(f"[assets-check] error while checking asset rows: {e}", "ERR")
        return False

async def delete_incomplete_assets_flow(
    report_id: str,
    control_state=None,
    max_rounds: int = 10,
    user_id: str | None = None,
    company_office_id: str | None = None
) -> dict:
    page = None
    process_id = f"delete-incomplete-assets-{report_id}"
    
    try:
        from scripts.core.browser import new_window
        try:
            require_selected_company()
        except Exception as ctx_err:
            return {
                "status": "FAILED",
                "reportId": report_id,
                "error": str(ctx_err)
            }
        
        # Create process state for pause/resume/stop
        process_manager = get_process_manager()
        process_state = create_process(
            process_id=process_id,
            process_type="delete-incomplete-assets",
            total=0,
            report_id=report_id,
            max_rounds=max_rounds
        )
        
        url = build_report_url(report_id)
            
        # Open report page
        log(f"Opening report: {url}", "STEP")
        page = await new_window(url)
        await asyncio.sleep(2.0)

        html = await wait_for_report_info_html(page, timeout_seconds=10)
        extracted = extract_report_info_from_html(html)
        report_status = extracted.get("reportStatus")
        if not report_status or (
            report_status.strip() != DRAFT_STATUS_AR
            and report_status.strip().lower() != DRAFT_STATUS_EN
        ):
            log(
                f"Report {report_id}: status is not draft ({report_status}). Stopping.",
                "WARN"
            )
            await page.close()
            clear_process(process_id)
            return {
                "status": "FAILED",
                "message": "Report Status is not draft",
                "reportId": report_id,
                "reportStatus": report_status
            }

        total_assets_remaining = None
        total_assets_total = None

        for round_idx in range(1, max_rounds + 1):
            if total_assets_total is not None:
                await update_progress(
                    process_id,
                    completed=max(int(total_assets_total) - int(total_assets_remaining or 0), 0),
                    total=int(total_assets_total),
                    emit=False
                )
                emit_progress(
                    process_id,
                    message=f"Deleted {max(int(total_assets_total) - int(total_assets_remaining or 0), 0)}/{int(total_assets_total)} assets. Remaining {int(total_assets_remaining or 0)}."
                )
            
            # Check pause/stop state
            action = await check_and_wait(process_id)
            if action == "stop":
                log(f"Report {report_id}: Process stopped by user request in round {round_idx}", "INFO")
                await page.close()
                clear_process(process_id)
                return {
                    "status": "STOPPED",
                    "reportId": report_id,
                    "message": f"Asset deletion stopped in round {round_idx}",
                    "rounds": round_idx,
                }

            log(f"Report {report_id}: cleanup round #{round_idx}", "STEP")      
            await asyncio.sleep(2.0)

            log(f"Report {report_id}: Deleting assets across pages…", "INFO")
            if total_assets_remaining is None:
                assets_info = await calculate_total_assets(page)
                total_assets_remaining = assets_info.get("assets_exact") or 0
                total_assets_total = total_assets_remaining
                log(
                    f"Report {report_id}: total assets calculated = {total_assets_remaining}",
                    "INFO"
                )
                await update_progress(
                    process_id,
                    completed=0,
                    total=int(total_assets_total),
                    emit=False
                )
                emit_progress(
                    process_id,
                    message=f"Starting delete. Total assets: {int(total_assets_total)}."
                )
                await _record_delete_status(
                    report_id=report_id,
                    total_assets=int(total_assets_total),
                    remaining_assets=int(total_assets_remaining),
                    delete_type="assets",
                    deleted=(int(total_assets_remaining) == 0),
                    user_id=user_id,
                    company_office_id=company_office_id
                )
                await page.get(url)
                await asyncio.sleep(1.0)

            total_assets_state = {"remaining": total_assets_remaining, "total": total_assets_total}
            summary = await delete_incomplete_assets_across_pages(
                page,
                process_id,
                report_id=report_id,
                total_assets_state=total_assets_state,
                user_id=user_id,
                company_office_id=company_office_id
            )
            total_assets_remaining = total_assets_state.get("remaining")
            log(f"Report {report_id}: pagination summary -> {summary}", "OK")

            total_deleted = int(summary.get("total_deleted") or 0)

            if total_deleted > 0:
                # We removed at least some assets; re-open and try again next round.
                log(
                    f"Report {report_id}: Deleted {total_deleted} asset(s) in round "
                    f"#{round_idx}. Will re-open and re-check in next round.",
                    "INFO",
                )
                await page.get(url)
                continue

            # total_deleted == 0 --> no assets were removed anywhere.
            log(
                f"Report {report_id}: No assets deleted in this round (total_deleted=0). Checking if any assets remain…",
                "INFO",
            )

            # Check if any assets remain
            if await _has_any_assets(page):
                # There ARE assets left that could not be deleted by this process.
                log(
                    f"Report {report_id}: Assets still exist but none were deleted. Stopping cleanup loop.",
                    "INFO",
                )
                await page.close()
                clear_process(process_id)
                if total_assets_total is not None:
                    await _record_delete_status(
                        report_id=report_id,
                        total_assets=int(total_assets_total),
                        remaining_assets=int(total_assets_remaining or 0),
                        delete_type="assets",
                        deleted=False,
                        user_id=user_id,
                        company_office_id=company_office_id
                    )
                return {
                    "status": "ASSETS_REMAIN",
                    "reportId": report_id,
                    "message": f"Assets remain but could not be deleted after {round_idx} rounds",
                    "data": summary
                }

            # No assets at all: cleanup complete
            log(f"Report {report_id}: No assets remain. Cleanup complete.", "INFO")
            await page.close()
            clear_process(process_id)
            if total_assets_total is not None:
                await _record_delete_status(
                    report_id=report_id,
                    total_assets=int(total_assets_total),
                    remaining_assets=0,
                    delete_type="assets",
                    deleted=True,
                    user_id=user_id,
                    company_office_id=company_office_id
                )
            return {
                "status": "SUCCESS",
                "reportId": report_id,
                "message": f"Successfully deleted all assets across {summary['main_pages_processed']} pages in {round_idx} rounds",
                "data": summary
            }

        # Reached max rounds
        log(
            f"Report {report_id}: Reached max_rounds={max_rounds} without emptying assets or stable terminal state. Manual check recommended.",
            "WARN",
        )
        await page.close()
        clear_process(process_id)
        return {
            "status": "MAX_ROUNDS_REACHED",
            "reportId": report_id,
            "message": f"Reached maximum rounds ({max_rounds}) without completing cleanup",
            "data": {"rounds": max_rounds}
        }

    except Exception as e:
        log(f"Error deleting incomplete assets for report {report_id}: {e}", "ERR")
        import traceback
        if page:
            await page.close()
        clear_process(process_id)
        return {
            "status": "FAILED",
            "reportId": report_id,
            "error": str(e),
            "traceback": traceback.format_exc()
        }


# ==============================
# Pause/Resume/Stop handlers
# ==============================

async def pause_delete_incomplete_assets(report_id):
    """Pause incomplete assets deletion process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.pause_process(f"delete-incomplete-assets-{report_id}")
        
        if not state:
            return {
                "status": "FAILED",
                "error": f"No active deletion process found for report {report_id}"
            }
        
        return {
            "status": "SUCCESS",
            "message": f"Paused assets deletion for report {report_id}",
            "paused": state.paused
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def resume_delete_incomplete_assets(report_id):
    """Resume incomplete assets deletion process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.resume_process(f"delete-incomplete-assets-{report_id}")
        
        if not state:
            return {
                "status": "FAILED",
                "error": f"No active deletion process found for report {report_id}"
            }
        
        return {
            "status": "SUCCESS",
            "message": f"Resumed assets deletion for report {report_id}",
            "paused": state.paused
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def stop_delete_incomplete_assets(report_id):
    """Stop incomplete assets deletion process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.stop_process(f"delete-incomplete-assets-{report_id}")
        
        if not state:
            return {
                "status": "FAILED",
                "error": f"No active deletion process found for report {report_id}"
            }
        
        return {
            "status": "SUCCESS",
            "message": f"Stopped assets deletion for report {report_id}",
            "stopped": state.stopped
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}
