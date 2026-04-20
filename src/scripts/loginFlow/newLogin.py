import asyncio
import json
import os
import sys

from scripts.core.browser import (
    closeBrowser,
    get_browser,
    inspect_taqeem_browser_session,
    switch_to_headless,
)


async def wait_until_logged_in(page, timeout=340, poll=2):
    import time

    start = time.time()

    while time.time() - start < timeout:
        try:
            browser = await get_browser()
            session_state = await inspect_taqeem_browser_session(browser)

            if session_state.get("status") == "SUCCESS":
                return {
                    "status": "SUCCESS",
                    "url": session_state.get("url", ""),
                }

        except Exception as e:
            print(
                json.dumps(
                    {
                        "type": "DEBUG",
                        "message": f"wait_until_logged_in error: {e}",
                    }
                ),
                flush=True,
            )

        await asyncio.sleep(poll)

    return {"status": "FAILED", "error": "User did not complete login in time"}


async def public_login_flow(login_url, is_auth=False):
    # Step 1: show login UI
    try:
        browser = await get_browser(force_new=False, headless_override=False)
        page = await browser.get(login_url)
    except Exception:
        # If the previous automation browser was closed, recreate it and retry once.
        await closeBrowser()
        browser = await get_browser(force_new=True, headless_override=False)
        page = await browser.get(login_url)

    print("Please log in manually...")

    # Step 2: wait for success
    logged_in = await wait_until_logged_in(page)
    if logged_in["status"] != "SUCCESS":
        return logged_in

    print(
        "[PY] Taqeem manual login detected in browser; proceeding (headless switch may follow).",
        file=sys.stderr,
        flush=True,
    )

    # Step 3: optional switch to headless (can time out on Windows; automation still works without it).
    skip_headless = os.getenv("TAQEEM_SKIP_HEADLESS_SWITCH", "").lower() in (
        "1",
        "true",
        "yes",
    )
    if skip_headless:
        switched = {"status": "SUCCESS", "skipped": True, "message": "Headless switch skipped via env"}
    else:
        try:
            switched = await asyncio.wait_for(switch_to_headless(), timeout=90)
        except asyncio.TimeoutError:
            switched = {
                "status": "FAILED",
                "error": "Timed out while switching the logged-in browser to headless mode",
            }

    print(json.dumps({"type": "DEBUG", "message": "headless_switch", "result": switched}), flush=True)

    if switched["status"] != "SUCCESS":
        fallback_result = {
            "warning": switched.get("error") or "Headless switch failed after successful login",
            "headless": False,
        }
        if not is_auth:
            return {"status": "CHECK", "user_id": None, **fallback_result}
        return {"status": "SUCCESS", **fallback_result}

    if not is_auth:
        # Keep the user on home page after manual login and avoid profile scraping.
        # Username resolution is handled on the frontend from cached linked account data.
        return {"status": "CHECK", "user_id": None, "headless": True}

    return {"status": "SUCCESS", "headless": True}
