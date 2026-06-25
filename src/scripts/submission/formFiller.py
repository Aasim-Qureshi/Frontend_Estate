import asyncio
import json
import sys
from datetime import datetime

from scripts.core.utils import wait_for_element


async def fill_valuers(page, valuers):
    try:
        # --- Step 1: attempt to create rows normally ---
        if len(valuers) > 1:
            for _ in range(len(valuers) - 1):
                try:
                    await asyncio.sleep(0.05)  # Reduced delay
                    add_btn = await wait_for_element(
                        page, "#duplicateValuer", timeout=30
                    )
                    await asyncio.sleep(0.05)  # Reduced delay
                except Exception:
                    add_btn = None

                if add_btn:
                    await add_btn.click()
                    await asyncio.sleep(0.05)  # Reduced delay

        # --- Step 2: verify number of created selectors ---
        async def count_rows():
            elements = await page.query_selector_all("[name^='valuer'][name$='[id]']")
            return len(elements)

        expected = len(valuers)
        current = await count_rows()

        # safety cap to avoid infinite loop
        retries = 0
        while current < expected and retries < 10:
            try:
                add_btn = await wait_for_element(page, "#duplicateValuer", timeout=10)
                await add_btn.click()
                await asyncio.sleep(0.2)  # Reduced delay - button click is fast
            except Exception:
                break

            current = await count_rows()
            retries += 1

        # --- Step 3: fill each row ---
        for idx, valuer in enumerate(valuers):
            name_sel = f"[name='valuer[{idx}][id]']"
            contrib_sel = f"[name='valuer[{idx}][contribution]']"

            for sel, val in [
                (name_sel, valuer.get("valuerName", "")),
                (contrib_sel, str(valuer.get("percentage", ""))),
            ]:
                try:
                    select_element = await wait_for_element(page, sel, timeout=30)
                except Exception:
                    select_element = None

                if not select_element:
                    continue

                options = getattr(select_element, "children", []) or []
                for opt in options:
                    text = (opt.text or "").strip()
                    if val.lower() in text.lower():
                        await opt.select_option()
                        break

    except Exception as e:
        print(f"[WARNING] fill_valuers failed: {e}", file=sys.stderr)


_location_cache = {}


async def set_location(
    page, country_name, region_id, city_id, region_name=None, city_name=None
):
    """
    Sets the #region / #city selects using the taqeemId codes already
    resolved from the DB (the `regions` / `cities` collections) when
    available — no dropdown search needed in that case, just set and
    trigger change.

    Falls back to the old fuzzy name-based search (with caching) only
    when an id is missing — e.g. legacy data where the DB lookup didn't
    resolve a regionId/cityId — so those records can still get a location
    set instead of silently being left blank.
    """
    try:
        import re
        import unicodedata

        cache_key = f"{country_name}|{region_name}|{city_name}"

        def normalize_text(text: str) -> str:
            if not text:
                return ""
            text = unicodedata.normalize("NFKC", text)
            text = re.sub(r"\s+", " ", text)
            return text.strip()

        async def wait_for_options(selector, min_options=2, timeout=10):
            for _ in range(
                timeout * 5
            ):  # More frequent checks (every 0.2s instead of 0.5s)
                el = await wait_for_element(page, selector, timeout=0.5)
                if (
                    el
                    and getattr(el, "children", None)
                    and len(el.children) >= min_options
                ):
                    return el
                await asyncio.sleep(0.2)  # Reduced delay for faster detection
            return None

        async def get_location_code(name, selector):
            if not name:
                return None
            el = await wait_for_options(selector)
            if not el:
                return None
            for opt in el.children:
                text = normalize_text(opt.text)
                if normalize_text(name).lower() in text.lower():
                    return opt.attrs.get("value")
            return None

        async def set_field(selector, value):
            if not value:
                return
            args = json.dumps({"selector": selector, "value": value})
            await page.evaluate(f"""
                (function() {{
                    const args = {args};
                    if (window.$) {{
                        window.$(args.selector).val(args.value).trigger("change");
                    }} else {{
                        const el = document.querySelector(args.selector);
                        if (!el) return;
                        if (el.value !== args.value) {{
                            el.value = args.value;
                            el.dispatchEvent(new Event("input", {{ bubbles: true }}));
                            el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        }}
                    }}
                }})();
            """)

        # Prefer the taqeemId already resolved from the DB. Only fall back
        # to the fuzzy name search (and only for whichever side is still
        # missing) when an id wasn't available.
        region_code = region_id
        city_code = city_id

        if not region_code or not city_code:
            cached_region, cached_city = _location_cache.get(cache_key, (None, None))
            if not region_code:
                region_code = cached_region or await get_location_code(
                    region_name, "#region"
                )
            if not city_code:
                city_code = cached_city or await get_location_code(city_name, "#city")
            if region_code or city_code:
                _location_cache[cache_key] = (region_code, city_code)

        await set_field("#country_id", "1")
        await asyncio.sleep(0.2)  # Reduced delay - location fields update quickly
        await set_field("#region", str(region_code) if region_code else None)
        await asyncio.sleep(0.2)  # Reduced delay
        await set_field("#city", str(city_code) if city_code else None)
        await asyncio.sleep(0.1)  # Minimal delay after last field

        return True

    except Exception as e:
        print(f"Location injection failed: {e}", file=sys.stderr)
        return False


