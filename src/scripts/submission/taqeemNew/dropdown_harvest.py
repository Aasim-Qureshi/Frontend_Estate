"""
Harvest-only script: walks the Taqeem evaluators flow (same path as flow.py) and
records the options of EVERY dropdown / radio group it meets, including
cascading ones (region -> city, asset type -> dependent fields,
approach -> method). Output: one JSON file. No real data is submitted;
dummy data from flow.py is used only to advance between steps.
"""
import asyncio
import functools
import json
import os
import sys
import tempfile
import traceback
from datetime import datetime

print = functools.partial(print, file=sys.stderr, flush=True)

from scripts.core.utils import log

from .data_filler import (
    _close_overlays,
    _control_kind,
    _escape,
    _jeval,
    _opts_expr,
    _open_select,
    click_button_by_icon,
    click_button_scoped,
    click_testid_button,
    close_modal_by_empty_click,
    fill_asset_form,
    fill_form,
    fill_method_form,
    find_control_id,
    select_by_label,
    select_mat_option,
    select_radio,
    set_number,
    wait_form_ready,
)
from .flow import (
    AMOUNT,
    APP_HOST,
    DUMMY_PDF,
    FACILITY_ID,
    HERE,
    REPORTS_URL,
    STEP1_PARTICIPANTS,
    STEP2_DATA,
    STEP2_LAT,
    STEP2_LATE,
    STEP2_LNG,
    _click_text,
    _host,
    _step1_data,
    _wait_for_app_page,
    upload_file,
)

DEFAULT_OUT = os.path.join(HERE, "taqeem_dropdowns.json")

# ── low-level readers ────────────────────────────────────────────────────────


def _is_header(text: str) -> bool:
    """The 'select all' row of multi-selects (icon text leaks into innerText)."""
    return "check_box" in text or "indeterminate" in text


async def read_select_by_id(page, cid: str, retries: int = 2) -> dict:
    """Open the select #cid, read its options, close it. Never selects anything."""
    info = await _jeval(page, f"""(() => {{
        const e = document.getElementById({cid!r});
        if (!e) return null;
        return {{
            dis: e.getAttribute('aria-disabled') === 'true',
            multi: e.hasAttribute('multiple'),
            val: (e.querySelector('.mat-mdc-select-value-text')?.innerText || '').trim()
        }};
    }})()""")
    if not info:
        return {"error": "control not found", "options": []}
    if info["dis"]:
        return {"disabled": True, "multi": info["multi"], "options": []}

    texts, err = [], None
    for attempt in range(retries + 1):          # options of cascading selects can load late
        if not await _open_select(page, cid):
            err = "could not open / no options"
            await _close_overlays(page)
            await asyncio.sleep(0.8)
            continue
        opts = await _jeval(page, _opts_expr(cid))
        texts = [o["text"] for o in opts if not _is_header(o["text"])]
        await _escape(page)
        await asyncio.sleep(0.3)
        await _close_overlays(page)
        if texts:
            err = None
            break
        await asyncio.sleep(0.8)

    out = {"multi": info["multi"], "current": info["val"], "options": texts}
    if err and not texts:
        out["error"] = err
    return out


async def read_select(page, label: str, index: int = 0) -> dict:
    cid = await find_control_id(page, label, index, exact=True) \
          or await find_control_id(page, label, index)
    if not cid:
        return {"error": f"no field labelled {label!r}", "options": []}
    return await read_select_by_id(page, cid)


async def visible_labels(page) -> list:
    return await _jeval(page, r"""(() => [...document.querySelectorAll('input-label')]
        .filter(l => l.getBoundingClientRect().width > 0)
        .map(l => l.innerText.replace('*', '').replace(/\s+/g, ' ').trim()))()""")


async def harvest_visible_selects(page, skip=()) -> dict:
    """Every visible select/multi-select under an <input-label> + list of plain inputs."""
    result, inputs, seen = {}, [], {}
    for label in await visible_labels(page):
        idx = seen.get(label, 0)
        seen[label] = idx + 1
        if label in skip:
            continue
        cid = await find_control_id(page, label, idx, exact=True) \
              or await find_control_id(page, label, idx)
        if not cid:
            continue
        kind = await _control_kind(page, cid)
        if kind == "input":
            inputs.append(label)
            continue
        key = label if idx == 0 else f"{label} #{idx + 1}"
        result[key] = await read_select_by_id(page, cid)
        print(f"[i] {key}: {len(result[key].get('options', []))} options")
    if inputs:
        result["_plain_inputs"] = inputs
    return result


