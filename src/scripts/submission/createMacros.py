import asyncio
import json
import sys
import traceback
from datetime import datetime

from scripts.core.processControl import (
    check_and_wait,
    clear_process,
    create_process,
    emit_progress,
    get_process_manager,
    update_progress,
)
from scripts.core.utils import wait_for_element

from .formFiller import bulk_inject_inputs


async def save_macros(page, macro_data, field_map, field_types):
    try:
        await bulk_inject_inputs(page, macro_data, field_map, field_types)

        save_btn = await wait_for_element(page, "input[type='submit']", timeout=10)
        if save_btn:
            await asyncio.sleep(0.5)
            await save_btn.click()
            await asyncio.sleep(2)
            return {"status": "SAVED"}
        else:
            return {"status": "FAILED", "error": "Save button not found"}

    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


def calculate_tab_batches(total_macros, max_tabs, batch_size=10):
    if total_macros <= batch_size:
        return [total_macros]

    required_tabs = (total_macros + batch_size - 1) // batch_size
    tabs_to_use = min(required_tabs, max_tabs)

    base, extra = divmod(total_macros, tabs_to_use)
    result = []
    for i in range(tabs_to_use):
        size = base + (1 if i < extra else 0)
        result.append(size)
    return result


async def create_macros_multi_tab(
    browser,
    report_id,
    macro_count,
    macro_data_template,
    field_map,
    field_types,
    max_tabs=3,
    batch_size=10,
):
    """
    Create macros with pause/resume/stop support using the modular state manager
    """
    process_manager = get_process_manager()

    # Create process state
    process_state = create_process(
        process_id=report_id,
        process_type="create-macros",
        total=macro_count,
        report_id=report_id,
        max_tabs=max_tabs,
        batch_size=batch_size,
    )

    try:
        print(
            json.dumps(
                {
                    "event": "start",
                    "msg": f"Starting macro creation: {macro_count} macros for report {report_id}",
                }
            ),
            file=sys.stderr,
        )

        asset_url = f"https://qima.taqeem.sa/report/asset/create/{report_id}"

        main_page = await browser.get(asset_url)
        await asyncio.sleep(2)

        distribution = calculate_tab_batches(macro_count, max_tabs, batch_size)
        print(
            json.dumps(
                {
                    "event": "distribution",
                    "msg": f"Tab distribution: {distribution} macros per tab",
                }
            ),
            file=sys.stderr,
        )

        pages = [main_page]
        for _ in range(len(distribution) - 1):
            new_tab = await browser.get(asset_url, new_tab=True)
            pages.append(new_tab)
            await asyncio.sleep(1)

        for page in pages:
            for _ in range(20):
                ready_state = await page.evaluate("document.readyState")
                key_el = await wait_for_element(page, "#macros", timeout=0.5)
                if ready_state == "complete" and key_el:
                    break
                await asyncio.sleep(0.5)

        completed = 0
        failed = 0
        total_created = 0

        async def process_macros_in_tab(page, start_index, count, tab_id):
            nonlocal completed, failed, total_created

            for batch_start in range(0, count, batch_size):
                # Check pause/stop state before each batch
                action = await check_and_wait(report_id)
                if action == "stop":
                    print(
                        json.dumps(
                            {
                                "event": "stopped",
                                "msg": f"Tab {tab_id} stopped by user request",
                            }
                        ),
                        file=sys.stderr,
                    )
                    return {"status": "STOPPED", "message": "Process stopped by user"}

                batch_count = min(batch_size, count - batch_start)
                batch_index = start_index + batch_start

                print(
                    json.dumps(
                        {
                            "event": "processing_batch",
                            "msg": f"Tab {tab_id}: Processing batch {batch_index} to {batch_index + batch_count - 1}",
                        }
                    ),
                    file=sys.stderr,
                )

                # Prepare macro data for this batch
                batch_data = {"number_of_macros": str(batch_count), "asset_data": []}

                if isinstance(macro_data_template, list):
                    for i in range(batch_count):
                        idx = start_index + batch_start + i
                        if idx < len(macro_data_template):
                            batch_data["asset_data"].append(macro_data_template[idx])
                        else:
                            batch_data["asset_data"].append(macro_data_template[-1])
                else:
                    batch_data["asset_data"] = [macro_data_template] * batch_count

                form_data = (
                    {**batch_data, **macro_data_template}
                    if isinstance(macro_data_template, dict)
                    else batch_data
                )

                # Emit progress before processing
                emit_progress(
                    report_id,
                    current_item=f"batch_{batch_index}",
                    message=f"Tab {tab_id}: Creating batch {batch_index}-{batch_index + batch_count - 1}",
                )

                result = await save_macros(page, form_data, field_map, field_types)

                if result.get("status") == "FAILED":
                    lock = process_manager.get_lock(report_id)
                    if lock:
                        async with lock:
                            failed += batch_count
                    await update_progress(report_id, completed=completed, failed=failed)

                    print(
                        json.dumps(
                            {
                                "event": "save_failed",
                                "msg": f"Tab {tab_id}: Failed to save batch: {result.get('error')}",
                            }
                        ),
                        file=sys.stderr,
                    )
                    return result

                # Update progress after successful batch
                lock = process_manager.get_lock(report_id)
                if lock:
                    async with lock:
                        completed += batch_count
                        total_created += batch_count

                await update_progress(
                    report_id, completed=completed, failed=failed, emit=True
                )

                print(
                    json.dumps(
                        {
                            "event": "progress",
                            "msg": f"Tab {tab_id}: Progress: {completed}/{macro_count} macros created ({round((completed / macro_count) * 100, 2)}%)",
                        }
                    ),
                    file=sys.stderr,
                )

                # Navigate to next batch if not the last one
                if batch_start + batch_size < count:
                    await page.get(asset_url)
                    await asyncio.sleep(1)

            return {"status": "SUCCESS"}

        # Create tasks for parallel processing
        tasks = []
        idx = 0
        for i, (page, count) in enumerate(zip(pages, distribution)):
            if count > 0:
                tasks.append(process_macros_in_tab(page, idx, count, i))
                idx += count

        # Execute all tasks in parallel
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Check for failures or stops
        was_stopped = False
        for result in results:
            if isinstance(result, Exception):
                print(
                    json.dumps(
                        {"event": "exception", "msg": f"Task exception: {str(result)}"}
                    ),
                    file=sys.stderr,
                )
                clear_process(report_id)
                return {
                    "status": "FAILED",
                    "error": str(result),
                    "traceback": traceback.format_exc(),
                }
            elif isinstance(result, dict):
                if result.get("status") == "STOPPED":
                    was_stopped = True
                elif result.get("status") == "FAILED":
                    clear_process(report_id)
                    return result

        ### NEW: Close extra tabs
        for p in pages[1:]:
            await p.close()

        # Clear process state
        clear_process(report_id)

        if was_stopped:
            return {
                "status": "STOPPED",
                "message": f"Process stopped. Created {total_created}/{macro_count} macros",
                "report_id": report_id,
                "total_created": total_created,
                "total_requested": macro_count,
            }

        print(
            json.dumps(
                {
                    "event": "success",
                    "msg": f"Successfully created {total_created} macros for report {report_id}",
                }
            ),
            file=sys.stderr,
        )

        return {
            "status": "SUCCESS",
            "report_id": report_id,
            "total_created": total_created,
            "failed": failed,
            "completion_time": datetime.now().isoformat(),
        }

    except Exception as e:
        tb = traceback.format_exc()
        clear_process(report_id)
        print(
            json.dumps({"event": "exception", "msg": str(e), "traceback": tb}),
            file=sys.stderr,
        )
        return {"status": "FAILED", "error": str(e), "traceback": tb}


