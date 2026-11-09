"""
scripts/submission/taqeemNew/flow.py

The "new" Taqeem evaluators-site script, adapted to run INSIDE the existing
Python worker:
  * no login (the old login system already did that)
  * uses the worker's already-open browser instead of its own
  * never blocks forever: failures return a result dict instead of
    `await asyncio.Event().wait()`
  * every print() goes to stderr (stdout is the JSON channel to Electron)

Data: the real PDF and the real TEXT / DATE fields come from the DB record
(see steps.py). Everything else (dropdowns, report number, participants) is
still dummy data.
"""
import asyncio
import functools
import json
from scripts.core.httpClient import http_patch
import os
import random
import shutil
import string
import sys
import tempfile
import traceback
import re
from nodriver import cdp
from urllib.parse import urlparse

from .steps import fetch_record, real_amount, real_approaches, real_coords, real_region_city, real_step1, real_step2

# stdout is reserved for JSON replies to Electron -> send all debug prints to stderr
print = functools.partial(print, file=sys.stderr, flush=True)

from scripts.core.utils import log

from .data_filler import (
    ALL,
    TODAY,
    click_button_by_icon,
    click_button_scoped,
    click_testid_button,
    close_modal_by_empty_click,
    fill_asset_form,
    fill_form,
    fill_method_form,
    inspect_form_step,
    report_invalid,
    select_mat_option,
    set_number,
    wait_form_ready,
)
from .steps import fetch_record, real_amount, real_coords, real_step1, real_step2

HERE = os.path.dirname(os.path.abspath(__file__))
DUMMY_PDF = os.path.join(HERE, "test.pdf")

REPORTS_URL = "https://eservices-evaluators.taqeem.gov.sa/my-reports"
APP_HOST = "eservices-evaluators.taqeem.gov.sa"
AMOUNT = 1000000
MAX_PDF_NAME = 50  # Taqeem rejects file names longer than 50 characters

# ── Dummy data (defaults; real values from steps.py are merged over these) ───


def _report_number() -> str:
    return (
        random.choice(string.ascii_uppercase)
        + "".join(random.choices(string.digits, k=5))
        + random.choice(string.ascii_uppercase)
    )


def _step1_data() -> dict:
    # Built per call so every click gets a fresh report number.
    return {
        "نوع التقرير": "سردي (شامل)",
        "رقم التقرير": _report_number(),
        "اسم العميل": "Example Person",
        "الغرض من التقييم": "رهن عقاري",
        "تاريخ المعاينة": TODAY,
        "تاريخ التقييم": TODAY,
        "تاريخ إصدار التقرير": TODAY,
        "أساس القيمة": "القيمة السوقية",
        "فرضية القيمة": "أعلى وأفضل استخدام",
    }



STEP1_PARTICIPANTS = [
    {"المقيم": "1210000414", "نسبة المشاركة (%)": 100, "الأدوار": ALL},
]

STEP2_DATA = {
    "نوع الأصل": "فيلا",
    "الاستخدام الحالي للأرض": "سكني",
    "رقم صك الملكية أو السجل العيني": "1234567890",
    "اسم المالك": "Example Owner",
    "رقم القطعة": "1234",
    "رقم البلوك": "56",
    "مساحة الأرض (متر مربع)": "500",
    "مساحة المبنى (متر مربع)": "300",
}
STEP2_LATE = {"المنطقة": "الرياض", "المدينة": "الرياض"}  # filled last, in order
STEP2_LAT = "24.7136"
STEP2_LNG = "46.6753"

# ── Small helpers (replace the old utils.py imports) ─────────────────────────


async def _url(page) -> str:
    try:
        return await page.evaluate("window.location.href") or ""
    except Exception:
        return ""


