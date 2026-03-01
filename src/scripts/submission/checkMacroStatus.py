import asyncio
import traceback

from scripts.core.browser import spawn_new_browser
from scripts.core.httpClient import (
    find_report_and_collection,
    find_report_by_id,
    update_assets_by_index,
    update_macro_submit_state,
    update_multiple_macros,
    update_report_status_by_report_id,
)
from scripts.core.processControl import (
    check_and_wait,
    clear_process,
    create_process,
    get_process_manager,
    update_progress,
)
from scripts.core.utils import (
    safe_query_selector_all,
    wait_for_element,
    wait_for_table_rows,
)

# Status detection markers (similar to ElRajhi checker)
SENT_BUTTON_MARKER = 'id="reject"'
CONFIRMED_BUTTON_TEXT = "Ø´ÙØ§Ø¯Ø©"  # Certificate button text
INCOMPLETE_STATUS_MARKERS = (
    "\u063a\u064a\u0631 \u0645\u0643\u062a\u0645\u0644\u0629",
    "incomplete",
)

MAIN_PAGE_LOAD_WAIT_SECONDS = 0.35
PAGE_NAVIGATION_WAIT_SECONDS = 0.65
SUBPAGE_NEXT_WAIT_SECONDS = 0.35


def is_asset_complete(asset):
    val = asset.get("submitState")
    return val == 1 or val == "1" or val is True


def parse_submit_state(status_text):
    normalized = str(status_text or "").strip().lower()
    for marker in INCOMPLETE_STATUS_MARKERS:
        if marker.lower() in normalized:
            return 0
    return 1


def build_asset_maps(report):
    macro_index_map = {}
    macro_state_map = {}
    for idx, asset in enumerate(report.get("asset_data", []) or []):
        macro_id = asset.get("id")
        if macro_id is None:
            continue
        try:
            macro_id_int = int(str(macro_id).strip())
        except (TypeError, ValueError):
            continue
        macro_index_map[macro_id_int] = idx
        macro_state_map[macro_id_int] = 1 if is_asset_complete(asset) else 0
    return macro_index_map, macro_state_map


async def update_report_completion_status(report_id):
    """
    Update report completion status based on asset states
    """
    report, collection, _ = await find_report_and_collection(report_id)
    if not report:
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

    # Use HTTP client to update status
    await update_report_status_by_report_id(report_id, new_status)
    return new_status


async def detect_report_status(page):
    """
    Detect the overall report status by checking for specific markers.
    Returns: dict with status info
    """
    try:
        # Check for delete button (indicates COMPLETE)
        delete_btn = await wait_for_element(page, "#delete_report", timeout=5)

        # Get page HTML to check for SENT/CONFIRMED markers
        try:
            html = await page.get_content()
        except Exception:
            html = ""

        html_lower = html.lower() if isinstance(html, str) else ""

        # Check for SENT marker (reject button)
        has_sent_marker = (
            SENT_BUTTON_MARKER in html_lower or 'name="reject"' in html_lower
        )

        # Check for CONFIRMED marker (certificate button)
        has_confirmed_marker = isinstance(html, str) and CONFIRMED_BUTTON_TEXT in html

        # Determine status priority: CONFIRMED > SENT > COMPLETE > INCOMPLETE
        if has_confirmed_marker:
            status = "CONFIRMED"
        elif has_sent_marker:
            status = "SENT"
        elif delete_btn:
            status = "COMPLETE"
        else:
            status = "INCOMPLETE"

        return {
            "status": status,
            "has_delete_button": bool(delete_btn),
            "has_sent_marker": has_sent_marker,
            "has_confirmed_marker": has_confirmed_marker,
        }
    except Exception as e:
        print(f"[STATUS DETECT] Error detecting status: {e}")
        return {
            "status": "INCOMPLETE",
            "has_delete_button": False,
            "has_sent_marker": False,
            "has_confirmed_marker": False,
        }


