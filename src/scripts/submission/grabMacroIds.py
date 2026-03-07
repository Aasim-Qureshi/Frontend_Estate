import asyncio
import sys

from scripts.core.httpClient import (
    find_report_and_collection,
    update_report_pg_count,
    update_report_with_macro_ids,
)
from scripts.core.processControl import (
    check_and_wait,
    clear_process,
    create_process,
    emit_progress,
    get_process_manager,
    update_progress,
)
from scripts.core.utils import (
    safe_query_selector_all,
    wait_for_element,
    wait_for_table_rows,
)


async def update_report_with_macro_ids_wrapper(report_id, macro_ids_with_pages):
    """
    Update report with macro IDs and page numbers using API

    Args:
        report_id: The report ID
        macro_ids_with_pages: List of tuples [(macro_id, page_num), ...]
    """
    try:
        print(
            f"[API] Updating report {report_id} with {len(macro_ids_with_pages)} macro IDs",
            file=sys.stderr,
        )

        success = await update_report_with_macro_ids(report_id, macro_ids_with_pages)

        if success:
            print(f"[API] Successfully updated report {report_id}", file=sys.stderr)
            return True
        else:
            print(f"[API] Failed to update report {report_id}", file=sys.stderr)
            return False

    except Exception as e:
        print(f"[API] Error updating report with macro IDs: {str(e)}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        return False


async def update_report_pg_count_wrapper(report_id, pg_count):
    """
    Update the report document's pg_count field using API

    Args:
        report_id: The report ID
        pg_count: Number of pages
    """
    try:
        success = await update_report_pg_count(report_id, pg_count)

        if success:
            print(
                f"[API] Successfully updated pg_count={pg_count} for report {report_id}",
                file=sys.stderr,
            )
        else:
            print(
                f"[API] Failed to update pg_count for report {report_id}",
                file=sys.stderr,
            )

        return success

    except Exception as e:
        print(f"[API] Error updating pg_count: {str(e)}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        return False


def get_balanced_page_distribution(total_pages, num_tabs):
    """
    Distribute pages evenly across tabs

    Args:
        total_pages: Total number of pages to process
        num_tabs: Number of browser tabs available

    Returns:
        List of lists, where each inner list contains page numbers for that tab
    """
    if total_pages <= 0 or num_tabs <= 0:
        return [[] for _ in range(num_tabs)]

    base_pages_per_tab = total_pages // num_tabs
    remainder = total_pages % num_tabs

    distribution = []
    current_page = 1

    for tab_index in range(num_tabs):
        pages_this_tab = base_pages_per_tab + (1 if tab_index < remainder else 0)

        if pages_this_tab > 0:
            tab_pages = list(range(current_page, current_page + pages_this_tab))
            distribution.append(tab_pages)
            current_page += pages_this_tab
        else:
            distribution.append([])

    return distribution


async def get_macro_ids_from_page(page, base_url, page_num, tab_id, process_id=None):
    local_macro_ids = []
    print(f"[MACRO_ID-TAB-{tab_id}] Processing page {page_num}", file=sys.stderr)

    try:
        # Check pause/stop state
        if process_id:
            action = await check_and_wait(process_id)
            if action == "stop":
                print(
                    f"[MACRO_ID-TAB-{tab_id}] Process stopped by user request",
                    file=sys.stderr,
                )
                return local_macro_ids

        # Navigate to the page
        page_url = f"{base_url}?page={page_num}" if page_num > 1 else base_url
        await page.get(page_url)
        await asyncio.sleep(2)

        # Process all sub-pages (internal pagination)
        while True:
            # Check pause/stop state
            if process_id:
                action = await check_and_wait(process_id)
                if action == "stop":
                    print(
                        f"[MACRO_ID-TAB-{tab_id}] Process stopped by user request",
                        file=sys.stderr,
                    )
                    return local_macro_ids

            await asyncio.sleep(2)

            table_ready = await wait_for_table_rows(page, timeout=100)
            if not table_ready:
                print(
                    f"[MACRO_ID-TAB-{tab_id}] Table not found on page {page_num}, breaking",
                    file=sys.stderr,
                )
                break

            await asyncio.sleep(3)

            macro_cells = await safe_query_selector_all(
                page, "#m-table tbody tr td:nth-child(1) a"
            )

            if not macro_cells:
                print(
                    f"[MACRO_ID-TAB-{tab_id}] No macro cells found on page {page_num}, breaking",
                    file=sys.stderr,
                )
                break

            processed_count = 0
            for i, macro_cell in enumerate(macro_cells):
                # Check pause/stop state periodically
                if process_id and i % 5 == 0:
                    action = await check_and_wait(process_id)
                    if action == "stop":
                        print(
                            f"[MACRO_ID-TAB-{tab_id}] Process stopped by user request",
                            file=sys.stderr,
                        )
                        return local_macro_ids

                try:
                    macro_id_text = macro_cell.text if macro_cell else None
                    if not macro_id_text or not macro_id_text.strip():
                        continue

                    macro_id = int(macro_id_text.strip())
                    local_macro_ids.append((macro_id, page_num))
                    processed_count += 1

                except (ValueError, TypeError) as e:
                    print(
                        f"[MACRO_ID-TAB-{tab_id}] WARNING Invalid macro ID on row {i}: {e}",
                        file=sys.stderr,
                    )
                    continue
                except Exception as e:
                    print(
                        f"[MACRO_ID-TAB-{tab_id}] ERROR processing row {i}: {e}",
                        file=sys.stderr,
                    )
                    continue

            print(
                f"[MACRO_ID-TAB-{tab_id}] Page {page_num}: Found {processed_count} macro IDs",
                file=sys.stderr,
            )

            # Check for next button (internal pagination)
            next_btn = await wait_for_element(page, "#m-table_next", timeout=5)
            if next_btn:
                attributes = next_btn.attrs
                classes = attributes.get("class_")
                if classes and "disabled" not in classes:
                    print(
                        f"[MACRO_ID-TAB-{tab_id}] Clicking next sub-page button on page {page_num}",
                        file=sys.stderr,
                    )
                    await next_btn.click()
                    await asyncio.sleep(3)
                    continue

            print(
                f"[MACRO_ID-TAB-{tab_id}] No more sub-pages on page {page_num}",
                file=sys.stderr,
            )
            break

    except Exception as e:
        print(
            f"[MACRO_ID-TAB-{tab_id}] Error processing page {page_num}: {str(e)}",
            file=sys.stderr,
        )

    return local_macro_ids


async def get_all_macro_ids_parallel(browser, report_id, tabs_num=3):
    try:
        if not report_id:
            print("[MACRO_ID] No report_id provided", file=sys.stderr)
            return []

        # Create process state for pause/resume/stop
        process_id = f"grab-macro-ids-{report_id}"
        process_manager = get_process_manager()
        process_state = create_process(
            process_id=process_id,
            process_type="grab-macro-ids",
            total=100,  # We'll update this once we know total pages
            report_id=report_id,
            tabs_num=tabs_num,
        )

        base_url = f"https://qima.taqeem.gov.sa/report/{report_id}"
        main_page = browser.tabs[0]
        await main_page.get(base_url)
        await asyncio.sleep(2)

        await wait_for_element(main_page, "li", timeout=30)

        # Get total number of pages from pagination
        pagination_links = await main_page.query_selector_all("ul.pagination li a")
        page_numbers = []
        for link in pagination_links:
            text = link.text
            if text and text.strip().isdigit():
                page_numbers.append(int(text.strip()))

        total_pages = max(page_numbers) if page_numbers else 1
        print(f"[MACRO_ID] Found {total_pages} pages to scan", file=sys.stderr)

        # Update total in process state
        await update_progress(
            process_id, completed=0, failed=0, total=total_pages, emit=True
        )

        await update_report_pg_count_wrapper(report_id, total_pages)

        # Create pages for parallel processing
        pages = [main_page] + [
            await browser.get("about:blank", new_tab=True)
            for _ in range(min(tabs_num - 1, total_pages - 1))
        ]

        # Distribute pages across tabs
        page_chunks = get_balanced_page_distribution(total_pages, len(pages))
        print(
            f"[MACRO_ID] Page distribution: {[len(chunk) for chunk in page_chunks]} pages per tab",
            file=sys.stderr,
        )

        all_macro_ids_with_pages = []
        macro_ids_lock = asyncio.Lock()

        async def process_pages_chunk(page, page_numbers_chunk, tab_id):
            """Process a chunk of pages in a single tab"""
            local_macro_ids_with_pages = []
            print(
                f"[MACRO_ID-TAB-{tab_id}] Processing pages: {page_numbers_chunk}",
                file=sys.stderr,
            )

            for page_num in page_numbers_chunk:
                # Check pause/stop state before processing each page
                action = await check_and_wait(process_id)
                if action == "stop":
                    print(
                        f"[MACRO_ID-TAB-{tab_id}] Process stopped by user request",
                        file=sys.stderr,
                    )
                    break

                page_macro_ids = await get_macro_ids_from_page(
                    page, base_url, page_num, tab_id, process_id
                )
                local_macro_ids_with_pages.extend(page_macro_ids)

                # Update progress after each page
                async with macro_ids_lock:
                    current_total = len(all_macro_ids_with_pages) + len(
                        local_macro_ids_with_pages
                    )

                await update_progress(
                    process_id,
                    completed=len(
                        page_numbers_chunk[: page_numbers_chunk.index(page_num) + 1]
                    ),
                    emit=True,
                )
                emit_progress(
                    process_id,
                    current_item=f"Page {page_num}",
                    message=f"Processed page {page_num}",
                )

            async with macro_ids_lock:
                all_macro_ids_with_pages.extend(local_macro_ids_with_pages)

            print(
                f"[MACRO_ID-TAB-{tab_id}] Completed processing, found {len(local_macro_ids_with_pages)} macro IDs",
                file=sys.stderr,
            )

        # Process pages in parallel
        tasks = []
        for i, (page, chunk) in enumerate(zip(pages, page_chunks)):
            if chunk:
                tasks.append(process_pages_chunk(page, chunk, i))

        await asyncio.gather(*tasks)

        # Close extra tabs
        for p in pages[1:]:
            await p.close()

        print(
            f"[MACRO_ID] ID collection complete. Found {len(all_macro_ids_with_pages)} macro IDs",
            file=sys.stderr,
        )

        # Update report with the collected data via API
        if all_macro_ids_with_pages:
            success = await update_report_with_macro_ids_wrapper(
                report_id, all_macro_ids_with_pages
            )
            if success:
                print("[MACRO_ID] Successfully updated report via API", file=sys.stderr)
            else:
                print("[MACRO_ID] Failed to update report via API", file=sys.stderr)

        clear_process(process_id)

        return {"status": "SUCCESS", "macro_ids_with_pages": all_macro_ids_with_pages}

    except Exception as e:
        print(
            f"[MACRO_ID] Error in get_all_macro_ids_parallel: {str(e)}", file=sys.stderr
        )
        import traceback

        traceback.print_exc()

        # Clear process on error
        process_id = f"grab-macro-ids-{report_id}"
        clear_process(process_id)

        return {"status": "FAILED", "error": str(e)}


async def retry_get_missing_macro_ids(browser, report_id, tabs_num=3):
    """
    Retry version: only process pages for which assets in the report are missing pg_no / id.
    """
    try:
        # Create process state for pause/resume/stop
        process_id = f"retry-macro-ids-{report_id}"
        process_manager = get_process_manager()
        process_state = create_process(
            process_id=process_id,
            process_type="retry-macro-ids",
            total=100,  # We'll update this once we know missing pages
            report_id=report_id,
            tabs_num=tabs_num,
        )

        # Load the report document via API
        report, collection_name, _ = await find_report_and_collection(report_id)
        if not report:
            print(
                f"[API] ERROR: Report with ID {report_id} not found",
                file=sys.stderr,
            )
            clear_process(process_id)
            return {
                "status": "FAILED",
                "error": f"Report with ID {report_id} not found",
            }

        existing_assets = report.get("asset_data", [])
        if not existing_assets:
            print(
                f"[API] ERROR: No asset_data found in report {report_id}",
                file=sys.stderr,
            )
            clear_process(process_id)
            return {
                "status": "FAILED",
                "error": f"No asset_data found in report {report_id}",
            }

        # Determine total pages from live site
        base_url = f"https://qima.taqeem.gov.sa/report/{report_id}"
        main_page = browser.tabs[0]
        await main_page.get(base_url)
        await asyncio.sleep(2)
        await wait_for_element(main_page, "li", timeout=30)
        pagination_links = await main_page.query_selector_all("ul.pagination li a")
        page_numbers = []
        for link in pagination_links:
            text = link.text
            if text and text.strip().isdigit():
                page_numbers.append(int(text.strip()))
        total_pages = max(page_numbers) if page_numbers else 1
        print(f"[RETRY] Found {total_pages} total pages", file=sys.stderr)
        await update_report_pg_count_wrapper(report_id, total_pages)

        # Find which pg_no are already present in existing_assets
        present_pg_nos = set()
        for asset in existing_assets:
            pg = asset.get("pg_no")
            if pg is not None:
                try:
                    present_pg_nos.add(int(pg))
                except ValueError:
                    pass

        # Calculate missing page numbers
        all_pg_nos = set(range(1, total_pages + 1))
        missing_pg_nos = sorted(all_pg_nos - present_pg_nos)

        if not missing_pg_nos:
            print(
                f"[RETRY] No missing pages to retry for report {report_id}",
                file=sys.stderr,
            )
            clear_process(process_id)
            return {"status": "NO_MISSING_PAGES", "macro_ids_with_pages": []}

        print(
            f"[RETRY] Missing page numbers to process: {missing_pg_nos}",
            file=sys.stderr,
        )

        # Update total in process state
        await update_progress(
            process_id, completed=0, failed=0, total=len(missing_pg_nos), emit=True
        )

        # Prepare tabs
        pages = [main_page] + [
            await browser.get("about:blank", new_tab=True)
            for _ in range(min(tabs_num - 1, len(missing_pg_nos)))
        ]
        page_chunks = get_balanced_page_distribution(len(missing_pg_nos), len(pages))
        # Map distribution indices to actual page numbers
        pg_iter = iter(missing_pg_nos)
        page_chunks = [[next(pg_iter) for _ in chunk] for chunk in page_chunks]

        all_macro_ids_with_pages = []
        macro_ids_lock = asyncio.Lock()

        async def process_pages_chunk(page, page_numbers_chunk, tab_id):
            local = []
            for idx, pg in enumerate(page_numbers_chunk):
                # Check pause/stop state before processing each page
                action = await check_and_wait(process_id)
                if action == "stop":
                    print(
                        f"[RETRY-TAB-{tab_id}] Process stopped by user request",
                        file=sys.stderr,
                    )
                    break

                ids = await get_macro_ids_from_page(
                    page, base_url, pg, tab_id, process_id
                )
                local.extend(ids)

                # Update progress
                async with macro_ids_lock:
                    current_total = len(all_macro_ids_with_pages) + len(local)

                await update_progress(
                    process_id, completed=len(page_numbers_chunk[: idx + 1]), emit=True
                )
                emit_progress(
                    process_id,
                    current_item=f"Page {pg}",
                    message=f"Processed page {pg}",
                )

            async with macro_ids_lock:
                all_macro_ids_with_pages.extend(local)
            print(
                f"[RETRY-TAB-{tab_id}] Completed pages {page_numbers_chunk}, found {len(local)} macro IDs",
                file=sys.stderr,
            )

        tasks = []
        for i, (page, chunk) in enumerate(zip(pages, page_chunks)):
            if chunk:
                tasks.append(process_pages_chunk(page, chunk, i))
        await asyncio.gather(*tasks)

        for p in pages[1:]:
            await p.close()

        if all_macro_ids_with_pages:
            # Merge with existing data
            # Build a map page_no -> list of macro_ids
            by_page = {}
            for macro_id, pg in all_macro_ids_with_pages:
                by_page.setdefault(pg, []).append(macro_id)

            # Update existing asset_data list
            updated_assets = []
            for asset in existing_assets:
                if asset.get("pg_no") in (None, "", 0):
                    # Find next available macro_id for missing page
                    for pg, id_list in by_page.items():
                        if id_list:
                            new_id = id_list.pop(0)
                            asset = asset.copy()
                            asset["id"] = str(new_id)
                            asset["pg_no"] = str(pg)
                            break
                    updated_assets.append(asset)
                else:
                    updated_assets.append(asset)

            # Convert to the format expected by the API
            macro_ids_for_update = []
            for asset in updated_assets:
                macro_id = asset.get("id")
                pg_no = asset.get("pg_no")
                if macro_id and pg_no:
                    try:
                        macro_ids_for_update.append((int(macro_id), int(pg_no)))
                    except (ValueError, TypeError):
                        pass

            # Update via API
            success = await update_report_with_macro_ids_wrapper(
                report_id, macro_ids_for_update
            )

            if success:
                print(
                    f"[API] Retry update for report {report_id} successful",
                    file=sys.stderr,
                )
            else:
                print(
                    f"[API] Retry update for report {report_id} failed",
                    file=sys.stderr,
                )

            clear_process(process_id)
            return {
                "status": "RETRY_SUCCESS",
                "macro_ids_with_pages": all_macro_ids_with_pages,
            }
        else:
            print(
                f"[RETRY] No new macro IDs found during retry for report {report_id}",
                file=sys.stderr,
            )
            clear_process(process_id)
            return {"status": "RETRY_NO_IDS_FOUND", "macro_ids_with_pages": []}

    except Exception as e:
        print(f"[RETRY] Error in retry_get_missing_macro_ids: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc()

        # Clear process on error
        process_id = f"retry-macro-ids-{report_id}"
        clear_process(process_id)

        return {"status": "FAILED", "error": str(e)}


# ==============================
# Pause/Resume/Stop handlers for grab-macro-ids
# ==============================


async def pause_grab_macro_ids(report_id):
    """Pause macro ID grabbing process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.pause_process(f"grab-macro-ids-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active macro ID grabbing process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Paused macro ID grabbing for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def resume_grab_macro_ids(report_id):
    """Resume macro ID grabbing process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.resume_process(f"grab-macro-ids-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active macro ID grabbing process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Resumed macro ID grabbing for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def stop_grab_macro_ids(report_id):
    """Stop macro ID grabbing process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.stop_process(f"grab-macro-ids-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active macro ID grabbing process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Stopped macro ID grabbing for report {report_id}",
            "stopped": state.stopped,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def get_macro_count(browser, report_id):
    """
    Get the total count of macro IDs by checking the last page.
    Formula: 15 * (last_page_num - 1) + assets_on_last_page

    Returns:
        int: Total count of macro IDs, or 0 if failed
    """
    try:
        base_url = f"https://qima.taqeem.gov.sa/report/{report_id}"
        main_page = browser.tabs[0]
        await main_page.get(base_url)
        await asyncio.sleep(2)

        await wait_for_element(main_page, "li", timeout=30)

        # Get total number of pages from pagination
        pagination_links = await main_page.query_selector_all("ul.pagination li a")
        page_numbers = []
        for link in pagination_links:
            text = link.text
            if text and text.strip().isdigit():
                page_numbers.append(int(text.strip()))

        last_page_num = max(page_numbers) if page_numbers else 1
        print(f"[MACRO_COUNT] Last page number: {last_page_num}", file=sys.stderr)

        # Get macro IDs from the last page
        last_page_macro_ids = await get_macro_ids_from_page(
            main_page, base_url, last_page_num, tab_id=0
        )

        # Calculate total count
        total_count = 15 * (last_page_num - 1) + len(last_page_macro_ids)
        print(f"[MACRO_COUNT] Total macro count: {total_count}", file=sys.stderr)

        return total_count

    except Exception as e:
        print(f"[MACRO_COUNT] Error getting macro count: {str(e)}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        return 0


# ==============================
# Pause/Resume/Stop handlers for retry-macro-ids
# ==============================


async def pause_retry_macro_ids(report_id):
    """Pause retry macro ID process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.pause_process(f"retry-macro-ids-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active retry macro ID process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Paused retry macro ID process for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def resume_retry_macro_ids(report_id):
    """Resume retry macro ID process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.resume_process(f"retry-macro-ids-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active retry macro ID process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Resumed retry macro ID process for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def stop_retry_macro_ids(report_id):
    """Stop retry macro ID process"""
    try:
        process_manager = get_process_manager()
        state = process_manager.stop_process(f"retry-macro-ids-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active retry macro ID process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Stopped retry macro ID process for report {report_id}",
            "stopped": state.stopped,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}