async def _click_text(page, text: str, timeout: float = 20) -> bool:
    """Click the first visible, enabled <button> whose text contains `text`."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    js = f"""
    (() => {{
        const vis = e => e.getBoundingClientRect().width > 0;
        const want = {json.dumps(text, ensure_ascii=False)};
        const b = [...document.querySelectorAll('button')]
            .find(b => vis(b) && !b.disabled && (b.innerText || '').includes(want));
        if (!b) return false;
        b.scrollIntoView({{block: 'center'}});
        b.click();
        return true;
    }})()
    """
    while loop.time() < deadline:
        if await page.evaluate(js):
            print(f"[+] Clicked {text!r}")
            return True
        await asyncio.sleep(0.3)
    print(f"[!] {text!r} never clickable")
    return False


def _short_pdf_copy(src: str, record_id=None, max_len: int = MAX_PDF_NAME) -> str:
    """Copy the PDF to a short, safe name so Taqeem's 50-char limit is never hit.
    Copies (never renames), so the original download stays untouched."""
    stem = str(record_id or "report")
    name = f"{stem}.pdf"
    if len(name) > max_len:
        name = stem[: max_len - 4] + ".pdf"
    dst_dir = os.path.join(tempfile.gettempdir(), "taqeem-upload")
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, name)
    shutil.copyfile(src, dst)
    return dst


async def upload_file(page, path: str, testid: str = "input", timeout: float = 20) -> bool:
    """Attach a file to <input type=file> via CDP (no OS dialog)."""
    loop = asyncio.get_event_loop()
    abs_path = os.path.abspath(path)
    if not os.path.isfile(abs_path):
        print(f"[!] File not found: {abs_path}")
        return False

    el = None
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        el = await page.query_selector(
            f"input[type='file'][data-testid='{testid}']"
        ) or await page.query_selector("input[type='file']")
        if el:
            break
        await asyncio.sleep(0.3)
    if not el:
        info = await page.evaluate("""JSON.stringify({
            fileInputs: document.querySelectorAll('input[type=file]').length,
            origin: (document.querySelector('app-report-step-origin')?.innerHTML || '').slice(0, 1500),
            dialogs: [...document.querySelectorAll('mat-dialog-container, .cdk-overlay-pane')]
                .filter(e => e.getBoundingClientRect().width > 0)
                .map(e => (e.innerText || '').trim().slice(0, 80)),
        })""")
        print(f"[!] file input never appeared: {info}")
        return False

    await el.send_file(abs_path)
    await el.apply(
        "(e) => { e.dispatchEvent(new Event('input', {bubbles: true}));"
        " e.dispatchEvent(new Event('change', {bubbles: true})); }"
    )
    await asyncio.sleep(1)
    name = await el.apply("(e) => e.files && e.files[0] ? e.files[0].name : ''")
    print(f"[{'+' if name else '!'}] file input holds: {name!r}")
    return bool(name)

# ── Report-ID capture (passive CDP network listener) ─────────────────────────
_UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
_SAVE_NEXT_RE = re.compile(r"/valuation-report/save-and-next(?:[?#]|$)")
_REPORT_URL_RE = re.compile(rf"/valuation-report/({_UUID})(?:[/?#]|$)")

_current_capture = None   # one run at a time in the worker; _fail() reads this


class ReportIdCapture:
    """Watches the tab's network traffic and records the Taqeem report id.
    Primary source : `reportId` in the save-and-next POST response body.
    Fallback/check : UUID in the URL of /valuation-report/<uuid> requests."""

    def __init__(self):
        self.body_id = None
        self.body_number = None      # system-assigned number (RPT-2026-...)
        self.url_id = None
        self._post_requests = set()
        self._tasks = set()

    async def attach(self, page):
        page.add_handler(cdp.network.RequestWillBeSent, self._on_request)
        page.add_handler(cdp.network.ResponseReceived, self._on_response)
        await page.send(cdp.network.enable())

    def _on_request(self, ev):
        try:
            url, method = ev.request.url, (ev.request.method or "").upper()
            if method == "POST" and _SAVE_NEXT_RE.search(url):
                self._post_requests.add(ev.request_id)
            m = _REPORT_URL_RE.search(url)
            if m and method != "OPTIONS" and self.url_id is None:
                self.url_id = m.group(1).lower()
        except Exception:
            pass

    def _on_response(self, ev):
        if ev.request_id in self._post_requests and self.body_id is None:
            t = asyncio.ensure_future(self._read_body(ev.request_id))
            self._tasks.add(t)
            t.add_done_callback(self._tasks.discard)

    async def _read_body(self, request_id):
        # body is only available once loading finished -> retry briefly
        for _ in range(8):
            try:
                body, b64 = await self._page.send(cdp.network.get_response_body(request_id))
                data = json.loads(body)
                if isinstance(data, dict):
                    data = data.get("data") if isinstance(data.get("data"), dict) and "reportId" not in data else data
                rid = (data or {}).get("reportId")
                if rid:
                    if self.body_id is None:
                        self.body_id = str(rid).lower()
                        self.body_number = (data or {}).get("reportNumber")
                        log(f"[taqeemNew] captured reportId={self.body_id} "
                            f"(system number {self.body_number})", "OK")
                    elif self.body_id != str(rid).lower():
                        log(f"[taqeemNew] later save-and-next returned a DIFFERENT "
                            f"reportId {rid} (kept {self.body_id})", "WARN")
                return
            except Exception:
                await asyncio.sleep(0.3)

    async def settle(self, timeout: float = 5):
        if self._tasks:
            await asyncio.wait(list(self._tasks), timeout=timeout)

    @property
    def report_id(self):
        if self.body_id and self.url_id and self.body_id != self.url_id:
            log(f"[taqeemNew] reportId mismatch: body={self.body_id} url={self.url_id}; "
                "using body value", "WARN")
        return self.body_id or self.url_id

async def _fail(page, step: str, error: str, record_id=None) -> dict:
    """Log, dump the page's form state for debugging (to the temp dir), return a FAILED dict."""
    log(f"[taqeemNew] {step}: {error}", "ERR")
    try:
        await report_invalid(page)
        await inspect_form_step(
            page, os.path.join(tempfile.gettempdir(), f"taqeem_debug_{step}")
        )
    except Exception as e:
        print(f"[!] could not dump debug info: {e}")
    return {
        "status": "FAILED",
        "step": step,
        "error": error,
        "url": await _url(page),
        "record_id": record_id,
        "draft_report_id": _current_capture.report_id if _current_capture else None,
    }


