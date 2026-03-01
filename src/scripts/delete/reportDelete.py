import asyncio
import json
import re
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

from scripts.core import browser as browser_ctx
from scripts.core.browser import get_browser, new_tab, spawn_new_browser
from scripts.core.company_context import build_report_url, require_selected_company
from scripts.core.httpClient import update_report_check_status
from scripts.core.processControl import (
    check_and_wait,
    clear_process,
    create_process,
    emit_progress,
    get_process_manager,
    update_progress,
)
from scripts.core.utils import log
from scripts.submission.validateReport import (
    calculate_total_assets,
    extract_report_info_from_html,
    wait_for_report_info_html,
)

from .assetEdit import edit_macro_and_save

# ==============================
# Selectors / Constants
# ==============================
DELETE_REPORT_BTN = "button#delete_report.btn.btn-outline-primary"

# Prefer CSS (works best with DataTables)
TABLE_CSS = "#m-table"
ROW_CSS = "#m-table tbody tr"

TBODY_XPATH_FALLBACK = (
    "/html/body/div/div[5]/div[2]/div/div[8]/div/div/div/div[2]/div[2]/table/tbody"
)

INCOMPLETE_AR = "ØºÙØ± ÙÙØªÙÙØ©"
macro_link_re = re.compile(r"/report/macro/(\d+)/(?:show|edit|delete)")

# DataTables subpage pagination
DATATABLE_NEXT_SEL = (
    "a.paginate_button.next#m-table_next, "
    'a.paginate_button.next[aria-controls="m-table"], '
    "#m-table_next, "
    "a.paginate_button.next"
)
DATATABLE_PREV_SEL = (
    "a.paginate_button.previous#m-table_previous, "
    'a.paginate_button.previous[aria-controls="m-table"], '
    "#m-table_previous, "
    "a.paginate_button.previous"
)

# Main (outer) pagination
MAIN_NEXT_SEL = 'a.page-link[rel="next"]'

DRAFT_STATUS_AR = "ÙØ³ÙØ¯Ø©"
DRAFT_STATUS_EN = "draft"


async def _record_delete_status(
    report_id: str,
    total_assets: int | None,
    remaining_assets: int | None,
    delete_type: str,
    deleted: bool,
    user_id: str | None = None,
    company_office_id: str | None = None,
):
    """Record deletion status via API instead of direct MongoDB"""
    if not report_id:
        return

    try:
        success = await update_report_check_status(
            report_id=report_id,
            user_id=user_id,
            company_office_id=company_office_id,
            total_assets=total_assets,
            remaining_assets=remaining_assets,
            delete_type=delete_type,
            deleted=deleted,
        )

        if not success:
            log(f"[API] Failed to update delete status for report {report_id}", "WARN")

    except Exception as e:
        log(f"[API] Failed to update delete status: {e}", "WARN")


# ==============================
# Dialog/Confirm helpers
# ==============================


async def _ensure_confirm_ok(page):
    """
    Auto-accept alert/confirm/prompt and suppress ALL 'beforeunload' leave dialogs.
    Patches top window + same-origin iframes and re-applies right before clicks/submits.
    Returns the number of windows patched (int).
    """
    js = r"""
    (() => {
      function hardPatch(win){
        try{
          const yes  = () => true;
          const noop = () => {};
          // Basic dialog overrides
          try{ win.confirm = yes; }catch(_){}
          try{ win.alert   = noop; }catch(_){}
          try{ win.prompt  = () => ""; }catch(_){}
          try{ Object.defineProperty(win,'confirm',{value:yes,configurable:true}); }catch(_){}
          try{ Object.defineProperty(win,'alert',  {value:noop,configurable:true}); }catch(_){}
          try{ Object.defineProperty(win,'prompt', {value:()=>"",configurable:true}); }catch(_){}

          // Kill existing beforeunload
          try{ win.onbeforeunload = null; }catch(_){}
          try{
            Object.defineProperty(win,'onbeforeunload',{
              configurable:true,
              get(){ return null; },
              set(_v){ /* swallow any future assignment */ }
            });
          }catch(_){}

          // Ignore any new listeners for 'beforeunload'
          try{
            const origAdd = win.addEventListener.bind(win);
            win.addEventListener = function(type, listener, options){
              if (type === 'beforeunload') return;  // block
              return origAdd(type, listener, options);
            };
          }catch(_){}
          try{
            if (win.attachEvent){
              const origAttach = win.attachEvent.bind(win);
              win.attachEvent = function(type, listener){
                if (String(type).toLowerCase() === 'onbeforeunload') return;
                return origAttach(type, listener);
              };
            }
          }catch(_){}

          // As a final guard: if any 'beforeunload' still fires, neutralize it.
          try{
            origBU && win.removeEventListener('beforeunload', origBU, true);
          }catch(_){}
          try{
            var origBU = function(e){
              try{
                e.stopImmediatePropagation();
                Object.defineProperty(e,'returnValue',{value:undefined,writable:true});
              }catch(_){}
            };
            win.addEventListener('beforeunload', origBU, true);
          }catch(_){}
        }catch(_){}
      }

      function patchAll(win){
        hardPatch(win);
        let n = 1;
        for (const f of Array.from(win.frames||[])){
          try{
            if (f.location && f.location.origin === win.location.origin){
              hardPatch(f);
              n++;
            }
          }catch(_){}
        }
        const reassert = () => { try{ hardPatch(win); }catch(_){} };
        try{
          win.addEventListener('click',  reassert, true);
          win.addEventListener('submit', reassert, true);
          win.addEventListener('keydown',reassert, true);
          win.addEventListener('mousedown',reassert, true);
          win.addEventListener('touchstart',reassert, true);
        }catch(_){}
        return n;
      }

      return patchAll(window);
    })()
    """
    try:
        count = await page.evaluate(js)
        try:
            n = int(count) if count is not None else 0
        except Exception:
            n = 0
        log(f"[confirm] Auto-OK + no-leave patched in {n} window(s).", "INFO")
        return n
    except Exception as e:
        log(f"[confirm] Patch failed: {e}", "ERR")
        return 0


