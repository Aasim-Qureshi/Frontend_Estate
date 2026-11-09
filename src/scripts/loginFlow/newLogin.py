import asyncio
import json
import time
import os
import sys

from scripts.core.browser import (
    closeBrowser,
    get_browser,
    inspect_taqeem_browser_session,
    inspect_old_taqeem_login,
    switch_to_headless,
    LOGIN_URL,
    FALLBACK_URL,
    REPORTS_URL,
    TAQEEM_APP_PREFIX,
    _is_app_url,
    _read_tab_url,
    _read_tab_greeting,
)

async def find_new_portal_tab(browser):
    """Return (tab, url) for any tab already on the new portal (not SSO, not old qima)."""
    try:
        await browser.update_targets()
    except Exception:
        pass
    for tab in list(browser.tabs):
        try:
            url = await _read_tab_url(tab)
        except Exception:
            continue
        low = (url or "").lower()
        if "sso.taqeem.gov.sa" in low or low.startswith(TAQEEM_APP_PREFIX):
            continue
        if _is_app_url(low):
            return tab, url
    return None

async def wait_until_old_logged_in(timeout=340, poll=2):
    start = time.time()
    seen_old = 0
    seen_new = 0
    while time.time() - start < timeout:
        try:
            browser = await get_browser()

            # NEW: user already reached the new portal (e.g. /my-reports) -> logged in
            hit = await find_new_portal_tab(browser)
            if hit:
                seen_new += 1
                if seen_new >= 2:   # stable across two polls, ignores redirect blips
                    tab, url = hit
                    return {"status": "SUCCESS", "url": url, "newPortal": True, "tab": tab}
            else:
                seen_new = 0

            # Landed on the old portal (e.g. qima.taqeem.gov.sa/valuer/home)
            url = await inspect_old_taqeem_login(browser)
            if url:
                seen_old += 1
                if seen_old >= 2:
                    return {"status": "SUCCESS", "url": url}
            else:
                seen_old = 0
                state = await inspect_taqeem_browser_session(browser)
                if state.get("status") == "SUCCESS" and not state.get("preservedSession"):
                    return {"status": "SUCCESS", "url": state.get("url", "")}
        except Exception as e:
            print(json.dumps({"type": "DEBUG", "message": f"login check error: {e}"}), flush=True)
        await asyncio.sleep(poll)
    return {"status": "FAILED", "error": "User did not complete login in time"}

async def navigate_new_portal(page, target_url, must_contain="", timeout=60, max_bounces=5):
    """
    Go to target_url on the new portal. If we get sent back to the old qima site,
    navigate again. Success:
      - must_contain given: app host, not SSO, URL contains must_contain and is
        stable for 2 polls (the greeting <h1> is NOT required)
      - no must_contain (portal root): app host, not SSO, greeting <h1> present
    """
    await page.get(target_url)
    bounces = 0
    stable = 0
    start = time.time()
    while time.time() - start < timeout:
        cur = await _read_tab_url(page)
        low = cur.lower()

        if low.startswith(TAQEEM_APP_PREFIX):
            stable = 0
            bounces += 1
            print(f"[PY] Bounced to old portal ({bounces}/{max_bounces}): {cur}",
                  file=sys.stderr, flush=True)
            if bounces > max_bounces:
                return {"status": "FAILED", "error": "Redirected back to old portal", "url": cur}
            await asyncio.sleep(2)
            await page.get(target_url)
            continue

        if _is_app_url(low) and "sso.taqeem.gov.sa" not in low:
            if must_contain:
                if must_contain in low:
                    stable += 1
                    if stable >= 2:
                        return {"status": "SUCCESS", "url": cur}
                else:
                    stable = 0
            elif await _read_tab_greeting(page):
                return {"status": "SUCCESS", "url": cur}
        else:
            stable = 0

        await asyncio.sleep(1)

    return {"status": "FAILED", "error": f"Could not reach {target_url}",
            "url": await _read_tab_url(page)}