# ── Main entry point ─────────────────────────────────────────────────────────

def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


async def _wait_for_app_page(page, timeout: float = 20) -> str:
    """Wait until the tab is on the app host (checked by hostname, not substring)
    and the OIDC callback fragment (#state=...&code=...) has been consumed."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    url = ""
    while loop.time() < deadline:
        url = await _url(page)
        if _host(url) == APP_HOST and "code=" not in url.split("#", 1)[-1]:
            return url
        await asyncio.sleep(0.5)
    return url


async def _wait_for_review_page(page, report_number: str, timeout: float = 30) -> bool:
    """True once the step-5 review page is showing THIS run's report number."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout
    js = f"""
    (() => {{
        const t = document.body.innerText || '';
        return t.includes({json.dumps(report_number)})
            && t.includes('المشاركون في إعداد التقرير')
            && t.includes('قيمة الرأي النهائي في التقرير');
    }})()
    """
    while loop.time() < deadline:
        try:
            if await page.evaluate(js):
                return True
        except Exception:
            pass
        await asyncio.sleep(0.5)
    return False


async def run_taqeem_new_flow(browser, record_id=None, pdf_path=None, approaches=None, facility_id=None):
    facility = str(facility_id or "").strip()
    if not facility:
        return {"status": "FAILED", "step": "facility",
                "error": "No company (facility) selected.", "record_id": record_id}

    if pdf_path:
        pdf = os.path.abspath(pdf_path)
        if not os.path.isfile(pdf):
            return {
                "status": "FAILED",
                "step": "pdf_missing",
                "error": f"Downloaded PDF not found on disk: {pdf}",
                "record_id": record_id,
            }
        try:
            pdf = _short_pdf_copy(pdf, record_id)
        except Exception as e:
            return {
                "status": "FAILED",
                "step": "pdf_copy",
                "error": f"Could not prepare PDF for upload: {e}",
                "record_id": record_id,
            }
        log(f"[taqeemNew] Using real PDF, uploading as {os.path.basename(pdf)}", "STEP")
    else:
        pdf = DUMMY_PDF
        log("[taqeemNew] No pdf_path supplied, using dummy test.pdf", "WARN")

    # ── Real data (fetched BEFORE opening the browser; abort rather than submit
    #    dummy data to the real site if the record can't be loaded) ───────────
    step1 = _step1_data()
    step2 = dict(STEP2_DATA)
    step2_late = dict(STEP2_LATE)
    lat, lng, amount = STEP2_LAT, STEP2_LNG, AMOUNT
    record = {}
    if record_id:
        try:
            record = await fetch_record(record_id)
        except Exception as e:
            return {
                "status": "FAILED",
                "step": "fetch_record",
                "error": f"Could not load record {record_id}: {e}",
                "record_id": record_id,
            }
        step1.update(real_step1(record))
        step2.update(real_step2(record))
        step2_late = real_region_city(
        record, STEP2_LATE["المنطقة"], STEP2_LATE["المدينة"])
        lat, lng = real_coords(record, lat, lng)
        amount = real_amount(record, amount)
    else:
        log("[taqeemNew] No record_id supplied, using all dummy data", "WARN")

    rows = real_approaches(approaches, amount, record)

    try:
        log("[taqeemNew] Opening my-reports", "STEP")
        page = await browser.get(REPORTS_URL, new_tab=True)
        await asyncio.sleep(3)

        url = await _wait_for_app_page(page)
        if _host(url) != APP_HOST:
            return {
                "status": "FAILED",
                "step": "auth",
                "error": f"Not signed in on the evaluators site (landed on {url}). "
                "The SSO session from the old login wasn't picked up.",
                "record_id": record_id,
            }

        global _current_capture
        capture = ReportIdCapture()
        await capture.attach(page)
        _current_capture = capture

        # --- Create report (the original clicks this twice: page button, then dialog) ---
        if not await _click_text(page, "إنشاء تقرير", timeout=30):
            return await _fail(page, "create_report_1", "Create-report button not found", record_id)
        await asyncio.sleep(2)
        if not await _click_text(page, "إنشاء تقرير", timeout=30):
            return await _fail(page, "create_report_2", "2nd create-report button not found", record_id)
        await asyncio.sleep(2)

        # --- Facility + continue ---
        if not await select_mat_option(page, "createReportFacility", facility):
            return await _fail(page, "facility", "Failed to select facility", record_id)
        if not await click_testid_button(page, "continue"):
            return await _fail(page, "continue", "Continue button not clickable", record_id)
        await asyncio.sleep(2)

        if not await close_modal_by_empty_click(page):
            log("[taqeemNew] Modal did not close", "WARN")

        # --- Step 1 ---
        if not await wait_form_ready(page, ready_label="نوع التقرير"):
            return await _fail(page, "step1_load", "Step 1 form never loaded", record_id)
        ok = await fill_form(page, step1, STEP1_PARTICIPANTS)
        log(f"[taqeemNew] Step 1 filled ok={ok}", "OK" if ok else "WARN")
        await asyncio.sleep(0.5)
        if not await _click_text(page, "حفظ ومتابعة", timeout=15):
            return await _fail(page, "step1_save", "Step 1 save button not clickable", record_id)

        # --- Step 2: asset ---
        if not await _click_text(page, "إضافة أصل", timeout=30):
            return await _fail(page, "add_asset", "Add-asset button not found", record_id)
        if not await wait_form_ready(page, ready_label="رقم القطعة"):
            return await _fail(page, "asset_load", "Asset form never loaded", record_id)

        ok2 = await fill_asset_form(page, step2, step2_late, lat, lng)
        log(f"[taqeemNew] Asset form filled ok={ok2}", "OK" if ok2 else "WARN")
        await asyncio.sleep(2)

        if not await click_button_scoped(page, ["حفظ وإضافة الأصل"], timeout=20):
            return await _fail(page, "asset_save", "'حفظ وإضافة الأصل' never became enabled", record_id)
        if not await wait_form_ready(page, gone_label="رقم القطعة", timeout=40):
            return await _fail(page, "asset_gone", "Still on the asset form after saving", record_id)
        await asyncio.sleep(2)

        if not await click_button_scoped(page, ["حفظ ومتابعة"], timeout=30):
            return await _fail(page, "asset_continue", "Continue after asset not clickable", record_id)
        await asyncio.sleep(3)
        await wait_form_ready(page)

        # --- Step 3: valuation method ---
        if not await wait_form_ready(page, ready_selector="app-report-step-method"):
            return await _fail(page, "step3_load", "Step 3 never loaded", record_id)

        for n, row in enumerate(rows, 1):
            if not await click_button_by_icon(page, "إضافة الأسلوب والطريقة", has_icon=True):
                return await _fail(page, f"method_open_{n}", "Method opener not clickable", record_id)
            if not await wait_form_ready(
                page, ready_selector="mat-radio-group[data-testid='methodType']"
            ):
                return await _fail(page, f"method_form_{n}", "Method form did not open", record_id)
            await asyncio.sleep(1)

            if not await fill_method_form(
                page, row["hint"], row["value"], row["method_type"], row["weight"]
            ):
                return await _fail(page, f"method_fill_{n}", f"Method fill failed ({row['hint']})", record_id)
            await asyncio.sleep(1)

            if not await click_button_by_icon(
                page, "إضافة الأسلوب والطريقة", has_icon=False, timeout=20
            ):
                return await _fail(page, f"method_submit_{n}", "Method submit failed", record_id)
            await asyncio.sleep(2)

        await set_number(page, "رقم الأصل 1", amount)   # final value stays finalAssetValue
        await asyncio.sleep(1)

        if not await click_button_scoped(page, ["حفظ ومتابعة"], timeout=30):
            return await _fail(page, "step3_save", "Step 3 save failed", record_id)
        await asyncio.sleep(3)

        # --- Step 4: upload PDF ---
        if not await wait_form_ready(page, ready_selector="app-report-step-origin"):
            return await _fail(page, "step4_load", "Step 4 never loaded", record_id)

        if not await upload_file(page, pdf):
            return await _fail(page, "step4_upload", f"PDF upload failed ({pdf})", record_id)
        if not await click_button_scoped(page, ["حفظ ومتابعة"], timeout=60):
            return await _fail(page, "step4_save", "Step 4 save failed", record_id)
        await asyncio.sleep(3)

        # --- Step 5: review page = success ---
        if not await _wait_for_review_page(page, step1["رقم التقرير"]):
            return await _fail(page, "step5_review",
                               "Review page never showed our report number", record_id)
        log("[taqeemNew] Review page reached, report created", "OK")
        await capture.settle()
        report_id = capture.report_id
        db_saved, db_error = False, None
        if report_id:
            db_key = record.get("_id") or record_id   # same key the old flow used
            try:
                await http_patch(
                    f"transactions/{db_key}/set-report-id",
                    json={"report_id": report_id},
                )
                db_saved = True
                log(f"[taqeemNew] saved report_id {report_id} to record {db_key}", "OK")
            except Exception as e:
                db_error = str(e)
                log(f"[taqeemNew] report created but DB save failed: {e}", "ERR")
        else:
            log("[taqeemNew] no reportId captured, skipping DB save", "WARN")

        result = {
            "status": "SUCCESS",
            "message": "Report created; review page reached.",
            "record_id": record_id,
            "report_number": step1["رقم التقرير"],
            "taqeem_report_id": report_id,                      # the UUID to store
            "taqeem_system_report_number": capture.body_number, # RPT-2026-...
            "report_id_missing": report_id is None,
            "report_id_saved": db_saved,
            "report_id_save_error": db_error,
        }
        try:
            await page.close()
        except Exception as e:
            log(f"[taqeemNew] could not close tab: {e}", "WARN")
        return result

    except Exception as e:
        return {
            "status": "FAILED",
            "error": str(e),
            "traceback": traceback.format_exc(),
            "record_id": record_id,
        }