async def run_create_assets(
    browser, report_id, macro_count, tabs_num=3, batch_size=10, macro_data=None
):
    if not browser:
        return {
            "status": "FAILED",
            "error": "No active browser session. Please login first.",
        }

    if not report_id:
        return {
            "status": "FAILED",
            "error": "Missing required parameter: reportId",
        }

    try:
        macro_count = int(macro_count)
    except Exception:
        return {
            "status": "FAILED",
            "error": "Missing or invalid required parameter: macroCount",
        }

    if macro_count <= 0:
        return {
            "status": "FAILED",
            "error": "macroCount must be a positive integer",
        }

    tabs_num = int(tabs_num) if tabs_num else 3
    batch_size = int(batch_size) if batch_size else 10
    macro_data_template = macro_data if macro_data is not None else {}

    try:
        from scripts.submission.formSteps import form_steps
    except Exception as e:
        tb = traceback.format_exc()
        return {
            "status": "FAILED",
            "error": f"Failed to import required modules: {e}",
            "traceback": tb,
        }

    try:
        step_one = form_steps[1] if len(form_steps) > 1 else form_steps[0]
        field_map = step_one.get("field_map", {}) if isinstance(step_one, dict) else {}
        field_types = (
            step_one.get("field_types", {}) if isinstance(step_one, dict) else {}
        )
    except Exception:
        field_map = {}
        field_types = {}

    try:
        result = await create_macros_multi_tab(
            browser=browser,
            report_id=report_id,
            macro_count=macro_count,
            macro_data_template=macro_data_template,
            field_map=field_map,
            field_types=field_types,
            max_tabs=tabs_num,
            batch_size=batch_size,
        )
    except Exception as e:
        tb = traceback.format_exc()
        clear_process(report_id)
        return {
            "status": "FAILED",
            "error": str(e),
            "traceback": tb,
            "reportId": report_id,
            "time": datetime.now().isoformat(),
        }

    return result


