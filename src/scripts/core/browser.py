import asyncio
import json
import os
import profile
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import nodriver as uc
from dotenv import load_dotenv

from .utils import log

load_dotenv()

browser = None
page = None
refresh_task = None
TAQEEM_APP_PREFIX = "https://qima.taqeem.gov.sa/"
TAQEEM_AUTH_URL_MARKERS = (
    "sso.taqeem.gov.sa/realms/rel_taqeem/login-actions/authenticate",
    "sso.taqeem.gov.sa/realms/rel_taqeem/protocol/openid-connect/auth",
    "/login-actions/authenticate",
    "/protocol/openid-connect/auth",
)


def get_profile_dir():
    app_name = "value_tech_profile"

    if sys.platform.startswith("win"):
        base = Path(tempfile.gettempdir())
    elif sys.platform == "darwin":
        base = Path(tempfile.gettempdir())
    else:  # Linux / BSD
        base = Path(tempfile.gettempdir())

    path = base / app_name
    path.mkdir(parents=True, exist_ok=True)
    # Never print to stdout: Electron worker parses stdout as JSON lines only.
    print(str(path), file=sys.stderr, flush=True)
    return str(path.resolve())


async def spawn_new_browser(
    old_browser,
    user_data_dir=None,
    headless=True,
):

    profile_dir = get_profile_dir()
    session_file = profile_dir + "/.session.dat"

    user_agent = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
    )

    try:
        if old_browser:
            await old_browser.cookies.save(session_file)
    except Exception:
        # If saving cookies from the old browser fails, proceed with whatever is on disk
        pass

    new_browser = await uc.start(
        user_data_dir=None,
        headless=headless,
        browser_args=[
            f"--user-agent={user_agent}",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no_sandbox",
            "--disable-popup-blocking",
            "--disable-features=VizDisplayCompositor",
            "--lang=en-US",
            "--no-first-run",
            "--no-default-browser-check",
        ],
    )

    try:
        await new_browser.cookies.load(session_file)
    except Exception:
        # Continue even if cookies fail to load; caller can handle auth failures
        pass
    return new_browser


async def close_extra_tabs(browser=None):
    if not browser:
        browser = await get_browser()

    for tab in browser.tabs[1:]:
        try:
            await tab.close()
        except Exception as e:
            print(f"Failed to close tab: {e}")


async def switch_to_headless():
    global browser

    if not browser:
        return {"status": "FAILED", "error": "No active browser"}

    old_browser = browser

    try:
        profile_path = get_profile_dir()
        session_file = profile_path + "/.session.dat"
        await old_browser.cookies.save(session_file)

        user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
        )

        headless_browser = await uc.start(
            headless=True,
            user_data_dir=None,
            browser_args=[
                f"--user-agent={user_agent}",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no_sandbox",
                "--disable-popup-blocking",
                "--disable-features=VizDisplayCompositor",
                "--lang=en-US",
                "--no-first-run",
                "--no-default-browser-check",
            ],
        )
        await headless_browser.cookies.load(session_file)
        browser = headless_browser
        old_browser.stop()

        global refresh_task
        if refresh_task is None or refresh_task.done():
            refresh_task = asyncio.create_task(_periodic_refresh(interval_minutes=1))

        return {"status": "SUCCESS"}

    except Exception as e:
        return {"status": "FAILED", "error": str(e)}


async def get_browser(force_new=False, headless_override=None):
    global browser

    if force_new and browser:
        await closeBrowser()

    if browser is not None:
        try:
            # If the browser was closed externally, this access can throw or return empty tabs.
            tabs = browser.tabs
            if not tabs:
                await closeBrowser()
        except Exception:
            await closeBrowser()

    if browser is None:
        # Default behavior from environment
        env_headless = os.getenv("HEADLESS", "false").lower() in ("true", "1", "yes")

        # Allow callers to explicitly override
        headless = headless_override if headless_override is not None else env_headless

        print(
            json.dumps({"type": "DEBUG", "message": f"Headless mode: {headless}"}),
            flush=True,
        )

        user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
        )

        profile_path = get_profile_dir()

        browser = await uc.start(
            headless=headless,
            user_data_dir=None,
            browser_args=[
                f"--user-agent={user_agent}",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no_sandbox",
                "--disable-popup-blocking",
                "--disable-features=VizDisplayCompositor",
                "--lang=en-US",
                "--no-first-run",
                "--no-default-browser-check",
            ],
            window_size=(1920, 1080),
        )

    return browser


async def get_main_tab():
    b = await get_browser()
    if b.main_tab is None and len(b.tabs) > 0:
        return b.tabs[0]
    return b.main_tab or await b.get("about:blank")


def _collect_browser_tabs(browser_instance):
    candidates = []
    seen = set()

    if browser_instance is None:
        return candidates

    try:
        main_tab = browser_instance.main_tab
    except Exception:
        main_tab = None

    if main_tab is not None:
        tab_id = id(main_tab)
        if tab_id not in seen:
            seen.add(tab_id)
            candidates.append(main_tab)

    try:
        tabs = list(browser_instance.tabs or [])
    except Exception:
        tabs = []

    for candidate in tabs:
        if candidate is None:
            continue
        tab_id = id(candidate)
        if tab_id in seen:
            continue
        seen.add(tab_id)
        candidates.append(candidate)

    return candidates