async def scrape_region_city_table(page, country_value="1"):
    """
    TEMPORARY DEBUG UTILITY.
    Assumes the page is already on the location step (step 2) with the
    region/city selects present. Locks country to Saudi Arabia, then walks
    every region option, selecting each one in turn and reading whatever
    cities show up in #city for that region.

    Returns: list of (region_name, region_id, city_name, city_id) tuples,
    one row per city.
    """
    import re
    import unicodedata

    def normalize_text(text):
        if not text:
            return ""
        text = unicodedata.normalize("NFKC", text)
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    async def set_field(selector, value):
        args = json.dumps({"selector": selector, "value": value})
        await page.evaluate(f"""
            (function() {{
                const args = {args};
                if (window.$) {{
                    window.$(args.selector).val(args.value).trigger("change");
                }} else {{
                    const el = document.querySelector(args.selector);
                    if (!el) return;
                    el.value = args.value;
                    el.dispatchEvent(new Event("input", {{ bubbles: true }}));
                    el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                }}
            }})();
        """)

    async def get_real_options(selector, min_options=1, timeout=10):
        """Poll until the select has at least min_options non-placeholder options."""
        for _ in range(timeout * 5):
            el = await wait_for_element(page, selector, timeout=0.5)
            children = getattr(el, "children", None) or [] if el else []
            real_opts = [o for o in children if (o.attrs.get("value") or "").strip()]
            if len(real_opts) >= min_options:
                return real_opts
            await asyncio.sleep(0.2)
        return []

    rows = []

    # Lock country to Saudi Arabia
    await set_field("#country_id", country_value)
    await asyncio.sleep(5)

    # Grab every region option (skips the empty "choose region" placeholder)
    region_options = await get_real_options("#region", min_options=1, timeout=15)
    regions = [(normalize_text(o.text), o.attrs.get("value")) for o in region_options]
    print(f"[INFO] Found {len(regions)} regions", file=sys.stderr)

    for region_name, region_id in regions:
        if not region_id:
            continue

        await set_field("#region", region_id)
        await asyncio.sleep(5)  # let the city list refresh via AJAX

        city_options = await get_real_options("#city", min_options=1, timeout=10)
        cities = [(normalize_text(o.text), o.attrs.get("value")) for o in city_options]
        print(
            f"[INFO] Region '{region_name}' ({region_id}) -> {len(cities)} cities",
            file=sys.stderr,
        )

        for city_name, city_id in cities:
            if city_id:
                rows.append((region_name, region_id, city_name, city_id))

    return rows


async def bulk_inject_inputs(page, record, field_map, field_types):
    jsdata = {}
    print("bulk", record, file=sys.stderr, flush=True)
    for key, selector in field_map.items():
        if key not in record:
            continue

        field_type = field_types.get(key, "text")

        if field_type in ("file", "dynamic_select"):
            continue

        value = str(record[key] or "").strip()

        if field_type == "date" and value:
            try:
                value = datetime.strptime(value, "%d-%m-%Y").strftime("%Y-%m-%d")
            except ValueError:
                try:
                    datetime.strptime(value, "%Y-%m-%d")
                except ValueError:
                    print(
                        f"[WARNING] Invalid date format for {key}: {value}",
                        file=sys.stderr,
                    )
                    continue

        jsdata[selector] = {"type": field_type, "value": value}

    js = f"""
    (function() {{
        const data = {json.dumps(jsdata)};
        for (const [selector, meta] of Object.entries(data)) {{
            try {{
                const el = document.querySelector(selector);
                if (!el) continue;

                switch(meta.type) {{
                    case "checkbox":
                        el.checked = Boolean(meta.value);
                        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        break;

                    case "select":
                        let found = false;
                        for (const opt of el.options) {{
                            if (opt.value == meta.value || opt.text == meta.value) {{
                                el.value = opt.value;
                                found = true;
                                break;
                            }}
                        }}
                        if (!found && el.options.length) {{
                            el.selectedIndex = 0;
                        }}
                        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        break;

                    case "radio":
                        const labels = document.querySelectorAll('label.form-check-label');
                        for (const lbl of labels) {{
                            if ((lbl.innerText || '').trim() === meta.value) {{
                                const radio = document.getElementById(lbl.getAttribute('for'));
                                if (radio) {{
                                    radio.checked = true;
                                    radio.dispatchEvent(new Event('change', {{ bubbles: true }}));
                                }}
                                break;
                            }}
                        }}
                        break;

                    case "date":
                    case "text":
                    default:
                        el.value = meta.value ?? "";
                        el.dispatchEvent(new Event("input", {{ bubbles: true }}));
                        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        break;
                }}
            }} catch (err) {{
                console.error("bulk_inject_inputs: field failed", selector, err);
            }}
        }}
    }})();
    """

    await page.evaluate(js)