async def harvest_radios(page) -> dict:
    return await _jeval(page, r"""(() => {
        const out = {};
        document.querySelectorAll('mat-radio-group').forEach((g, i) => {
            if (g.getBoundingClientRect().width <= 0) return;
            const key = g.getAttribute('data-testid') || ('radio_group_' + i);
            out[key] = [...g.querySelectorAll('mat-radio-button')]
                .map(r => (r.innerText || '').trim());
        });
        return out;
    })()""")


async def harvest_cascade(page, parent: str, children: list) -> dict:
    """For EVERY option of `parent`: select it, then read each child select."""
    base = await read_select(page, parent)
    out = {"parent_options": base.get("options", []), "children": {}}
    for text in base.get("options", []):
        if not await select_by_label(page, parent, text):
            out["children"][text] = {"error": "could not select parent option"}
            continue
        await asyncio.sleep(0.8)
        out["children"][text] = {c: await read_select(page, c) for c in children}
        print(f"[i] cascade {parent}={text!r}: " + ", ".join(
            f"{c}={len(v.get('options', []))}" for c, v in out["children"][text].items()))
    return out


async def harvest_dependents(page, parent: str, skip: list) -> dict:
    """Select each option of `parent`; record only the OTHER selects whose options
    change compared to the baseline. Finds dependencies we don't know about."""
    baseline = await harvest_visible_selects(page, skip=[parent, *skip])
    baseline = {k: v for k, v in baseline.items() if k != "_plain_inputs"}
    base_opts = await read_select(page, parent)
    out = {"parent_options": base_opts.get("options", []), "changes": {}}
    for text in base_opts.get("options", []):
        if not await select_by_label(page, parent, text):
            out["changes"][text] = {"error": "could not select parent option"}
            continue
        await asyncio.sleep(0.8)
        now = await harvest_visible_selects(page, skip=[parent, *skip])
        diff = {k: v for k, v in now.items()
                if k != "_plain_inputs" and v.get("options") != baseline.get(k, {}).get("options")}
        out["changes"][text] = diff
        print(f"[i] {parent}={text!r}: {len(diff)} dependent select(s) changed")
    return out


# ── main entry point ─────────────────────────────────────────────────────────


