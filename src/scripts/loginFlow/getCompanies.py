import asyncio
import json
import re
import sys

from scripts.submission.taqeemNew.flow import (
    APP_HOST, REPORTS_URL, _click_text, _host, _wait_for_app_page,
)

FACILITY_TESTID = "createReportFacility"
_ID_RE = re.compile(r"\d{5,}")

_OPEN_JS = f"""
(() => {{
  const v = [...document.querySelectorAll("mat-select[data-testid='{FACILITY_TESTID}']")]
    .filter(e => e.getBoundingClientRect().width > 0);
  if (!v.length) return 'missing';
  const s = v[v.length - 1];
  if (s.getAttribute('aria-expanded') === 'true') return 'open';
  (s.querySelector('.mat-mdc-select-trigger') || s).click();
  return 'clicked';
}})()
"""

_READ_JS = f"""
(() => {{
  const v = [...document.querySelectorAll("mat-select[data-testid='{FACILITY_TESTID}']")]
    .filter(e => e.getBoundingClientRect().width > 0);
  const s = v[v.length - 1];
  const panel = s && document.getElementById(s.getAttribute('aria-controls') || '');
  const root = panel || document.querySelector('.cdk-overlay-container');
  return JSON.stringify([...root.querySelectorAll('mat-option')].map(o => ({{
    text: (o.textContent || '').replace(/\\s+/g, ' ').trim(),
    dis: o.getAttribute('aria-disabled') === 'true',
    html: o.outerHTML.slice(0, 300)
  }})));
}})()
"""


def _fail(msg):
    return {"status": "FAILED", "error": msg, "data": []}


async def get_companies(browser):
    page = None
    try:
        page = await browser.get(REPORTS_URL, new_tab=True)
        await asyncio.sleep(3)

        url = await _wait_for_app_page(page)
        if _host(url) != APP_HOST:
            return _fail(f"Not signed in on the evaluators site (landed on {url}).")

        for n in (1, 2):
            if not await _click_text(page, "إنشاء تقرير", timeout=30):
                return _fail(f"Create-report button {n} not found")
            await asyncio.sleep(2)

        # Open the dropdown and read options, retrying while the dialog settles.
        opts = []
        for _ in range(15):
            try:
                state = await page.evaluate(_OPEN_JS)
                if state != "missing":
                    opts = json.loads(await page.evaluate(_READ_JS))
                    print(f"[DEBUG] raw options: {opts[:3]}", file=sys.stderr)
                    if any(o.get("text") for o in opts):
                        break
                    opts = []
            except Exception as e:
                print(f"[WARN] open/read retry: {e}", file=sys.stderr)
            await asyncio.sleep(0.7)

        if not opts:
            return _fail("Facility dropdown not found or has no options")

        companies, seen = [], set()
        for o in opts:
            text = (o.get("text") or "").strip()
            if o.get("dis") or not text:
                continue
            m = _ID_RE.search(text)
            fid = m.group(0) if m else text
            if fid in seen:
                continue
            seen.add(fid)
            companies.append({"name": text, "officeId": fid, "facilityId": fid})

        print(f"[INFO] facilities found: {len(companies)}", file=sys.stderr)
        if not companies:
            return _fail("Dropdown opened but no options were read")
        return {"status": "SUCCESS", "data": companies}
    except Exception as e:
        return _fail(str(e))
    finally:
        if page:
            try:
                await page.close()
            except Exception:
                pass
