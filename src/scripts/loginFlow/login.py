import asyncio
import json
import os
import re
import time
import traceback
import imaplib
import email
from scripts.core.browser import closeBrowser
from scripts.core.utils import wait_for_element
from .navigation import post_login_navigation

def _sanitize_otp(raw):
    if not raw:
        return None
    match = re.search(r"(\d{6})", str(raw))
    return match.group(1) if match else None

def _fetch_latest_otp_once(host, user, password, from_addr):
    """Blocking IMAP fetch of the newest unseen OTP email, returns 6-digit code or None."""
    with imaplib.IMAP4_SSL(host) as mail:
        mail.login(user, password)
        mail.select("INBOX")
        status, data = mail.search(None, '(UNSEEN)')
        if status != "OK" or not data or not data[0]:
            return None
        for msg_id in reversed(data[0].split()):
            status, msg_data = mail.fetch(msg_id, "(RFC822)")
            if status != "OK" or not msg_data or not msg_data[0]:
                continue
            msg = email.message_from_bytes(msg_data[0][1])
            # if from_addr and msg.get("From") and from_addr.lower() not in msg.get("From", "").lower():
            #     continue


            body = ""
            if msg.is_multipart():
                for part in msg.walk():
                    ctype = part.get_content_type()
                    if ctype in ("text/plain", "text/html"):
                        try:
                            body += part.get_payload(decode=True).decode(errors="ignore")
                        except Exception:
                            pass
            else:
                try:
                    body = msg.get_payload(decode=True).decode(errors="ignore")
                except Exception:
                    body = msg.get_payload()
            match = re.search(r"(\b\d{6})", body or "")
            if match:
                return match.group(1)
    return None


async def fetch_email_otp(timeout=180, poll_interval=5):
    """Poll IMAP for a 6-digit OTP code within timeout seconds."""
    host = os.getenv("OTP_IMAP_HOST", "imap.gmail.com")
    user = os.getenv("OTP_EMAIL_USER")
    pwd = os.getenv("OTP_EMAIL_PASS")
    from_addr = os.getenv("OTP_EMAIL_FROM", "eservices@taqeem.gov.sa")

    def _mask(val: str):
        if not val:
            return ""
        if "@" in val:
            name, dom = val.split("@", 1)
            return f"{name[:2]}***@{dom}"
        return val[:2] + "***"

    if not user or not pwd:
        print(json.dumps({
            "type": "DEBUG",
            "message": "OTP email credentials missing",
            "host": host,
            "user": _mask(user) if user else "",
            "from": from_addr
        }), flush=True)
        return None

    print(json.dumps({
        "type": "DEBUG",
        "message": "Starting OTP email poll",
        "host": host,
        "user": _mask(user),
        "from": from_addr,
        "timeout_sec": timeout,
        "poll_interval_sec": poll_interval
    }), flush=True)

    end_time = time.time() + timeout
    attempt = 0
    while time.time() < end_time:
        attempt += 1
        try:
            code = await asyncio.to_thread(_fetch_latest_otp_once, host, user, pwd, from_addr)
            if code:
                print(json.dumps({
                    "type": "DEBUG",
                    "message": "OTP received from email",
                    "attempt": attempt
                }), flush=True)
                return code
            else:
                print(json.dumps({
                    "type": "DEBUG",
                    "message": "No OTP found yet",
                    "attempt": attempt
                }), flush=True)
        except Exception as e:
            print(json.dumps({
                "type": "DEBUG",
                "message": f"IMAP fetch error: {e}",
                "attempt": attempt
            }), flush=True)
        await asyncio.sleep(poll_interval)

    print(json.dumps({
        "type": "DEBUG",
        "message": "Timed out waiting for OTP from email",
        "attempts": attempt
    }), flush=True)
    return None


async def submit_otp_with_retries(page, fetch_fn, max_attempts=3):
    """Fetch OTP and submit with limited retries on OTP failure."""
    last_error = None
    for attempt in range(1, max_attempts + 1):
        try:
            otp_code = await fetch_fn()
        except Exception as e:
            otp_code = None
            last_error = str(e)
        otp_code = _sanitize_otp(otp_code)
        if not otp_code:
            print(json.dumps({
                "type": "DEBUG",
                "message": "OTP fetch returned no 6-digit code",
                "attempt": attempt
            }), flush=True)
            await asyncio.sleep(1)
            continue

        print(json.dumps({
            "type": "DEBUG",
            "message": "Submitting OTP",
            "attempt": attempt
        }), flush=True)

        result = await submitOtp(page, otp_code)
        status = result.get("status")
        if status == "SUCCESS":
            return result
        if status == "OTP_FAILED":
            last_error = result
            continue
        return result

    return last_error or {"status": "FAILED", "error": "OTP submission failed after retries"}


