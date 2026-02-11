import asyncio, json
from scripts.core.browser import get_browser, switch_to_headless, closeBrowser


async def wait_until_logged_in(page, timeout=340, poll=2):
    import time

    target_host = "https://qima.taqeem.sa/"
    start = time.time()

    while time.time() - start < timeout:
        try:
            browser = await get_browser()
            page = browser.main_tab

            if not page:
                await asyncio.sleep(poll)
                continue

            url = await page.evaluate("window.location.href")
            current_url = (url or "").strip().lower()

            if current_url.startswith(target_host.lower()):
                return {"status": "SUCCESS", "url": current_url}

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


<<<<<<< HEAD
async def public_login_flow(login_url, is_auth = False):
=======
async def get_user_id(page):
    await page.get("https://qima.taqeem.sa/valuer/profile")
    user_id = await wait_for_element(
        page,
        ".appBox .d-flex.justify-content-between.border-top.mt-md.flex-wrap .fs-xs:nth-of-type(1) span",
    )
    if not user_id:
        return None
    user_id = user_id.text.strip()
    if user_id:
        print(json.dumps(user_id), flush=True)
        return user_id
    else:
        return None


async def public_login_flow(login_url, is_auth=False):
>>>>>>> 8d039f7 (fixing file paths)
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

    # Step 3: switch to headless
    switched = await switch_to_headless()
    print(json.dumps(str(switched)), flush=True)

    if switched["status"] != "SUCCESS":
        return switched

    if not is_auth:
<<<<<<< HEAD
        # Keep the user on home page after manual login and avoid profile scraping.
        # Username resolution is handled on the frontend from cached linked account data.
        return {"status": "CHECK", "user_id": None}
=======
        browser = await get_browser()
        page = browser.main_tab

        user_id = await get_user_id(page)

        return {"status": "CHECK", "user_id": user_id}
>>>>>>> 8d039f7 (fixing file paths)

    return {"status": "SUCCESS"}