async def _try_click_inline_confirm(page):
    """If the /delete page shows an on-page confirm, click it (Arabic/English)."""
    try:
        clicked = await page.evaluate("""
        () => {
          const labels = ["OK","Ok","Confirm","CONFIRM","Yes","Delete","Ø­Ø°Ù","ØªØ£ÙÙØ¯","ÙÙØ§ÙÙ"];
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
        log(
            "[confirm] Inline confirm " + ("clicked." if clicked else "not detected."),
            "INFO",
        )
    except Exception as e:
        log(f"[confirm] Inline confirm scan failed: {e}", "ERR")


async def try_delete_report(page):
    for attempt in range(1, 4):
        btn = await page.find(DELETE_REPORT_BTN)
        if not btn:
            return False

        await _ensure_confirm_ok(page)
        await btn.scroll_into_view()
        try:
            await btn.click()
        except Exception as e:
            log(f"[delete-report] click failed (attempt {attempt}): {e}", "WARN")
            await asyncio.sleep(1.0)
            continue

        # give time for confirm + server action (first click can be slow)
        await asyncio.sleep(2.5)
        await _try_click_inline_confirm(page)
        await asyncio.sleep(1.0)

        # if still has delete button, it wasn't deleted; retry
        if await page.find(DELETE_REPORT_BTN):
            log(f"[delete-report] button still present after attempt {attempt}", "INFO")
            await asyncio.sleep(1.0)
            continue

        return True

    return False


# ==============================
# Table scanning / parsing
# ==============================


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


# ==============================
# Parsing assets on current (sub)page
# ==============================


async def _parse_asset_rows(page):
    """
    Return (assets, non_asset_rows_count) from the current page.
    """
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
            log(f"[row {idx} preview] {html[:200].replace(chr(10), ' ')}Ã¢ÂÂ¦", "INFO")

        m = re.search(
            r'href="https?://[^"]*/report/macro/(\d+)/(?:show|edit|delete)"', html
        )
        if not m:
            m = macro_link_re.search(html)

        macro_id = m.group(1) if m else None
        is_incomplete = INCOMPLETE_AR in html

        if macro_id:
            assets.append(
                {"idx": idx, "macro_id": macro_id, "incomplete": is_incomplete}
            )
            log(
                f"[row {idx}] ASSET macro_id={macro_id} incomplete={is_incomplete}",
                "INFO",
            )
        else:
            non_assets += 1
            log(f"[row {idx}] NON-ASSET row", "INFO")

    log(f"Total assets found: {len(assets)} | non-asset rows: {non_assets}", "INFO")
    return assets, non_assets


# ==============================
# Delete flow
# ==============================


async def _open_new_tab(url: str, pause: float = 1.0, retries: int = 2):
    """Open URL in a NEW tab; retry on transient transport errors."""
    for attempt in range(retries + 1):
        try:
            log(f"[new-tab] -> {url} (try {attempt + 1}/{retries + 1})", "INFO")
            page2 = await new_tab(url)
            await asyncio.sleep(pause)
            return page2
        except Exception as e:
            log(f"[new-tab] failed: {e}", "WARN")
            await asyncio.sleep(0.6 + 0.6 * attempt)
    raise RuntimeError("new-tab-open-failed")


async def _delete_assets_by_macro_list(
    page,
    to_delete_set: set | None,
    _unused_concurrency: int = 0,
    process_id: str = None,
    total_assets_state: dict | None = None,
):
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
            r'href="https?://[^"]*/report/macro/(\d+)/(?:show|edit|delete)"', html
        ) or macro_link_re.search(html)
        macro_id = m.group(1) if m else None
        if not macro_id:
            continue

        should_delete = (
            (macro_id in to_delete_set)
            if to_delete_set is not None
            else (INCOMPLETE_AR in html)
        )
        if should_delete and macro_id not in seen:
            pending_macros.append(macro_id)
            seen.add(macro_id)

    if not pending_macros:
        log("[deleter] nothing to delete on this subpage.", "INFO")
        return 0

    log(f"[deleter] pending macros on this subpage: {pending_macros}", "INFO")

    # Check pause/stop state before deleting
    if process_id:
        action = await check_and_wait(process_id)
        if action == "stop":
            log(f"[deleter] Process {process_id} stopped by user request", "INFO")
            return 0

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
            page2 = await _open_new_tab(delete_url, pause=1.0)
            await _ensure_confirm_ok(page2)
            await asyncio.sleep(0.8)
            await _try_click_inline_confirm(page2)
            await asyncio.sleep(1.2)
            await _try_click_inline_confirm(page2)
            await asyncio.sleep(0.8)
            deleted += 1
            if total_assets_state and total_assets_state.get("remaining") is not None:
                total_assets_state["remaining"] = max(
                    int(total_assets_state["remaining"]) - 1, 0
                )
                if process_id and total_assets_state.get("total") is not None:
                    total_assets = int(total_assets_state["total"])
                    remaining_assets = int(total_assets_state["remaining"])
                    completed_assets = max(total_assets - remaining_assets, 0)
                    await update_progress(
                        process_id,
                        completed=completed_assets,
                        total=total_assets,
                        emit=False,
                    )
                    emit_progress(
                        process_id,
                        message=f"Deleted {completed_assets}/{total_assets} assets. Remaining {remaining_assets}.",
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

    log(
        f"[deleter] Total delete tabs attempted: {deleted}/{len(pending_macros)} assets",
        "INFO",
    )
    return deleted


async def delete_incomplete_assets_and_leave_one(
    page, process_id: str = None, total_assets_state: dict | None = None
):
    """
    Delete assets with 'ØºÙØ± ÙÙØªÙÙØ©' on the CURRENT subpage..
    NEW BEHAVIOUR:
      - Delete *all* incomplete assets.
      - Do NOT keep any incomplete asset on purpose.
    Returns (kept_macro_id_or_None, deleted_count, all_incomplete_bool).
      kept_macro_id_or_None will always be None now.
    """
    assets, non_assets = await _parse_asset_rows(page)
    if not assets:
        log("No asset rows detected.", "INFO")
        return (None, 0, False, 0)

    incomplete_ids = [a["macro_id"] for a in assets if a["incomplete"]]
    total_assets = len(assets)
    all_incomplete = len(incomplete_ids) == total_assets

    log(
        f"Assets total={total_assets}, incomplete={len(incomplete_ids)}, "
        f"all_incomplete={all_incomplete}",
        "INFO",
    )

    # Check pause/stop state
    if process_id:
        action = await check_and_wait(process_id)
        if action == "stop":
            log(f"Process {process_id} stopped by user request", "INFO")
            return (None, 0, all_incomplete, total_assets)

    # NEW: always delete all incomplete assets; do not intentionally keep one.
    kept = None
    to_delete = incomplete_ids
    log(f"Deleting incomplete assets only: {to_delete}", "INFO")

    to_delete_set = set(to_delete) if len(to_delete) > 0 else None
    deleted = await _delete_assets_by_macro_list(
        page,
        to_delete_set,
        process_id=process_id,
        total_assets_state=total_assets_state,
    )

    return (kept, deleted, all_incomplete, total_assets)


# ==============================
# Pagination utilities
# ==============================


async def _elem_is_disabled(el) -> bool:
    """Check disabled on the element and also its parent (DataTables often disables the <li>)."""
    try:
        cls = (await el.get_attribute("class") or "").lower()
        aria = (await el.get_attribute("aria-disabled") or "").lower()
        tabindex = await el.get_attribute("tabindex") or ""
        href = await el.get_attribute("href") or ""
        if "disabled" in cls:
            return True
        if aria in ("true", "1"):
            return True
        if tabindex.strip() == "-1":
            return True
        if href.strip() == "":
            return True

        # parent <li> may carry disabled state
        try:
            parent = await el.get_property("parentElement")
            if parent:
                pcls = (await parent.get_attribute("class") or "").lower()
                paria = (await parent.get_attribute("aria-disabled") or "").lower()
                if "disabled" in pcls:
                    return True
                if paria in ("true", "1"):
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
        log(
            "[main-next] rows didn't change signature; maybe already last page?", "INFO"
        )
        return False
    except Exception as e:
        log(f"[main-next] click failed: {e}", "ERR")
        return False


# ==============================
# Page processors (subpages within a main page)
# ==============================


async def _process_current_main_page_with_subpages(
    page,
    process_id: str = None,
    report_id: str | None = None,
    total_assets_state: dict | None = None,
    delete_type: str = "report",
    user_id: str | None = None,
    company_office_id: str | None = None,
):
    """
    On the current main page:
      1) Go to subpage 1 (click 'previous' until it stops changing).
      2) Walk forward through ALL DataTables subpages (1..N):
         - On each subpage, delete incomplete assets.
    Returns a dict with totals & kept ids (kept ids will be empty now).
    """
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
        (
            kept,
            deleted,
            all_incomplete,
            page_asset_count,
        ) = await delete_incomplete_assets_and_leave_one(
            page, process_id, total_assets_state
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
                    company_office_id=company_office_id,
                )
        log(
            f"[subpage {subpage_index}] kept={kept} deleted={deleted} all_incomplete={all_incomplete} "
            f"remaining_assets={total_assets_state.get('remaining') if total_assets_state else 'n/a'}",
            "OK",
        )

        moved = await _datatable_next_if_enabled(page)
        if not moved:
            log(f"[subpages] reached last subpage at index {subpage_index}.", "INFO")
            break

        subpage_index += 1

    return {
        "kept_ids": kept_ids,  # will usually be []
        "deleted_total": deleted_total,  # total deletions on this main page
    }


# ==============================
# Orchestrator (top-level)
# ==============================


async def delete_incomplete_assets_until_delete_or_empty(
    page, max_rounds: int = 10, process_id: str = None
):
    """
    High-level loop for a SINGLE report page - continues to next part
    """
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

        # 1) Try the Delete Report button on this page
        log("[loop] Checking for Delete Report buttonÃ¢ÂÂ¦", "INFO")
        if await try_delete_report(page):
            log(
                "[loop] Delete Report button clicked successfully; stopping loop.", "OK"
            )
            return {
                "status": "DELETED",
                "rounds": round_idx,
            }

        # 2) No delete button -> delete all incomplete assets visible in the table
        assets, _ = await _parse_asset_rows(page)
        incomplete_ids = [a["macro_id"] for a in assets if a["incomplete"]]

        if not incomplete_ids:
            log(
                "[loop] No incomplete assets found in DataTable; stopping loop.", "INFO"
            )
            return {
                "status": "NO_INCOMPLETE_ASSETS",
                "rounds": round_idx,
            }

        log(
            f"[loop] Round #{round_idx}: deleting incomplete macros: {incomplete_ids}",
            "INFO",
        )
        await _delete_assets_by_macro_list(
            page, set(incomplete_ids), process_id=process_id
        )

        # Wait for the table to settle after the batch of deletions
        await _wait_for_rows(page, timeout=10.0)

    log(
        f"[loop] Reached max_rounds={max_rounds} without delete button or empty table.",
        "WARN",
    )
    return {
        "status": "MAX_ROUNDS_REACHED",
        "rounds": max_rounds,
    }


async def delete_incomplete_assets_across_pages(
    page,
    process_id: str = None,
    report_id: str | None = None,
    total_assets_state: dict | None = None,
    delete_type: str = "report",
    user_id: str | None = None,
    company_office_id: str | None = None,
):
    """
    Full crawl of the report's assets table - continues to next part
    """
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
            company_office_id=company_office_id,
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
    """
    Check if there are ANY asset rows in the table (#m-table).
    We look for rows that contain a link to /report/macro/xxxx.
    """
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


async def create_one_asset_and_get_macro(
    page, report_id: str, process_id: str = None
) -> str | None:
    create_url = f"https://qima.taqeem.sa/report/asset/create/{report_id}"
    log(f"[create-asset] Opening create page: {create_url}", "STEP")

    await page.get(create_url)
    await asyncio.sleep(1.0)

    # Check pause/stop state
    if process_id:
        action = await check_and_wait(process_id)
        if action == "stop":
            log(f"Process {process_id} stopped by user request", "INFO")
            return None

    # 1) Set macros = 1
    try:
        ok = await page.evaluate("""
        (() => {
            const el = document.querySelector("input#macros");
            if (!el) return false;
            el.value = "1";
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        })()
        """)
        log(f"[create-asset] set macros=1 -> ok={ok}", "INFO")
        if not ok:
            log("[create-asset] #macros input not found or not set.", "ERR")
            return None
    except Exception as e:
        log(f"[create-asset] failed to set macros=1: {e}", "ERR")
        return None

    # 2) Click Save button ("Ø­ÙØ¸" / "Save")
    try:
        clicked = await page.evaluate("""
        (() => {
            const btns = Array.from(document.querySelectorAll("input[type=submit], button"));
            for (const b of btns) {
                const t = (b.value || b.innerText || "").trim();
                if (t.includes("Ø­ÙØ¸") || t.toLowerCase().includes("save")) {
                    b.click();
                    return true;
                }
            }
            return false;
        })()
        """)
        log(f"[create-asset] clicked save button -> {clicked}", "INFO")
        if not clicked:
            log("[create-asset] Save button not found.", "ERR")
            return None
    except Exception as e:
        log(f"[create-asset] save click failed: {e}", "ERR")
        return None

    # Give Qima time to redirect
    await asyncio.sleep(2.0)

    # 3) Try to read macro id from current URL
    try:
        href = await page.evaluate("() => window.location.href || ''")
    except Exception:
        href = ""

    if href:
        m = re.search(r"/report/macro/(\d+)/(?:edit|show)", href)
        if m:
            macro_id = m.group(1)
            log(f"[create-asset] Detected new macro_id from URL: {macro_id}", "OK")
            return macro_id

    log(
        "[create-asset] Could not detect macro_id from redirect URL, trying table fallbackÃ¢ÂÂ¦",
        "WARN",
    )

    # 4) Fallback: open report page and parse first/last asset row
    try:
        report_url = build_report_url(report_id)
        log(
            f"[create-asset] Opening report page to discover macro id: {report_url}",
            "INFO",
        )
        page2 = await page.get(report_url)
        await asyncio.sleep(1.0)

        assets, _ = await _parse_asset_rows(page2)
        if not assets:
            log("[create-asset] Fallback parse: no assets found after creation.", "ERR")
            return None

        if len(assets) == 1:
            macro_id = assets[0]["macro_id"]
            log(
                f"[create-asset] Fallback parse: single asset macro_id={macro_id}", "OK"
            )
            return macro_id

        # If more than one, pick the last (usually the newest)
        macro_id = assets[-1]["macro_id"]
        log(
            f"[create-asset] Fallback parse: chose last asset macro_id={macro_id}", "OK"
        )
        return macro_id

    except Exception as e:
        log(f"[create-asset] error while discovering new macro id: {e}", "ERR")
        return None


async def delete_report_flow(
    report_id: str,
    max_rounds: int = 10,
    user_id: str | None = None,
    company_office_id: str | None = None,
):
    page = None
    process_id = f"delete-report-{report_id}"

    try:
        try:
            require_selected_company()
        except Exception as ctx_err:
            return {"status": "FAILED", "reportId": report_id, "error": str(ctx_err)}

        # Create process state for pause/resume/stop
        process_manager = get_process_manager()
        process_state = create_process(
            process_id=process_id,
            process_type="delete-report",
            total=0,
            report_id=report_id,
            max_rounds=max_rounds,
        )

        def _load_template():
            try:
                template_path = (
                    Path.cwd() / "scripts" / "delete" / "asset_template.json"
                )
                with template_path.open("r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                log(f"Could not load template {template_path}: {e}", "ERR")
                return {}

        total_deleted_overall = 0
        total_assets_remaining = None
        total_assets_total = None
        current_round = 0

        report_url = build_report_url(report_id)

        async def open_visible_window(url):
            base_browser = None
            new_browser = None
            try:
                try:
                    base_browser = await get_browser()
                except Exception:
                    base_browser = None

                if base_browser:
                    new_browser = await spawn_new_browser(base_browser, headless=False)

                    page = await new_browser.get(url, new_window=True)
                    return page, new_browser

                new_browser = await get_browser(force_new=True, headless_override=False)
                page = await new_browser.get(url, new_window=True)
                return page, new_browser

            except Exception as e:
                return {"status": "FAILED", "error": str(e)}, None

        page, new_browser = await open_visible_window(report_url)
        if not page or isinstance(page, dict):
            error_msg = (
                page.get("error")
                if isinstance(page, dict)
                else "Failed to open report window."
            )
            log(
                f"Report {report_id}: could not open report window ({error_msg})", "ERR"
            )
            clear_process(process_id)
            return {
                "status": "FAILED",
                "error": error_msg or "Failed to open report window.",
                "reportId": report_id,
            }

        import nodriver as uc

        def install_auto_accept_dialogs(page):
            if not hasattr(page, "add_handler"):
                log(f"Report {report_id}: dialog handler not available on page", "WARN")
                return

            async def _handler(ev):
                if ev.__class__.__name__ == "JavascriptDialogOpening":
                    msg = getattr(ev, "message", "")
                    log(f"[dialog] {msg}", "INFO")
                    await page.send(
                        uc.cdp.page.handle_java_script_dialog(
                            accept=True, prompt_text=""
                        )
                    )

            page.add_handler(uc.cdp.page, _handler)

        install_auto_accept_dialogs(page)

        log(
            f"Report {report_id}: waiting for report page (login if prompted)...",
            "INFO",
        )
        html = await wait_for_report_info_html(page, timeout_seconds=180)
        extracted = extract_report_info_from_html(html)
        report_status = extracted.get("reportStatus")
        if not report_status:
            log(
                f"Report {report_id}: report page not ready. Login to Taqeem in the opened window.",
                "WARN",
            )
            await page.close()
            clear_process(process_id)
            return {
                "status": "FAILED",
                "message": "Report page not loaded. Please login to Taqeem and try again.",
                "reportId": report_id,
            }

        if (
            report_status.strip() != DRAFT_STATUS_AR
            and report_status.strip().lower() != DRAFT_STATUS_EN
        ):
            log(
                f"Report {report_id}: status is not draft ({report_status}). Stopping.",
                "WARN",
            )
            await page.close()
            clear_process(process_id)
            return {
                "status": "FAILED",
                "message": "Report Status is not draft",
                "reportId": report_id,
                "reportStatus": report_status,
            }

        assets_info = await calculate_total_assets(page)
        total_assets_total = assets_info.get("assets_exact") or 0
        total_assets_remaining = total_assets_total
        await update_progress(
            process_id, completed=0, total=int(total_assets_total), emit=False
        )
        emit_progress(
            process_id,
            message=f"Starting delete. Total assets: {int(total_assets_total)}.",
        )
        await _record_delete_status(
            report_id=report_id,
            total_assets=int(total_assets_total),
            remaining_assets=int(total_assets_remaining),
            delete_type="report",
            deleted=(int(total_assets_remaining) == 0),
            user_id=user_id,
            company_office_id=company_office_id,
        )
        await page.get(report_url)
        await asyncio.sleep(1.0)

        for round_idx in range(1, max_rounds + 1):
            current_round = round_idx
            if total_assets_total is not None:
                await update_progress(
                    process_id,
                    completed=max(
                        int(total_assets_total) - int(total_assets_remaining or 0), 0
                    ),
                    total=int(total_assets_total),
                    emit=False,
                )
                emit_progress(
                    process_id,
                    message=f"Deleted {max(int(total_assets_total) - int(total_assets_remaining or 0), 0)}/{int(total_assets_total)} assets. Remaining {int(total_assets_remaining or 0)}.",
                )

            # Check pause/stop state
            action = await check_and_wait(process_id)
            if action == "stop":
                log(
                    f"Report {report_id}: Process stopped by user request in round {round_idx}",
                    "INFO",
                )
                await page.close()
                clear_process(process_id)
                return {
                    "status": "STOPPED",
                    "message": f"Report deletion stopped in round {round_idx}",
                    "reportId": report_id,
                    "rounds": round_idx,
                    "deletedAssets": total_deleted_overall,
                }

            log(f"Report {report_id}: cleanup round #{round_idx}", "STEP")

            # 1) Open the report page
            await asyncio.sleep(1.0)

            # 2) Try Delete Report button first
            log(f"Report {report_id}: checking for Delete Report buttonÃ¢ÂÂ¦", "INFO")
            if await try_delete_report(page):
                log(
                    f"Report {report_id}: Delete Report button clicked in round #{round_idx}.",
                    "OK",
                )
                if total_assets_total is not None:
                    await update_progress(
                        process_id,
                        completed=int(total_assets_total),
                        total=int(total_assets_total),
                        emit=False,
                    )
                    emit_progress(
                        process_id,
                        message=f"Deleted {int(total_assets_total)}/{int(total_assets_total)} assets. Remaining 0.",
                    )
                await _record_delete_status(
                    report_id=report_id,
                    total_assets=int(total_assets_total or 0),
                    remaining_assets=0,
                    delete_type="report",
                    deleted=True,
                    user_id=user_id,
                    company_office_id=company_office_id,
                )
                await page.close()
                clear_process(process_id)
                return {
                    "status": "SUCCESS",
                    "message": f"Report deleted in round {round_idx}",
                    "reportId": report_id,
                    "rounds": round_idx,
                    "deletedAssets": total_deleted_overall,
                }

            # 3) No delete button -> prune incomplete assets across ALL pages/subpages
            log(
                f"Report {report_id}: Delete button not present. "
                f"Deleting incomplete assets across pagesÃ¢ÂÂ¦",
                "INFO",
            )
            if total_assets_remaining is None:
                assets_info = await calculate_total_assets(page)
                total_assets_remaining = assets_info.get("assets_exact") or 0
                total_assets_total = total_assets_remaining
                log(
                    f"Report {report_id}: total assets calculated = {total_assets_remaining}",
                    "INFO",
                )
                await update_progress(
                    process_id, completed=0, total=int(total_assets_total), emit=False
                )
                emit_progress(
                    process_id,
                    message=f"Starting delete. Total assets: {int(total_assets_total)}.",
                )
                await _record_delete_status(
                    report_id=report_id,
                    total_assets=int(total_assets_total),
                    remaining_assets=int(total_assets_remaining),
                    delete_type="report",
                    deleted=(int(total_assets_remaining) == 0),
                    user_id=user_id,
                    company_office_id=company_office_id,
                )
                await page.get(report_url)
                await asyncio.sleep(1.0)

            total_assets_state = {
                "remaining": total_assets_remaining,
                "total": total_assets_total,
            }
            summary = await delete_incomplete_assets_across_pages(
                page,
                process_id,
                report_id=report_id,
                total_assets_state=total_assets_state,
                user_id=user_id,
                company_office_id=company_office_id,
            )
            total_assets_remaining = total_assets_state.get("remaining")
            log(f"Report {report_id}: pagination summary -> {summary}", "OK")

            total_deleted = int(summary.get("total_deleted") or 0)
            total_deleted_overall += total_deleted

            if total_deleted > 0:
                # We removed at least some incomplete assets; re-open and try again next round.
                log(
                    f"Report {report_id}: Deleted {total_deleted} incomplete asset(s) in round "
                    f"#{round_idx}. Will re-open and re-check Delete button in next round.",
                    "INFO",
                )
                await page.get(report_url)
                continue

            # total_deleted == 0  --> no incomplete assets were removed anywhere.
            log(
                f"Report {report_id}: No incomplete assets deleted in this round "
                f"(total_deleted=0). Checking if any assets remainÃ¢ÂÂ¦",
                "INFO",
            )

            # Re-open to check asset presence cleanly
            await page.get(report_url)
            await asyncio.sleep(1.0)

            if await _has_any_assets(page):
                # There ARE assets, but none were incomplete (or deletable).
                log(
                    f"Report {report_id}: Assets still exist but none appear incomplete/deletable. "
                    f"Stopping cleanup loop.",
                    "INFO",
                )
                await page.close()
                clear_process(process_id)
                if total_assets_total is not None:
                    await _record_delete_status(
                        report_id=report_id,
                        total_assets=int(total_assets_total),
                        remaining_assets=int(total_assets_remaining or 0),
                        delete_type="report",
                        deleted=False,
                        user_id=user_id,
                        company_office_id=company_office_id,
                    )
                return {
                    "status": "PARTIAL",
                    "message": "Assets exist but none are incomplete/deletable",
                    "reportId": report_id,
                    "rounds": round_idx,
                    "deletedAssets": total_deleted_overall,
                }

            # Ã°ÂÂÂ No assets at all: create ONE asset and then fill it using template
            log(
                f"Report {report_id}: No assets remain. Creating one new assetÃ¢ÂÂ¦",
                "INFO",
            )
            macro_id = await create_one_asset_and_get_macro(page, report_id, process_id)
            if not macro_id:
                log(
                    f"Report {report_id}: Failed to create or detect new asset macro id. "
                    f"Stopping cleanup loop.",
                    "ERR",
                )
                await page.close()
                clear_process(process_id)
                return {
                    "status": "FAILED",
                    "message": "Failed to create new asset",
                    "reportId": report_id,
                    "rounds": round_idx,
                    "deletedAssets": total_deleted_overall,
                }

            log(
                f"Report {report_id}: New asset created with macro_id={macro_id}. Filling detailsÃ¢ÂÂ¦",
                "INFO",
            )

            values = _load_template()
            ok_fill = await edit_macro_and_save(page, macro_id, values)
            log(
                f"Report {report_id}: edit_macro_and_save(macro_id={macro_id}) -> ok={ok_fill}",
                "INFO",
            )

            if not ok_fill:
                log(
                    f"Report {report_id}: Failed to fill/save the new asset macro {macro_id}. "
                    f"Stopping cleanup loop.",
                    "ERR",
                )
                await page.close()
                clear_process(process_id)
                return {
                    "status": "FAILED",
                    "message": f"Failed to fill/save asset {macro_id}",
                    "reportId": report_id,
                    "rounds": round_idx,
                    "deletedAssets": total_deleted_overall,
                    "macroId": macro_id,
                }
            log(
                f"Report {report_id}: New asset {macro_id} created and filled. "
                f"Next round will re-open the report and try Delete button again.",
                "INFO",
            )
            await page.get(report_url)
            await asyncio.sleep(1.0)
            # Continue to next loop round

        # Safety exit - reached max_rounds
        log(
            f"Report {report_id}: Reached max_rounds={max_rounds} without Delete Report button "
            f"appearing or stable terminal state. Manual check recommended.",
            "WARN",
        )
        await page.close()
        clear_process(process_id)
        return {
            "status": "MAX_ROUNDS_REACHED",
            "message": f"Reached max rounds ({max_rounds}) without completing deletion",
            "reportId": report_id,
            "rounds": max_rounds,
            "deletedAssets": total_deleted_overall,
        }

    except Exception as e:
        log(f"Report {report_id}: Exception in delete_report_flow: {e}", "ERR")
        if page and not isinstance(page, dict) and hasattr(page, "close"):
            await page.close()
        clear_process(process_id)
        return {"status": "FAILED", "error": str(e), "reportId": report_id}

    finally:
        try:
            if new_browser:
                new_browser.stop()
        except Exception as e:
            log(f"Report {report_id}: Failed to close new browser: {e}", "WARN")


async def delete_multiple_reports_flow(report_ids: list[str], max_rounds: int = 10):
    if not report_ids:
        return {"status": "FAILED", "error": "report_ids array is empty"}

    total = len(report_ids)
    deleted = 0
    failed = 0
    results = []

    log(f"[batch-delete] Starting deletion of {total} report(s)", "STEP")

    for idx, report_id in enumerate(report_ids, start=1):
        log(f"[batch-delete] ({idx}/{total}) Deleting report {report_id}", "STEP")

        try:
            result = await delete_report_flow(
                report_id=report_id, max_rounds=max_rounds
            )

            results.append(result)

            status = result.get("status")

            if status == "SUCCESS":
                deleted += 1
                log(f"[batch-delete] Report {report_id} deleted successfully", "OK")
            else:
                failed += 1
                log(
                    f"[batch-delete] Report {report_id} finished with status={status}",
                    "WARN",
                )

        except Exception as e:
            failed += 1
            err = {"status": "FAILED", "reportId": report_id, "error": str(e)}
            results.append(err)
            log(
                f"[batch-delete] Exception while deleting report {report_id}: {e}",
                "ERR",
            )

    overall_status = (
        "SUCCESS" if deleted == total else "FAILED" if deleted == 0 else "PARTIAL"
    )

    summary = {
        "status": overall_status,
        "total": total,
        "deleted": deleted,
        "failed": failed,
        "results": results,
    }

    log(f"[batch-delete] Summary: {summary}", "OK")
    return summary


# ==============================
# Pause/Resume/Stop handlers for delete report
# ==============================


async def pause_delete_report(report_id):
    """Pause report deletion process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.pause_process(f"delete-report-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active delete process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Paused report deletion for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def resume_delete_report(report_id):
    """Resume report deletion process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.resume_process(f"delete-report-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active delete process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Resumed report deletion for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def stop_delete_report(report_id):
    """Stop report deletion process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.stop_process(f"delete-report-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active delete process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Stopped report deletion for report {report_id}",
            "stopped": state.stopped,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}