async def select_dynamic_option(
    page, selector, value, timeout=10, retries=6, retry_delay=0.5
):
    """
    Selects an option by visible text in a select element whose option
    list is populated dynamically (e.g. landUse, which depends on
    propertyType). Retries with a short delay since the dependent
    select's options may still be loading/refreshing.
    """
    if not value:
        return False

    for attempt in range(retries):
        select_element = await wait_for_element(page, selector, timeout=timeout)
        if select_element:
            for opt in getattr(select_element, "children", []) or []:
                if value.lower() in (opt.text or "").lower():
                    await opt.select_option()
                    return True
        await asyncio.sleep(retry_delay)

    return False


async def fill_form(
    page,
    record,
    field_map,
    field_types,
    is_last_step=False,
    retries=0,
    max_retries=2,
    is_valuers=False,
):
    try:
        if is_valuers:
            try:
                await fill_valuers(page, record.get("valuers"))
            except Exception as e:
                print(f"Error filling valuers: {e}", file=sys.stderr)

        property_type_selector = field_map.get("propertyType")
        if (
            property_type_selector
            and "propertyType" in record
            and field_types.get("propertyType") == "dynamic_select"
        ):
            await select_dynamic_option(
                page, property_type_selector, str(record["propertyType"] or "")
            )

        await bulk_inject_inputs(page, record, field_map, field_types)

        for key, selector in field_map.items():
            if key not in record:
                continue
            value = str(record[key] or "")
            ftype = field_types.get(key, "text")
            try:
                if ftype == "location":
                    country_name = record.get("country", "")
                    region_id = record.get("regionId", "")
                    city_id = record.get("cityId", "")
                    region_name = record.get("regionName", "")
                    city_name = record.get("cityName", "")
                    await set_location(
                        page,
                        country_name,
                        region_id,
                        city_id,
                        region_name,
                        city_name,
                    )

                elif ftype == "file":
                    file_input = await wait_for_element(page, selector, timeout=10)
                    if file_input:
                        await file_input.send_file(value)

                elif ftype == "dynamic_select":
                    select_element = await wait_for_element(page, selector, timeout=10)
                    if select_element:
                        for opt in select_element.children:
                            if value.lower() in (opt.text or "").lower():
                                await opt.select_option()
                                break

            except Exception:
                continue

        land_use_selector = field_map.get("landUse")
        if (
            land_use_selector
            and "landUse" in record
            and field_types.get("landUse") == "dynamic_select"
        ):
            await select_dynamic_option(
                page, land_use_selector, str(record["landUse"] or "")
            )

        if not is_last_step:
            continue_btn = await wait_for_element(
                page, "input[name='continue']", timeout=10
            )
            if continue_btn:
                await continue_btn.click()
                # Reduced wait time - check for errors faster
                await asyncio.sleep(1.0)
                error_div = await wait_for_element(
                    page, "div.alert.alert-danger", timeout=3
                )
                if error_div and retries < max_retries:
                    await asyncio.sleep(0.5)
                    return await fill_form(
                        page,
                        record,
                        field_map,
                        field_types,
                        is_last_step,
                        retries + 1,
                        max_retries,
                    )
        else:
            save_btn = await wait_for_element(page, "input[type='submit']", timeout=10)
            if save_btn:
                await asyncio.sleep(0.2)  # Reduced delay before click
                await save_btn.click()
                # Reduced wait time - form submission is usually quick
                await asyncio.sleep(1.0)
                return {"status": "SAVED"}
            else:
                return {"status": "FAILED", "error": "Save button not found"}
        return True
    except Exception as e:
        return {"status": "FAILED", "error": str(e)}