async def _read_tab_url(tab):
    if tab is None:
        return ""

    try:
        url = await asyncio.wait_for(
            tab.evaluate("window.location.href"),
            timeout=12.0,
        )
    except (asyncio.TimeoutError, Exception):
        return ""

    return str(url or "").strip()


async def inspect_taqeem_browser_session(browser_instance=None):
    active_browser = browser_instance or browser
    if active_browser is None:
        return {
            "status": "FAILED",
            "error": "No browser instance",
            "browserOpen": False,
            "checkedUrls": [],
        }

    try:
        pages = _collect_browser_tabs(active_browser)
    except Exception as e:
        return {
            "status": "FAILED",
            "error": str(e),
            "browserOpen": False,
            "checkedUrls": [],
        }

    if not pages:
        return {
            "status": "FAILED",
            "error": "No browser tabs",
            "browserOpen": False,
            "checkedUrls": [],
        }

    checked_urls = []
    found_auth_page = False
    found_any_page = False

    for candidate in pages:
        url = await _read_tab_url(candidate)
        if not url:
            continue

        found_any_page = True
        checked_urls.append(url)
        current_url = url.lower()

        if current_url.startswith(TAQEEM_APP_PREFIX):
            return {
                "status": "SUCCESS",
                "message": "User is logged in",
                "browserOpen": True,
                "url": url,
                "checkedUrls": checked_urls,
                "page": candidate,
            }

        if any(marker in current_url for marker in TAQEEM_AUTH_URL_MARKERS):
            found_auth_page = True

    if found_auth_page or found_any_page:
        return {
            "status": "NOT_LOGGED_IN",
            "error": "User not logged in",
            "browserOpen": True,
            "checkedUrls": checked_urls,
        }

    return {
        "status": "NOT_LOGGED_IN",
        "error": "Browser is open but no readable Taqeem page was detected yet",
        "browserOpen": True,
        "checkedUrls": checked_urls,
    }


async def check_browser_status():
    global browser
    if browser is None:
        return {
            "status": "FAILED",
            "error": "No browser instance",
            "browserOpen": False,
        }

    try:
        result = await inspect_taqeem_browser_session(browser)
        if result.get("status") == "FAILED" and result.get("browserOpen") is False:
            await closeBrowser()
        return {key: value for key, value in result.items() if key != "page"}
    except Exception as e:
        # Browser instance exists but is not actually running
        await closeBrowser()
        return {"status": "FAILED", "error": str(e), "browserOpen": False}


async def new_tab(url):
    global browser
    if browser:
        try:
            new_tab = await browser.get(url, new_tab=True)
            return new_tab
        except Exception as e:
            return {"status": "FAILED", "error": str(e)}


async def new_window(url):
    global browser
    if browser:
        try:
            new_window = await browser.get(url, new_window=True)
            return new_window
        except Exception as e:
            return {"status": "FAILED", "error": str(e)}


async def closeBrowser():
    global browser, page, refresh_task

    if refresh_task:
        refresh_task.cancel()
        refresh_task = None

    if browser:
        try:
            browser.stop()
        except Exception:
            pass
    browser, page = None, None


def set_page(new_page):
    global page
    page = new_page


def get_page():
    global page
    return page


async def navigate(url: str):
    def _sanitize(u: str) -> str:
        return (u or "").strip().strip('"\\' + "'")

    url = _sanitize(url)
    browser = await get_browser()

    if not _is_valid_http_url(url):
        log(f"Invalid URL -> '{url}'", "ERR")
        page = await browser.new_page()
        return page

    # Try once, then restart browser and retry once more if transport fails
    for attempt in range(2):
        try:
            return await browser.get(url)
        except Exception as e:
            log(f"browser.get() failed (try {attempt + 1}/2): {e}", "WARN")
            try:
                page = await browser.new_page()
                await page.evaluate("url => { window.location.href = url; }", url)
                return page
            except Exception as e2:
                log(f"fallback window.location failed: {e2}", "WARN")
                if attempt == 0:
                    # restart browser and retry
                    try:
                        await closeBrowser()
                    except Exception:
                        pass
                    # get_browser() will recreate
                    browser = await get_browser()
                else:
                    # give up with a blank page
                    try:
                        return await browser.new_page()
                    except Exception:
                        raise


def _is_valid_http_url(url: str) -> bool:
    try:
        parts = urlparse(url)
        return parts.scheme in ("http", "https") and bool(parts.netloc)
    except Exception:
        return False


async def _periodic_refresh(interval_minutes=1):
    global browser

    interval_seconds = interval_minutes * 60

    while True:
        try:
            await asyncio.sleep(interval_seconds)

            if not browser:
                continue

            page = browser.main_tab
            if not page:
                continue

            current_url = await page.evaluate("window.location.href")
            if not current_url:
                continue

            await page.get(current_url)

            print(
                json.dumps(
                    {
                        "type": "DEBUG",
                        "message": f"Headless session refreshed: {current_url}",
                    }
                ),
                flush=True,
            )

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(
                json.dumps(
                    {"type": "WARN", "message": f"Periodic refresh failed: {e}"}
                ),
                flush=True,
            )