async def check_incomplete_macros(browser, report_id, browsers_num=3):
    try:
        # First, fetch report to map macro IDs
        report, collection, _ = await find_report_and_collection(report_id)
        if not report:
            return {
                "status": "FAILED",
                "error": f"Report {report_id} not found in reports collections",
            }

        record_id = report["_id"]
        macro_index_map, macro_state_map = build_asset_maps(report)

        base_url = f"https://qima.taqeem.sa/report/{report_id}"
        main_page = await browser.get(base_url)
        await asyncio.sleep(MAIN_PAGE_LOAD_WAIT_SECONDS)

        # Enhanced status detection
        status_info = await detect_report_status(main_page)
        report_status = status_info["status"]

        print(f"[INFO] Report {report_id} overall status: {report_status}")
        print(
            f"[INFO] Status markers - Delete: {status_info['has_delete_button']}, Sent: {status_info['has_sent_marker']}, Confirmed: {status_info['has_confirmed_marker']}"
        )

        # Update report status in database via HTTP client
        await update_report_status_by_report_id(report_id, report_status)

        # If report has delete button OR is SENT/CONFIRMED, mark all assets as complete
        if status_info["has_delete_button"] or report_status in ["SENT", "CONFIRMED"]:
            print(f"[INFO] Report is {report_status}, marking all macros as complete.")

            # Prepare updates for all assets
            asset_updates = {}
            for i in range(len(report.get("asset_data", []))):
                asset_updates[i] = {"submitState": 1}

            # Update all assets via HTTP client
            await update_assets_by_index(record_id, asset_updates)
            await update_report_completion_status(report_id)

            return {
                "status": "SUCCESS",
                "incomplete_ids": [],
                "macro_count": 0,
                "message": f"All macros complete - Report status: {report_status}",
                "report_status": report_status,
                "status_markers": status_info,
            }

        # Get total number of pages from pagination
        pagination_links = await main_page.query_selector_all("ul.pagination li a")
        page_numbers = []

        for link in pagination_links:
            text = link.text
            if text and text.strip().isdigit():
                page_numbers.append(int(text.strip()))

        total_pages = int(max(page_numbers)) if page_numbers else 1
        print(f"[CHECK] Found {total_pages} pages to process with {browsers_num} tabs")

        # Create pages for parallel processing
        pages = [main_page] + [
            await browser.get("about:blank", new_tab=True)
            for _ in range(min(browsers_num - 1, total_pages - 1))
        ]

        # Balanced page distribution
        def get_balanced_page_distribution(total_pages, num_tabs):
            if total_pages <= 0 or num_tabs <= 0:
                return [[] for _ in range(num_tabs)]

            base_pages_per_tab = total_pages // num_tabs
            remainder = total_pages % num_tabs

            distribution = []
            current_page = 1

            for tab_index in range(num_tabs):
                pages_this_tab = base_pages_per_tab + (
                    1 if tab_index < remainder else 0
                )

                if pages_this_tab > 0:
                    tab_pages = list(range(current_page, current_page + pages_this_tab))
                    distribution.append(tab_pages)
                    current_page += pages_this_tab
                else:
                    distribution.append([])

            return distribution

        page_chunks = get_balanced_page_distribution(total_pages, len(pages))

        print(
            f"[CHECK] Page distribution: {[len(chunk) for chunk in page_chunks]} pages per tab"
        )

        incomplete_ids = set()
        incomplete_ids_lock = asyncio.Lock()

        # Track all processed macros to avoid duplicate work across tabs/sub-pages
        all_processed_macros = set()
        processed_macros_lock = asyncio.Lock()

        # Process ID for pause/resume control
        process_id = f"full-check-{report_id}"
        process_manager = get_process_manager()

        # Create process state
        process_state = create_process(
            process_id=process_id,
            process_type="full-check",
            total=total_pages,
            report_id=report_id,
            browsers_num=browsers_num,
        )

        async def process_pages_chunk(page, page_numbers_chunk, tab_id):
            local_incomplete = set()
            local_processed = set()

            print(f"[TAB-{tab_id}] Processing pages: {page_numbers_chunk}")

            for page_num in page_numbers_chunk:
                print(f"[TAB-{tab_id}] Processing page {page_num}")

                try:
                    # Check pause/stop state
                    action = await check_and_wait(process_id)
                    if action == "stop":
                        print(f"[TAB-{tab_id}] Process stopped by user request")
                        break

                    # Navigate to the specific page
                    page_url = (
                        f"{base_url}?page={page_num}" if page_num > 1 else base_url
                    )
                    await page.get(page_url)
                    await asyncio.sleep(PAGE_NAVIGATION_WAIT_SECONDS)

                    # Update progress
                    await update_progress(process_id, completed=page_num, emit=True)

                    # Inner loop for table sub-pages (internal pagination)
                    while True:
                        # Check pause/stop state
                        action = await check_and_wait(process_id)
                        if action == "stop":
                            print(f"[TAB-{tab_id}] Process stopped by user request")
                            break

                        # Wait for table to load
                        table_ready = await wait_for_table_rows(page, timeout=100)
                        if not table_ready:
                            print(
                                f"[TAB-{tab_id}] Timeout waiting for table rows on page {page_num}"
                            )
                            break

                        macro_cells = await safe_query_selector_all(
                            page, "#m-table tbody tr td:nth-child(1) a"
                        )
                        status_cells = await safe_query_selector_all(
                            page, "#m-table tbody tr td:nth-child(6)"
                        )

                        processed_count = 0
                        incomplete_count = 0
                        index_updates = {}
                        macro_updates = []

                        for i in range(len(macro_cells)):
                            try:
                                # Check pause/stop state
                                action = await check_and_wait(process_id)
                                if action == "stop":
                                    print(
                                        f"[TAB-{tab_id}] Process stopped by user request"
                                    )
                                    break

                                if i >= len(status_cells):
                                    break

                                macro_cell = macro_cells[i]
                                status_cell = status_cells[i]

                                macro_id_text = macro_cell.text if macro_cell else None
                                status_text = status_cell.text if status_cell else ""

                                if not macro_id_text or not macro_id_text.strip():
                                    continue

                                macro_id = int(macro_id_text.strip())
                                async with processed_macros_lock:
                                    if macro_id in all_processed_macros:
                                        continue
                                    all_processed_macros.add(macro_id)

                                local_processed.add(macro_id)

                                submit_state = parse_submit_state(status_text)

                                previous_state = macro_state_map.get(macro_id)
                                if (
                                    previous_state is not None
                                    and previous_state == submit_state
                                ):
                                    processed_count += 1
                                    if submit_state == 0:
                                        local_incomplete.add(macro_id)
                                        incomplete_count += 1
                                    continue

                                macro_state_map[macro_id] = submit_state
                                asset_index = macro_index_map.get(macro_id)
                                if asset_index is not None:
                                    index_updates[asset_index] = {
                                        "submitState": submit_state
                                    }
                                else:
                                    macro_updates.append(
                                        {
                                            "macro_id": macro_id,
                                            "submitState": submit_state,
                                        }
                                    )

                                processed_count += 1

                                if submit_state == 0:
                                    local_incomplete.add(macro_id)
                                    incomplete_count += 1

                            except (ValueError, TypeError) as e:
                                print(
                                    f"[TAB-{tab_id}] WARNING Invalid macro ID on row {i}: {e}"
                                )
                                continue
                            except Exception as e:
                                print(f"[TAB-{tab_id}] ERROR processing row {i}: {e}")
                                continue

                        if index_updates:
                            await update_assets_by_index(record_id, index_updates)

                        if macro_updates:
                            await update_multiple_macros(report_id, macro_updates)

                        print(
                            f"[TAB-{tab_id}] Page {page_num}: Processed {processed_count} macros, {incomplete_count} incomplete"
                        )

                        # Check for next button
                        next_btn = await wait_for_element(
                            page, "#m-table_next", timeout=5
                        )
                        if next_btn:
                            attributes = next_btn.attrs
                            classes = str(attributes.get("class_") or "")
                            if "disabled" not in classes:
                                print(
                                    f"[TAB-{tab_id}] Clicking next sub-page button on page {page_num}"
                                )
                                await next_btn.click()
                                await asyncio.sleep(SUBPAGE_NEXT_WAIT_SECONDS)
                                continue

                        # No more sub-pages, break inner loop
                        print(f"[TAB-{tab_id}] No more sub-pages on page {page_num}")
                        break

                except Exception as e:
                    print(f"[TAB-{tab_id}] ERROR processing page {page_num}: {str(e)}")
                    continue

            async with incomplete_ids_lock:
                incomplete_ids.update(local_incomplete)

            print(
                f"[TAB-{tab_id}] Completed processing, found {len(local_incomplete)} incomplete macros, processed {len(local_processed)} total macros"
            )

        # Process pages in parallel
        tasks = []
        for i, (page, chunk) in enumerate(zip(pages, page_chunks)):
            if chunk:  # Only create tasks for tabs that have pages to process
                tasks.append(process_pages_chunk(page, chunk, i))

        # Process pages in parallel
        await asyncio.gather(*tasks)

        # Close extra tabs
        for p in pages[1:]:
            await p.close()

        # Clear process state
        clear_process(process_id)
        await update_report_completion_status(report_id)
        unique_incomplete_ids = sorted(incomplete_ids)

        return {
            "status": "SUCCESS",
            "incomplete_ids": unique_incomplete_ids,
            "macro_count": len(unique_incomplete_ids),
            "total_pages_processed": total_pages,
            "tabs_used": len(pages),
            "total_macros_processed": len(all_processed_macros),
            "report_status": report_status,
            "status_markers": status_info,
        }

    except Exception as e:
        tb = traceback.format_exc()
        print("[CHECK] Error:", tb)
        # Clear process state on error
        if "process_id" in locals():
            clear_process(process_id)
        return {"status": "FAILED", "error": str(e), "traceback": tb}