async def run_dropdown_harvest(browser, out_path: str = None) -> dict:
    out_path = out_path or DEFAULT_OUT
    data = {"harvested_at": datetime.now().isoformat(timespec="seconds")}

    def save():
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"[+] saved {out_path}")

    def partial(step, error, page_url=""):
        log(f"[dropdownHarvest] {step}: {error}", "ERR")
        data["_error"] = {"step": step, "error": error}
        save()
        return {"status": "PARTIAL", "step": step, "error": error,
                "file": out_path, "url": page_url, "data": data}

    try:
        page = await browser.get(REPORTS_URL, new_tab=True)
        await asyncio.sleep(3)
        url = await _wait_for_app_page(page)
        if _host(url) != APP_HOST:
            return partial("auth", f"Not signed in on evaluators site (landed on {url})", url)

        # ── create report dialog + facility ─────────────────────────────────
        if not await _click_text(page, "إنشاء تقرير", timeout=30):
            return partial("create_report_1", "button not found", url)
        await asyncio.sleep(2)
        if not await _click_text(page, "إنشاء تقرير", timeout=30):
            return partial("create_report_2", "button not found", url)
        await asyncio.sleep(2)

        fac_id = await page.evaluate("""(() => {
            const v = [...document.querySelectorAll("mat-select[data-testid='createReportFacility']")]
                .filter(e => e.getBoundingClientRect().width > 0);
            return v.length ? v[v.length - 1].id : null;
        })()""")
        if fac_id:
            data["create_dialog"] = {"المنشأة (facility)": await read_select_by_id(page, fac_id)}
            save()

        if not await select_mat_option(page, "createReportFacility", FACILITY_ID):
            return partial("facility", "Failed to select facility")
        if not await click_testid_button(page, "continue"):
            return partial("continue", "Continue button not clickable")
        await asyncio.sleep(2)
        await close_modal_by_empty_click(page)

        # ── STEP 1 ──────────────────────────────────────────────────────────
        if not await wait_form_ready(page, ready_label="نوع التقرير"):
            return partial("step1_load", "Step 1 never loaded")
        await asyncio.sleep(1)
        data["step1"] = {
            "selects": await harvest_visible_selects(page),
            "radios": await harvest_radios(page),
        }
        save()

        # advance with dummy data
        await fill_form(page, _step1_data(), STEP1_PARTICIPANTS)
        await asyncio.sleep(0.5)
        if not await _click_text(page, "حفظ ومتابعة", timeout=15):
            return partial("step1_save", "Save & continue not clickable")

        # ── STEP 2: asset ───────────────────────────────────────────────────
        if not await _click_text(page, "إضافة أصل", timeout=30):
            return partial("add_asset", "Add-asset button not found")
        if not await wait_form_ready(page, ready_label="رقم القطعة"):
            return partial("asset_load", "Asset form never loaded")
        await asyncio.sleep(1)

        step2 = {"selects": await harvest_visible_selects(page),
                 "radios": await harvest_radios(page)}
        data["step2"] = step2
        save()

        # asset type -> which other selects change (usage etc.)
        step2["cascade_asset_type"] = await harvest_dependents(
            page, "نوع الأصل", skip=["المنطقة", "المدينة"])
        save()
        # region -> city
        step2["cascade_region_city"] = await harvest_cascade(page, "المنطقة", ["المدينة"])
        save()

        # advance with dummy data
        await fill_asset_form(page, dict(STEP2_DATA), STEP2_LATE, STEP2_LAT, STEP2_LNG)
        await asyncio.sleep(2)
        if not await click_button_scoped(page, ["حفظ وإضافة الأصل"], timeout=20):
            return partial("asset_save", "'حفظ وإضافة الأصل' never enabled")
        if not await wait_form_ready(page, gone_label="رقم القطعة", timeout=40):
            return partial("asset_gone", "Still on asset form after saving")
        await asyncio.sleep(2)
        if not await click_button_scoped(page, ["حفظ ومتابعة"], timeout=30):
            return partial("asset_continue", "Continue after asset not clickable")
        await asyncio.sleep(3)
        await wait_form_ready(page)

        # ── STEP 3: valuation method ────────────────────────────────────────
        if not await wait_form_ready(page, ready_selector="app-report-step-method"):
            return partial("step3_load", "Step 3 never loaded")
        if not await click_button_by_icon(page, "إضافة الأسلوب والطريقة", has_icon=True):
            return partial("method_open", "Method opener not clickable")
        if not await wait_form_ready(
                page, ready_selector="mat-radio-group[data-testid='methodType']"):
            return partial("method_form", "Method form did not open")
        await asyncio.sleep(1)

        step3 = {"radios": await harvest_radios(page), "by_method_type": {}}
        data["step3"] = step3
        for mtype in step3["radios"].get("methodType", []):
            if not await select_radio(page, "methodType", mtype):
                step3["by_method_type"][mtype] = {"error": "could not pick radio"}
                continue
            await asyncio.sleep(1)
            step3["by_method_type"][mtype] = {
                "asset_number": await read_select(page, "رقم الأصل"),
                "approach_to_method": await harvest_cascade(
                    page, "أسلوب التقييم", ["طريقة التقييم"]),
            }
            save()

        # advance with dummy data
        if not await fill_method_form(page, "السوق", AMOUNT):
            return partial("method_fill", "Method form fill failed")
        await asyncio.sleep(1)
        if not await click_button_by_icon(page, "إضافة الأسلوب والطريقة",
                                          has_icon=False, timeout=20):
            return partial("method_submit", "Method submit failed")
        await asyncio.sleep(2)
        await set_number(page, "رقم الأصل 1", AMOUNT)
        await asyncio.sleep(1)
        if not await click_button_scoped(page, ["حفظ ومتابعة"], timeout=30):
            return partial("step3_save", "Step 3 save failed")
        await asyncio.sleep(3)

        # ── STEP 4: upload dummy PDF to reach step 5 ────────────────────────
        if not await wait_form_ready(page, ready_selector="app-report-step-origin"):
            return partial("step4_load", "Step 4 never loaded")
        data["step4"] = {"selects": await harvest_visible_selects(page),
                         "radios": await harvest_radios(page)}
        save()
        if not await upload_file(page, DUMMY_PDF):
            return partial("step4_upload", "PDF upload failed")
        if not await click_button_scoped(page, ["حفظ ومتابعة"], timeout=60):
            return partial("step4_save", "Step 4 save failed")
        await asyncio.sleep(3)
        await wait_form_ready(page)

        # ── STEP 5 ──────────────────────────────────────────────────────────
        data["step5"] = {"selects": await harvest_visible_selects(page),
                         "radios": await harvest_radios(page)}
        save()

        log("[dropdownHarvest] Done. Leaving the tab open (draft report exists).", "OK")
        return {"status": "SUCCESS", "file": out_path, "data": data}

    except Exception as e:
        data["_error"] = {"step": "exception", "error": str(e)}
        try:
            save()
        except Exception:
            pass
        return {"status": "FAILED", "error": str(e),
                "traceback": traceback.format_exc(), "file": out_path, "data": data}
