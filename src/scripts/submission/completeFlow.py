import json
import sys
import traceback
from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorClient

from scripts.core.browser import spawn_new_browser
from scripts.core.httpClient import http_get, http_patch
from scripts.core.processControl import (
    check_and_wait,
    clear_process,
    create_process,
    emit_progress,
    get_process_manager,
    update_progress,
)
from scripts.submission.checkMacroStatus import RunCheckMacroStatus
from scripts.submission.createMacros import run_create_assets
from scripts.submission.grabMacroIds import get_all_macro_ids_parallel
from scripts.submission.macroFiller import run_macro_edit
from scripts.submission.validateReport import validate_report_simple


async def run_complete_report_flow(browser, report_id, tabs_num=3, batch_size=10):
    client = None
    process_id = f"complete-flow-{report_id}"
    new_browser = None

    try:
        # Create process state for the entire flow
        process_manager = get_process_manager()
        process_state = create_process(
            process_id=process_id,
            process_type="complete-flow",
            total=4,  # 4 main steps
            report_id=report_id,
            tabs_num=tabs_num,
        )

        print(
            json.dumps(
                {
                    "event": "flow_start",
                    "msg": f"Starting complete flow for report {report_id}",
                }
            ),
            file=sys.stderr,
        )

        # ==========================================
        # STEP 1: Fetch Report Data
        # ==========================================

        emit_progress(
            process_id,
            current_item="fetch_report",
            message="Fetching report data from database...",
        )

        report_data = await http_get(f"/new-scripts/report-id/{report_id}")
        report = report_data.get("data")
        print("used http")
        if not report:
            clear_process(process_id)
            return {
                "status": "FAILED",
                "error": f"Report {report_id} not found in database",
            }

        asset_data = report.get("asset_data", [])
        if not asset_data:
            clear_process(process_id)
            return {
                "status": "FAILED",
                "error": f"No asset_data found in report {report_id}",
            }

        macro_count = len(asset_data)
        print(
            json.dumps(
                {
                    "event": "report_fetched",
                    "msg": f"Found report with {macro_count} assets to process",
                }
            ),
            file=sys.stderr,
        )

        await update_progress(process_id, completed=1, total=4, emit=True)

        # Check for pause/stop
        action = await check_and_wait(process_id)
        if action == "stop":
            clear_process(process_id)
            return {
                "status": "STOPPED",
                "message": "Flow stopped by user after fetching report data",
                "step": "fetch_report",
            }

        # ==========================================
        # STEP 2: Create Macros
        # ==========================================
        emit_progress(
            process_id,
            current_item="create_macros",
            message=f"Creating {macro_count} macros...",
        )

        print(
            json.dumps(
                {
                    "event": "create_start",
                    "msg": f"Starting macro creation for {macro_count} macros",
                }
            ),
            file=sys.stderr,
        )

        # Update flow start time
        await http_patch(
            f"/new-scripts/set-flow-start-time/{report_id}",
        )

        new_browser = await spawn_new_browser(browser)

        validation_result = await validate_report_simple(
            browser=new_browser, report_id=report_id
        )

        print(json.dumps(validation_result), file=sys.stderr)

        if validation_result.get("status") == "FAILED":
            clear_process(process_id)
            new_browser.stop()
            return {
                "status": "FAILED",
                "error": f"Report validation failed: {validation_result.get('error')}",
                "step": "validate_report",
                "details": validation_result,
            }

        if validation_result.get("status") == "NOT_FOUND":
            clear_process(process_id)
            new_browser.stop()
            return {
                "status": "FAILED",
                "error": "Report not found",
                "message": "Report not found",
                "step": "validate_report",
                "details": validation_result,
            }

        if validation_result.get("status") == "MACROS_EXIST":
            clear_process(process_id)
            new_browser.stop()
            return {
                "status": "FAILED",
                "error": "Macros already exist",
                "message": "Macros already exist",
                "step": "validate_report",
                "details": validation_result,
            }

        create_result = await run_create_assets(
            browser=new_browser,
            report_id=report_id,
            macro_count=macro_count,
            tabs_num=tabs_num,
            batch_size=batch_size,
            macro_data=asset_data,
        )

        if create_result.get("status") == "FAILED":
            clear_process(process_id)
            return {
                "status": "FAILED",
                "error": f"Macro creation failed: {create_result.get('error')}",
                "step": "create_macros",
                "details": create_result,
            }
        elif create_result.get("status") == "STOPPED":
            clear_process(process_id)
            return {
                "status": "STOPPED",
                "message": f"Flow stopped during macro creation. Created {create_result.get('total_created', 0)}/{macro_count} macros",
                "step": "create_macros",
                "details": create_result,
            }

        print(
            json.dumps(
                {
                    "event": "create_complete",
                    "msg": f"Successfully created {create_result.get('total_created', macro_count)} macros",
                }
            ),
            file=sys.stderr,
        )

        await update_progress(process_id, completed=2, total=4, emit=True)

        # Check for pause/stop
        action = await check_and_wait(process_id)
        if action == "stop":
            clear_process(process_id)
            return {
                "status": "STOPPED",
                "message": "Flow stopped by user after creating macros",
                "step": "create_macros",
                "macros_created": create_result.get("total_created", macro_count),
            }

        # ==========================================
        # STEP 3: Grab Macro IDs
        # ==========================================
        emit_progress(
            process_id,
            current_item="grab_ids",
            message="Grabbing macro IDs from pages...",
        )

        print(
            json.dumps({"event": "grab_start", "msg": "Starting to grab macro IDs"}),
            file=sys.stderr,
        )

        grab_result = await get_all_macro_ids_parallel(
            browser=new_browser, report_id=report_id, tabs_num=tabs_num
        )

        if grab_result.get("status") == "FAILED":
            clear_process(process_id)
            return {
                "status": "FAILED",
                "error": f"Grabbing macro IDs failed: {grab_result.get('error')}",
                "step": "grab_ids",
                "details": grab_result,
            }

        macro_ids_count = len(grab_result.get("macro_ids_with_pages", []))
        print(
            json.dumps(
                {
                    "event": "grab_complete",
                    "msg": f"Successfully grabbed {macro_ids_count} macro IDs",
                }
            ),
            file=sys.stderr,
        )

        await update_progress(process_id, completed=3, total=4, emit=True)

        # Check for pause/stop
        action = await check_and_wait(process_id)
        if action == "stop":
            clear_process(process_id)
            return {
                "status": "STOPPED",
                "message": "Flow stopped by user after grabbing macro IDs",
                "step": "grab_ids",
                "macro_ids_grabbed": macro_ids_count,
            }

        # ==========================================
        # STEP 4: Fill Macro Forms
        # ==========================================
        emit_progress(
            process_id, current_item="fill_macros", message="Filling macro forms..."
        )

        print(
            json.dumps({"event": "fill_start", "msg": "Starting to fill macro forms"}),
            file=sys.stderr,
        )

        fill_result = await run_macro_edit(
            browser=new_browser, report_id=report_id, tabs_num=tabs_num
        )

        if fill_result.get("status") == "FAILED":
            clear_process(process_id)
            return {
                "status": "FAILED",
                "error": f"Filling macros failed: {fill_result.get('error')}",
                "step": "fill_macros",
                "details": fill_result,
            }
        elif fill_result.get("status") == "STOPPED":
            clear_process(process_id)
            return {
                "status": "STOPPED",
                "message": f"Flow stopped during macro filling. Filled {fill_result.get('completed', 0)}/{macro_count} macros",
                "step": "fill_macros",
                "details": fill_result,
            }

        print(
            json.dumps(
                {
                    "event": "fill_complete",
                    "msg": f"Successfully filled macros. Completed: {fill_result.get('result', {}).get('completed', 0)}, Failed: {fill_result.get('result', {}).get('failed', 0)}",
                }
            ),
            file=sys.stderr,
        )

        await update_progress(process_id, completed=4, total=4, emit=True)

        # Check for pause/stop
        action = await check_and_wait(process_id)
        if action == "stop":
            clear_process(process_id)
            return {
                "status": "STOPPED",
                "message": "Flow stopped by user after filling macros",
                "step": "fill_macros",
                "macros_filled": fill_result.get("result", {}).get("completed", 0),
            }

        # ==========================================
        # STEP 5: Check Macro Status
        # ==========================================
        emit_progress(
            process_id,
            current_item="check_status",
            message="Checking macro completion status...",
        )

        print(
            json.dumps({"event": "check_start", "msg": "Starting macro status check"}),
            file=sys.stderr,
        )

        check_result = await RunCheckMacroStatus(
            browser=new_browser, report_id=report_id, tabs_num=tabs_num, same=True
        )

        if check_result.get("status") == "FAILED":
            clear_process(process_id)
            return {
                "status": "FAILED",
                "error": f"Checking macro status failed: {check_result.get('error')}",
                "step": "check_status",
                "details": check_result,
            }

        incomplete_count = check_result.get("macro_count", 0)
        print(
            json.dumps(
                {
                    "event": "check_complete",
                    "msg": f"Check complete. Found {incomplete_count} incomplete macros out of {macro_count} total",
                }
            ),
            file=sys.stderr,
        )

        # Update flow end time
        await http_patch(
            f"/new-scripts/set-flow-end-time/{report_id}",
        )

        # Clear process state
        clear_process(process_id)

        # ==========================================
        # Final Summary
        # ==========================================
        print(
            json.dumps(
                {
                    "event": "flow_complete",
                    "msg": f"Complete flow finished for report {report_id}",
                }
            ),
            file=sys.stderr,
        )

        return {
            "status": "SUCCESS",
            "report_id": report_id,
            "summary": {
                "total_macros": macro_count,
                "created": create_result.get("total_created", macro_count),
                "ids_grabbed": macro_ids_count,
                "filled_completed": fill_result.get("result", {}).get("completed", 0),
                "filled_failed": fill_result.get("result", {}).get("failed", 0),
                "incomplete_macros": incomplete_count,
                "complete_macros": macro_count - incomplete_count,
            },
            "steps": {
                "create": create_result,
                "grab_ids": grab_result,
                "fill": fill_result,
                "check": check_result,
            },
            "completion_time": datetime.now().isoformat(),
        }

    except Exception as e:
        tb = traceback.format_exc()
        print(
            json.dumps({"event": "flow_error", "msg": str(e), "traceback": tb}),
            file=sys.stderr,
        )

        # Clear process state on error
        clear_process(process_id)

        return {
            "status": "FAILED",
            "error": str(e),
            "traceback": tb,
            "report_id": report_id,
        }

    finally:
        if new_browser:
            new_browser.stop()


# ==============================
# Pause/Resume/Stop handlers
# ==============================


async def pause_complete_flow(report_id):
    """Pause complete flow for a report"""
    try:
        process_manager = get_process_manager()
        state = process_manager.pause_process(f"complete-flow-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active complete flow found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Paused complete flow for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def resume_complete_flow(report_id):
    """Resume complete flow for a report"""
    try:
        process_manager = get_process_manager()
        state = process_manager.resume_process(f"complete-flow-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active complete flow found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Resumed complete flow for report {report_id}",
            "paused": state.paused,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def stop_complete_flow(report_id):
    """Stop complete flow for a report"""
    try:
        process_manager = get_process_manager()
        state = process_manager.stop_process(f"complete-flow-{report_id}")

        if not state:
            return {
                "status": "FAILED",
                "error": f"No active complete flow found for report {report_id}",
            }

        return {
            "status": "SUCCESS",
            "message": f"Stopped complete flow for report {report_id}",
            "stopped": state.stopped,
        }
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}