async def half_check_incomplete_macros(browser, report_id, browsers_num=3):
    try:
        print(f"[HALF CHECK] Starting optimized half check for report {report_id}")

        # First, fetch report to get incomplete macros and their page numbers
        report, collection, _ = await find_report_and_collection(report_id)
        if not report:
            return {
                "status": "FAILED",
                "error": f"Report {report_id} not found in reports collections",
            }

        record_id = report["_id"]

        # Enhanced status detection
        base_url = f"https://qima.taqeem.sa/report/{report_id}"
        main_page = await browser.get(base_url)
        await asyncio.sleep(1)

        status_info = await detect_report_status(main_page)
        report_status = status_info["status"]

        print(f"[HALF CHECK] Report {report_id} overall status: {report_status}")

        # Update report status in database via HTTP client
        await update_report_status_by_report_id(report_id, report_status)

        # If report has delete button OR is SENT/CONFIRMED, mark all assets as complete
        if status_info["has_delete_button"] or report_status in ["SENT", "CONFIRMED"]:
            print(
                f"[HALF CHECK] Report is {report_status}, marking all macros as complete."
            )

            # Prepare updates for all assets
            asset_updates = {}
            for i in range(len(report.get("asset_data", []))):
                asset_updates[i] = {"submitState": 1}

            # Update all assets via HTTP client
            await update_assets_by_index(record_id, asset_updates)
            await update_report_completion_status(report_id)

            return {
                "status": "SUCCESS",
                "incomplete_ids": [],
                "macro_count": 0,
                "message": f"All macros complete - Report status: {report_status}",
                "report_status": report_status,
                "status_markers": status_info,
            }

        # Collect incomplete macro IDs and their page numbers
        incomplete_macro_ids = set()
        incomplete_page_numbers = set()

        asset_data = report.get("asset_data", [])
        for asset in asset_data:
            if asset.get("submitState") == 0:
                macro_id = asset.get("id")
                # Convert to int for consistent comparison
                try:
                    incomplete_macro_ids.add(int(macro_id))
                except (ValueError, TypeError):
                    print(f"[HALF CHECK] WARNING: Invalid macro_id in DB: {macro_id}")
                    continue

                # Get page number from pg_no field
                pg_no = asset.get("pg_no")
                if pg_no is not None:
                    incomplete_page_numbers.add(int(pg_no))

        print(
            f"[HALF CHECK] Found {len(incomplete_macro_ids)} incomplete macros in DB: {sorted(list(incomplete_macro_ids))[:10]}..."
        )
        print(
            f"[HALF CHECK] Found {len(incomplete_page_numbers)} unique pages with incomplete macros: {sorted(incomplete_page_numbers)}"
        )

        # If no incomplete macros in DB, return early
        if not incomplete_macro_ids:
            return {
                "status": "SUCCESS",
                "incomplete_ids": [],
                "macro_count": 0,
                "total_pages_processed": 0,
                "tabs_used": 1,
                "total_macros_processed": 0,
                "message": "No incomplete macros found in database",
                "report_status": report_status,
                "status_markers": status_info,
            }

        # Get total number of pages from pagination
        pagination_links = await main_page.query_selector_all("ul.pagination li a")
        page_numbers = []

        for link in pagination_links:
            text = link.text
            if text and text.strip().isdigit():
                page_numbers.append(int(text.strip()))

        total_pages = max(page_numbers) if page_numbers else 1
        print(
            f"[HALF CHECK] Total pages available: {total_pages}, will process {len(incomplete_page_numbers)} pages with incomplete macros"
        )

        # Only process pages that contain incomplete macros
        target_pages = [p for p in sorted(incomplete_page_numbers) if p <= total_pages]

        # If no valid target pages, return
        if not target_pages:
            print(
                f"[HALF CHECK] No valid target pages found within total pages {total_pages}"
            )
            return {
                "status": "SUCCESS",
                "incomplete_ids": [],
                "macro_count": 0,
                "total_pages_processed": 0,
                "tabs_used": 1,
                "total_macros_processed": 0,
                "message": "No valid pages with incomplete macros found",
                "report_status": report_status,
                "status_markers": status_info,
            }

        print(
            f"[HALF CHECK] Will process {len(target_pages)} pages: {target_pages} with {browsers_num} tabs"
        )

        # Create pages for parallel processing
        pages_needed = min(browsers_num, len(target_pages))
        pages = [main_page] + [
            await browser.get("about:blank", new_tab=True)
            for _ in range(pages_needed - 1)
        ]

        # Use balanced distribution
        def get_balanced_page_distribution(total_pages, num_tabs):
            if total_pages <= 0 or num_tabs <= 0:
                return [[] for _ in range(num_tabs)]

            base_pages_per_tab = total_pages // num_tabs
            remainder = total_pages % num_tabs

            distribution = []
            current_page = 1

            for tab_index in range(num_tabs):
                pages_this_tab = base_pages_per_tab + (
                    1 if tab_index < remainder else 0
                )

                if pages_this_tab > 0:
                    tab_pages = list(range(current_page, current_page + pages_this_tab))
                    distribution.append(tab_pages)
                    current_page += pages_this_tab
                else:
                    distribution.append([])

            return distribution

        page_chunks = get_balanced_page_distribution(len(target_pages), len(pages))

        # Map distribution indices to actual page numbers
        actual_page_chunks = []
        current_index = 0
        for chunk in page_chunks:
            chunk_size = len(chunk)
            if chunk_size > 0:
                actual_chunk = target_pages[current_index : current_index + chunk_size]
                actual_page_chunks.append(actual_chunk)
                current_index += chunk_size
            else:
                actual_page_chunks.append([])

        print(
            f"[HALF CHECK] Page distribution: {[len(chunk) for chunk in actual_page_chunks]} pages per tab"
        )

        incomplete_ids = []
        incomplete_ids_lock = asyncio.Lock()

        all_processed_macros = set()
        processed_macros_lock = asyncio.Lock()

        process_id = f"half-check-{report_id}"
        process_manager = get_process_manager()

        process_state = create_process(
            process_id=process_id,
            process_type="half-check",
            total=len(target_pages),
            report_id=report_id,
            browsers_num=browsers_num,
            target_pages_count=len(target_pages),
            incomplete_macros_count=len(incomplete_macro_ids),
        )

        async def process_pages_chunk(page, page_numbers_chunk, tab_id):
            local_incomplete = []
            local_processed = set()
            local_skipped = 0

            print(f"[HALF-TAB-{tab_id}] Processing pages: {page_numbers_chunk}")

            for page_num_idx, page_num in enumerate(page_numbers_chunk):
                print(f"[HALF-TAB-{tab_id}] Processing page {page_num}")

                try:
                    action = await check_and_wait(process_id)
                    if action == "stop":
                        print(f"[HALF-TAB-{tab_id}] Process stopped by user request")
                        break

                    page_url = (
                        f"{base_url}?page={page_num}" if page_num > 1 else base_url
                    )
                    await page.get(page_url)
                    await asyncio.sleep(2)

                    await update_progress(
                        process_id, completed=page_num_idx + 1, emit=True
                    )

                    while True:
                        action = await check_and_wait(process_id)
                        if action == "stop":
                            print(
                                f"[HALF-TAB-{tab_id}] Process stopped by user request"
                            )
                            break

                        table_ready = await wait_for_table_rows(page, timeout=100)
                        if not table_ready:
                            print(
                                f"[HALF-TAB-{tab_id}] Timeout waiting for table rows on page {page_num}"
                            )
                            break

                        await asyncio.sleep(3)
                        macro_cells = await safe_query_selector_all(
                            page, "#m-table tbody tr td:nth-child(1) a"
                        )
                        status_cells = await safe_query_selector_all(
                            page, "#m-table tbody tr td:nth-child(6)"
                        )

                        processed_count = 0
                        incomplete_count = 0

                        for i in range(len(macro_cells)):
                            try:
                                action = await check_and_wait(process_id)
                                if action == "stop":
                                    print(
                                        f"[HALF-TAB-{tab_id}] Process stopped by user request"
                                    )
                                    break

                                if i >= len(status_cells):
                                    break

                                macro_cell = macro_cells[i]
                                status_cell = status_cells[i]

                                macro_id_text = macro_cell.text if macro_cell else None
                                status_text = status_cell.text if status_cell else ""

                                if not macro_id_text or not macro_id_text.strip():
                                    continue

                                macro_id = int(macro_id_text.strip())

                                # Only process incomplete macros
                                if macro_id not in incomplete_macro_ids:
                                    local_skipped += 1
                                    continue

                                local_processed.add(macro_id)
                                submit_state = parse_submit_state(status_text)

                                # Update via HTTP client
                                success = await update_macro_submit_state(
                                    record_id, macro_id, submit_state
                                )

                                if not success:
                                    # Fetch fresh report data
                                    report_after, _, _ = await find_report_by_id(
                                        record_id
                                    )
                                    if report_after:
                                        asset_data = report_after.get("asset_data", [])
                                        for idx, asset in enumerate(asset_data):
                                            if (
                                                asset.get("id") == str(macro_id)
                                                or asset.get("id") == macro_id
                                            ):
                                                # Use update_assets_by_index
                                                await update_assets_by_index(
                                                    record_id,
                                                    {
                                                        idx: {
                                                            "submitState": submit_state
                                                        }
                                                    },
                                                )
                                                print(
                                                    f"[HALF-TAB-{tab_id}] Updated Macro {macro_id} using index {idx}"
                                                )
                                                break

                                print(
                                    f"[HALF-TAB-{tab_id}] Processed Macro {macro_id} on page {page_num}, submitState={submit_state}"
                                )

                                processed_count += 1

                                if submit_state == 0:
                                    print(
                                        f"[HALF-TAB-{tab_id}] STILL INCOMPLETE Macro {macro_id} on page {page_num}"
                                    )
                                    local_incomplete.append(macro_id)
                                    incomplete_count += 1
                                else:
                                    print(
                                        f"[HALF-TAB-{tab_id}] NOW COMPLETE Macro {macro_id} on page {page_num}"
                                    )

                            except (ValueError, TypeError) as e:
                                print(
                                    f"[HALF-TAB-{tab_id}] WARNING Invalid macro ID on row {i}: {e}"
                                )
                                continue
                            except Exception as e:
                                print(
                                    f"[HALF-TAB-{tab_id}] ERROR processing row {i}: {e}"
                                )
                                continue

                        print(
                            f"[HALF-TAB-{tab_id}] Page {page_num}: Processed {processed_count} target macros, {incomplete_count} still incomplete, skipped {local_skipped} non-target macros"
                        )

                        next_btn = await wait_for_element(
                            page, "#m-table_next", timeout=5
                        )
                        if next_btn:
                            attributes = next_btn.attrs
                            classes = attributes.get("class_")
                            if "disabled" not in classes:
                                print(
                                    f"[HALF-TAB-{tab_id}] Clicking next sub-page button on page {page_num}"
                                )
                                await next_btn.click()
                                await asyncio.sleep(2)
                                continue

                        print(
                            f"[HALF-TAB-{tab_id}] No more sub-pages on page {page_num}"
                        )
                        break

                except Exception as e:
                    print(
                        f"[HALF-TAB-{tab_id}] ERROR processing page {page_num}: {str(e)}"
                    )
                    continue

            async with incomplete_ids_lock:
                incomplete_ids.extend(local_incomplete)

            async with processed_macros_lock:
                all_processed_macros.update(local_processed)

            print(
                f"[HALF-TAB-{tab_id}] Completed processing, found {len(local_incomplete)} still incomplete, processed {len(local_processed)} target macros, skipped {local_skipped} non-target macros"
            )

        tasks = []
        for i, (page, chunk) in enumerate(zip(pages, actual_page_chunks)):
            if chunk:
                tasks.append(process_pages_chunk(page, chunk, i))

        await asyncio.gather(*tasks)

        for p in pages[1:]:
            await p.close()

        missing_macros = incomplete_macro_ids - all_processed_macros
        if missing_macros:
            print(
                f"[HALF CHECK] WARNING: {len(missing_macros)} incomplete macros not found on their expected pages: {sorted(list(missing_macros))}"
            )
            # Mark missing macros as complete via HTTP client
            for macro_id in missing_macros:
                await update_macro_submit_state(record_id, macro_id, 1)
                print(f"[HALF CHECK] Marked missing macro {macro_id} as complete")

        clear_process(process_id)
        await update_report_completion_status(report_id)

        return {
            "status": "SUCCESS",
            "incomplete_ids": incomplete_ids,
            "macro_count": len(incomplete_ids),
            "total_pages_processed": len(target_pages),
            "tabs_used": len(pages),
            "total_macros_processed": len(all_processed_macros),
            "missing_macros_found": len(missing_macros) if missing_macros else 0,
            "report_status": report_status,
            "status_markers": status_info,
        }

    except Exception as e:
        tb = traceback.format_exc()
        print("[HALF CHECK] Error:", tb)
        if "process_id" in locals():
            clear_process(process_id)
        return {"status": "FAILED", "error": str(e), "traceback": tb}