async def startLogin(page, email, password, method, auto_otp=False):
    try:

        if method == "SMS":
            method_selector = await wait_for_element(page, "#otpMethod", 10)
            if method_selector:
                sms_option = await method_selector.query_selector("[value='SMS']")
                if sms_option:
                    await sms_option.select_option()
                    await asyncio.sleep(0.5)

        email_input = await wait_for_element(page, "#username", 30)
        if not email_input:
            msg = {"status": "FAILED", "error": "Email input not found"}
            print(json.dumps(msg), flush=True)
            return msg

        await email_input.send_keys(email)

        password_input = await wait_for_element(page, "input[type='password']", 30)
        if not password_input:
            msg = {"status": "FAILED", "error": "Password input not found"}
            print(json.dumps(msg), flush=True)
            return msg

        await password_input.send_keys(password)

        login_btn = await wait_for_element(page, "#kc-login", 30)
        if not login_btn:
            msg = {"status": "FAILED", "error": "Login button not found"}
            print(json.dumps(msg), flush=True)
            return msg

        await login_btn.click()
        error_text_1 = "user_not_found."
        error_text_2 = "Invalid username or password."
        await asyncio.sleep(3)

        html_content = await page.get_content()
        if error_text_1 in html_content or error_text_2 in html_content:
            msg = {"status": "NOT_FOUND", "error": "User not found", "recoverable": True}
            print(json.dumps(msg), flush=True)
            return msg

        otp_field = await wait_for_element(page, "#otp, input[type='tel'], input[name='otp'], #emailCode, #verificationCode", 15)
        if otp_field:
            if auto_otp or method == "AUTO":
                result = await submit_otp_with_retries(page, fetch_email_otp, max_attempts=3)
                if isinstance(result, dict):
                    if result.get("status") == "SUCCESS":
                        return result
                    if result.get("status") == "OTP_FAILED":
                        return {"status": "FAILED", "error": "OTP invalid after retries"}
                    if result.get("status"):
                        return result
                msg = {"status": "FAILED", "error": "OTP not received from email"}
                print(json.dumps(msg), flush=True)
                return msg
            msg = {"status": "OTP_REQUIRED"}
            return msg

        dashboard = await wait_for_element(page, "#dashboard", 10)
        if dashboard:
            msg = {"status": "LOGIN_SUCCESS"}
            print(json.dumps(msg), flush=True)
            return msg

        msg = {"status": "FAILED", "error": "Unknown login state"}
        return msg

    except Exception as e:
        tb = traceback.format_exc()
        msg = {"status": "FAILED", "error": str(e), "traceback": tb}
        print(json.dumps(msg), flush=True)
        return msg

async def submitOtp(page, otp, record_id=None):
    if not page:
        msg = {"status": "FAILED", "recordId": record_id, "error": "No login session"}
        print(json.dumps(msg), flush=True)
        return msg

    try:
        otp_input = await wait_for_element(page, "#otp, input[type='tel'], input[name='otp'], #emailCode, #verificationCode", 30)
        if not otp_input:
            await closeBrowser()
            msg = {"status": "FAILED", "recordId": record_id, "error": "OTP input not found"}
            print(json.dumps(msg), flush=True)
            return msg

        await otp_input.click()
        await otp_input.send_keys(otp)
        await asyncio.sleep(0.5)

        verify_btn = None
        for sel in [
            "input[name='login'][type='submit']",
            "input[name='login']",
            "button[type='submit']",
            "button[name='login']",
            ".login-button",
            "input[type='submit']"
        ]:
            verify_btn = await wait_for_element(page, sel, timeout=3)
            if verify_btn:
                break

        if not verify_btn:
            await closeBrowser()
            msg = {"status": "FAILED", "recordId": record_id, "error": "Verify button not found"}
            print(json.dumps(msg), flush=True)
            return msg

        await verify_btn.click()
        await asyncio.sleep(3)
        error_message = await wait_for_element(page, "#input-error-otp-code", timeout=1)

        # Convert debug prints to JSON messages
        debug_msg = {"type": "DEBUG", "message": "Looking for error message"}
        print(json.dumps(debug_msg), flush=True)

        if error_message:
            error_text = error_message.text
            debug_msg = {"type": "DEBUG", "message": f"Error message found: {error_text}"}
            print(json.dumps(debug_msg), flush=True)

            msg = {"status": "OTP_FAILED", "message": "Try Again", "recoverable": True}
            print(json.dumps(msg), flush=True)
            return msg

        nav_result = await post_login_navigation(page)
        if nav_result["status"] == "SUCCESS":
            msg = {"status": "SUCCESS", "recordId": record_id}
            print(json.dumps(msg), flush=True)
            return msg

        dashboard = await wait_for_element(page, "#dashboard, .dashboard, .welcome, [class*='success']", 15)
        if dashboard:
            msg = {"status": "SUCCESS", "recordId": record_id, "warning": "Navigation skipped (dashboard found)"}
            print(json.dumps(msg), flush=True)
            return msg

        await closeBrowser()
        msg = {"status": "FAILED", "recordId": record_id, **nav_result}
        print(json.dumps(msg), flush=True)
        return msg

    except Exception as e:
        await closeBrowser()
        tb = traceback.format_exc()
        msg = {"status": "FAILED", "recordId": record_id, "error": str(e), "traceback": tb}
        print(json.dumps(msg), flush=True)
        return msg