# Pause/Resume/Stop handlers
async def pause_create_macros(report_id):
    """Pause macro creation for a report"""
    try:
        process_manager = get_process_manager()
        state = process_manager.pause_process(report_id)

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Paused macro creation for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def resume_create_macros(report_id):
    """Resume macro creation for a report"""
    try:
        process_manager = get_process_manager()
        state = process_manager.resume_process(report_id)

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Resumed macro creation for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def stop_create_macros(report_id):
    """Stop macro creation for a report"""
    try:
        process_manager = get_process_manager()
        state = process_manager.stop_process(report_id)

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active process found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Stopped macro creation for report {report_id}",
            "stopped": state.stopped,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def run_create_assets_by_count(
    browser, num_macros, macro_data_template=None, tabs_num=3, batch_size=10
):
    try:
        print(
            f"[CREATE_ASSETS_BY_COUNT] Starting to create {num_macros} assets using {tabs_num} tabs",
            file=sys.stderr,
        )

        if num_macros <= 0:
            return {"status": "FAILED", "error": "num_macros must be greater than 0"}

        # Get field_map and field_types from form_steps
        try:
            from scripts.submission.formSteps import form_steps

            step_one = form_steps[1] if len(form_steps) > 1 else form_steps[0]
            field_map = (
                step_one.get("field_map", {}) if isinstance(step_one, dict) else {}
            )
            field_types = (
                step_one.get("field_types", {}) if isinstance(step_one, dict) else {}
            )
        except Exception:
            field_map = {}
            field_types = {}

        # Default macro data template
        if macro_data_template is None:
            macro_data_template = {}

        # Get main page (should already be on asset creation page)
        main_page = browser.tabs[0]
        current_url = await main_page.evaluate("window.location.href")

        if "asset/create" not in current_url:
            return {"status": "FAILED", "error": "Not on asset creation page"}

        # Calculate distribution using the existing function
        tab_distributions = calculate_tab_batches(num_macros, tabs_num, batch_size)

        print(
            f"[CREATE_ASSETS_BY_COUNT] Distribution: {tab_distributions} assets per tab",
            file=sys.stderr,
        )

        # Open additional tabs if needed
        pages = [main_page]
        for _ in range(len(tab_distributions) - 1):
            new_page = await browser.get(current_url, new_tab=True)
            pages.append(new_page)
            await asyncio.sleep(1)

        # Wait for all pages to be ready
        for page in pages:
            for _ in range(20):
                ready_state = await page.evaluate("document.readyState")
                key_el = await wait_for_element(page, "#macros", timeout=0.5)
                if ready_state == "complete" and key_el:
                    break
                await asyncio.sleep(0.5)

        # Track results
        completed = 0
        total_created = 0
        results_lock = asyncio.Lock()

        async def process_tab_assets(page, start_index, asset_count, tab_id):
            """Process assets for a single tab"""
            nonlocal completed, total_created

            print(
                f"[CREATE_ASSETS_BY_COUNT-TAB-{tab_id}] Processing {asset_count} assets",
                file=sys.stderr,
            )

            # Process assets in batches
            for batch_start in range(0, asset_count, batch_size):
                batch_count = min(batch_size, asset_count - batch_start)

                print(
                    f"[CREATE_ASSETS_BY_COUNT-TAB-{tab_id}] Processing batch: {start_index + batch_start} to {start_index + batch_start + batch_count - 1}",
                    file=sys.stderr,
                )

                # Prepare macro data for this batch
                batch_data = {"number_of_macros": str(batch_count), "asset_data": []}

                # If macro_data_template is a list, use it; otherwise replicate the template
                if isinstance(macro_data_template, list):
                    for i in range(batch_count):
                        idx = start_index + batch_start + i
                        if idx < len(macro_data_template):
                            batch_data["asset_data"].append(macro_data_template[idx])
                        else:
                            batch_data["asset_data"].append(macro_data_template[-1])
                else:
                    batch_data["asset_data"] = [macro_data_template] * batch_count

                form_data = (
                    {**batch_data, **macro_data_template}
                    if isinstance(macro_data_template, dict)
                    else batch_data
                )

                # Use the existing save_macros function
                result = await save_macros(page, form_data, field_map, field_types)

                if result.get("status") == "FAILED":
                    print(
                        f"[CREATE_ASSETS_BY_COUNT-TAB-{tab_id}] Failed to save batch: {result.get('error')}",
                        file=sys.stderr,
                    )
                    return result

                async with results_lock:
                    completed += batch_count
                    total_created += batch_count

                print(
                    f"[CREATE_ASSETS_BY_COUNT-TAB-{tab_id}] Progress: {completed}/{num_macros} macros created ({round((completed / num_macros) * 100, 2)}%)",
                    file=sys.stderr,
                )

                # Navigate back to asset creation page for next batch
                if batch_start + batch_size < asset_count:
                    await page.get(current_url)
                    await asyncio.sleep(1)

            return {"status": "SUCCESS"}

        # Process all tabs in parallel
        tasks = []
        idx = 0
        for i, (page, count) in enumerate(zip(pages, tab_distributions)):
            if count > 0:
                tasks.append(process_tab_assets(page, idx, count, i))
                idx += count

        results = await asyncio.gather(*tasks)

        # Check for failures
        for result in results:
            if isinstance(result, dict) and result.get("status") == "FAILED":
                print(
                    f"[CREATE_ASSETS_BY_COUNT] Task failed: {result.get('error', 'unknown')}",
                    file=sys.stderr,
                )
                return result

        # Close extra tabs
        for page in pages[1:]:
            await page.close()

        print(
            f"[CREATE_ASSETS_BY_COUNT] Completed: {total_created} successful",
            file=sys.stderr,
        )

        return {
            "status": "SUCCESS",
            "total_assets": num_macros,
            "successful": total_created,
            "failed": 0,
            "completion_time": datetime.now().isoformat(),
        }

    except Exception as e:
        print(f"[CREATE_ASSETS_BY_COUNT] Error: {str(e)}", file=sys.stderr)
        traceback.print_exc()
        return {
            "status": "FAILED",
            "error": str(e),
            "traceback": traceback.format_exc(),
        }