async def public_login_flow(login_url=None, is_auth=False):
    try:
        existing = await get_browser(force_new=False, headless_override=False)
        hit = await find_new_portal_tab(existing)
        if hit:
            tab, url = hit
            if "/my-reports" in (url or "").lower():
                print(f"[PY] Already on {url}; skipping login flow.",
                      file=sys.stderr, flush=True)
                return {
                    "status": "CHECK",
                    "user_id": None,
                    "headless": False,
                    "skippedHeadlessSwitch": True,
                }
    except Exception as e:
        print(f"[PY] pre-login check failed: {e}", file=sys.stderr, flush=True)

    login_url = login_url or LOGIN_URL
    print(f"[PY] public_login_flow: login_url={login_url}, is_auth={is_auth}",
          file=sys.stderr, flush=True)

    try:
        browser = await get_browser(force_new=False, headless_override=False)
        page = await browser.get(login_url)
    except Exception:
        await closeBrowser()
        browser = await get_browser(force_new=True, headless_override=False)
        page = await browser.get(login_url)

    print("Please log in manually...", file=sys.stderr, flush=True)

    old = await wait_until_old_logged_in()
    if old["status"] != "SUCCESS":
        return old
    print(f"[PY] Login confirmed at {old['url']}", file=sys.stderr, flush=True)

    if old.get("newPortal"):
        # Already on the new portal: no phase 2/3 navigation needed.
        step = {"status": "SUCCESS", "url": old["url"]}
    else:
        # Phase 2: open the new portal root (SSO session should log us in silently)
        step = await navigate_new_portal(page, FALLBACK_URL)
        if step["status"] != "SUCCESS":
            return step
        # Phase 3: go to my-reports and make sure we stay there
        step = await navigate_new_portal(page, REPORTS_URL, must_contain="/my-reports")
        if step["status"] != "SUCCESS":
            return step
    print(f"[PY] On new portal: {step['url']}", file=sys.stderr, flush=True)

    # Record the verified session so later status checks use it
    state = await inspect_taqeem_browser_session(await get_browser())
    if state.get("status") != "SUCCESS":
        if "/my-reports" in (step.get("url") or "").lower():
            print("[PY] Session check not confirmed, but on /my-reports; treating as logged in.",
                  file=sys.stderr, flush=True)
        else:
            return {
                "status": "FAILED",
                "error": "New portal session not confirmed",
                "url": step["url"],
            }

    print(
        "[PY] Taqeem manual login detected in browser; proceeding (headless switch may follow).",
        file=sys.stderr,
        flush=True,
    )

    # Manual browser-based flows keep the visible browser as-is.
    if not is_auth:
        print(
            json.dumps(
                {
                    "type": "DEBUG",
                    "message": "headless_switch",
                    "result": {
                        "status": "SKIPPED",
                        "message": "Headless switch skipped for manual Taqeem session",
                    },
                }
            ),
            flush=True,
        )
        return {
            "status": "CHECK",
            "user_id": None,
            "headless": False,
            "skippedHeadlessSwitch": True,
        }

    # Optional switch to headless (can time out on Windows; automation works without it).
    skip_headless = os.getenv("TAQEEM_SKIP_HEADLESS_SWITCH", "").lower() in (
        "1",
        "true",
        "yes",
    )
    if skip_headless:
        switched = {
            "status": "SUCCESS",
            "skipped": True,
            "message": "Headless switch skipped via env",
        }
    else:
        try:
            switched = await asyncio.wait_for(switch_to_headless(), timeout=90)
        except asyncio.TimeoutError:
            switched = {
                "status": "FAILED",
                "error": "Timed out while switching the logged-in browser to headless mode",
            }

    print(
        json.dumps({"type": "DEBUG", "message": "headless_switch", "result": switched}),
        flush=True,
    )

    if switched["status"] != "SUCCESS":
        fallback_result = {
            "warning": switched.get("error") or "Headless switch failed after successful login",
            "headless": False,
        }
        if not is_auth:
            return {"status": "CHECK", "user_id": None, **fallback_result}
        return {"status": "SUCCESS", **fallback_result}

    return {"status": "SUCCESS", "headless": True}