async def RunCheckMacroStatus(browser, report_id, tabs_num=3, same=False):
    if same and not browser:
        raise ValueError("same=True requires an existing browser")

    new_browser = None
    browser_to_use = None

    try:
        if not same:
            new_browser = await spawn_new_browser(browser)
            browser_to_use = new_browser
        else:
            browser_to_use = browser

        return await check_incomplete_macros(browser_to_use, report_id, tabs_num)

    finally:
        if new_browser:
            new_browser.stop()


async def RunHalfCheckMacroStatus(browser, report_id, tabs_num=3, same=False):
    if same and not browser:
        raise ValueError("same=True requires an existing browser")

    new_browser = None
    browser_to_use = None
    try:
        if not same:
            new_browser = await spawn_new_browser(browser)
            browser_to_use = new_browser
        else:
            browser_to_use = browser

        return await half_check_incomplete_macros(browser_to_use, report_id, tabs_num)

    finally:
        if new_browser:
            new_browser.stop()


# ==============================
# Pause/Resume/Stop handlers for both full and half checks
# ==============================


async def pause_full_check(report_id):
    """Pause full check process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.pause_process(f"full-check-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active full check process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Paused full check for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def resume_full_check(report_id):
    """Resume full check process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.resume_process(f"full-check-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active full check process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Resumed full check for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def stop_full_check(report_id):
    """Stop full check process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.stop_process(f"full-check-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active full check process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Stopped full check for report {report_id}",
            "stopped": state.stopped,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def pause_half_check(report_id):
    """Pause half check process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.pause_process(f"half-check-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active half check process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Paused half check for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def resume_half_check(report_id):
    """Resume half check process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.resume_process(f"half-check-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active half check process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Resumed half check for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def stop_half_check(report_id):
    """Stop half check process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.stop_process(f"half-check-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active half check process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Stopped half check for report {report_id}",
            "stopped": state.stopped,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}
