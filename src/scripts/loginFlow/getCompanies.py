import asyncio, sys
from scripts.core.browser import navigate
from scripts.core.company_context import parse_company_url, build_report_create_url
from scripts.core.utils import wait_for_element

def repair_mojibake(value: str) -> str:
    if not value or not isinstance(value, str):
        return value
    if any(ch in value for ch in ("\u00d8", "\u00d9", "\u00c3", "\u00c2")):
        try:
            return value.encode("latin1").decode("utf-8")
        except Exception:
            return value
    return value

async def fetch_company_valuers(page, office_id, sector_id="4"):
    if not office_id:
        return []

    target_url = build_report_create_url(sector_id, office_id)
    try:
        await page.get(target_url)
    except Exception:
        return []
    await asyncio.sleep(1.5)

    try:
        await wait_for_element(
            page,
            ".addNewValuer select.valuer_id, .addNewValuer select[name^='valuer'][name$='[id]'], select.valuer_id, select[name^='valuer'][name$='[id]']",
            timeout=20
        )
    except Exception:
        pass

    valuers = []
    selector_script = """
        () => {
            const selectors = [
                '.addNewValuer select.valuer_id',
                '.addNewValuer select[name^="valuer"][name$="[id]"]',
                '.addNewValuer select[data-type="id"]',
                'select.valuer_id',
                'select[name^="valuer"][name$="[id]"]',
                'select[data-type="id"]',
                'select[name*="valuer"][name$="[id]"]'
            ];
            const selects = selectors.flatMap(sel => Array.from(document.querySelectorAll(sel)));
            if (!selects.length) return [];
            const map = new Map();
            selects.forEach(select => {
                Array.from(select.querySelectorAll('option')).forEach(opt => {
                    const val = (opt.getAttribute('value') || '').trim();
                    const text = (opt.textContent || '').trim();
                    if (!val) return;
                    if (!map.has(val)) {
                        map.set(val, { valuerId: val, valuerName: text });
                    }
                });
            });
            return Array.from(map.values());
        }
    """
    try:
        for _ in range(12):
            valuers = await page.evaluate(selector_script)
            if isinstance(valuers, list) and len(valuers) > 0:
                break
            await asyncio.sleep(0.7)
        if not valuers:
            await page.evaluate(
                """
                () => {
                    const btn = document.querySelector('#duplicateValuer');
                    if (btn) {
                        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    }
                }
                """
            )
            await asyncio.sleep(1.2)
            valuers = await page.evaluate(selector_script)
    except Exception:
        valuers = []

    # Fallback: parse HTML if JS evaluation returns empty
    if not valuers:
        try:
            from bs4 import BeautifulSoup
            html_content = await page.get_content()
            soup = BeautifulSoup(html_content, 'html.parser')
            selectors = [
                '.addNewValuer select.valuer_id',
                '.addNewValuer select[name^="valuer"][name$="[id]"]',
                '.addNewValuer select[data-type="id"]',
                'select.valuer_id',
                'select[name^="valuer"][name$="[id]"]',
                'select[data-type="id"]',
                'select[name*="valuer"][name$="[id]"]'
            ]
            selects = []
            for sel in selectors:
                selects.extend(soup.select(sel))
            if selects:
                parsed = []
                seen = set()
                for select in selects:
                    for opt in select.find_all('option'):
                        val = (opt.get('value') or '').strip()
                        text = (opt.get_text() or '').strip()
                        if not val or val in seen:
                            continue
                        seen.add(val)
                        parsed.append({
                            "valuerId": val,
                            "valuerName": text
                        })
                valuers = parsed
        except Exception:
            valuers = []

    cleaned = []
    for item in (valuers or []):
        valuer_id = repair_mojibake((item or {}).get("valuerId") or "")
        valuer_name = repair_mojibake((item or {}).get("valuerName") or "")
        if not valuer_id:
            continue
        if valuer_name and valuer_name.strip() in ("ØªØ­Ø¯ÙØ¯", "Select", "Choose"):
            continue
        cleaned.append({
            "valuerId": valuer_id,
            "valuerName": valuer_name
        })

    if not cleaned:
        try:
            current_url = await page.evaluate("window.location.href")
        except Exception:
            current_url = "unknown"
        print(f"[WARN] No valuers found for office {office_id} (sector={sector_id}) url={current_url}", file=sys.stderr)
    else:
        print(f"[INFO] Loaded {len(cleaned)} valuers for office {office_id}", file=sys.stderr)

    return cleaned

async def get_companies():
    try:
        # Navigate to the taqeem homepage
        page = await navigate("https://qima.taqeem.sa/")
        await asyncio.sleep(3)  # Wait for page to load

        companies = []
        companies_data = None

        try:
            companies_data = await page.evaluate(
                """
                () => {
                    const section = document.querySelector('ul#sidebarItem_5');
                    if (!section) return [];
                    const links = Array.from(section.querySelectorAll('a[href]'));
                    let started = false;
                    const out = [];

                    for (const link of links) {
                        const href = link.getAttribute('href') || '';
                        const text = (link.textContent || '').trim();
                        if (!href || !text) continue;
                        if (href.includes('membership/reports/sector/4')) {
                            started = true;
                            continue;
                        }
                        if (href.includes('organization/joinPartner/sector/4')) {
                            break;
                        }
                        if (!started) continue;
                        if (href.includes('organization/show/')) {
                            out.push({ name: text, href });
                        }
                    }
                    return out;
                }
                """
            )
        except Exception:
            companies_data = None

        if isinstance(companies_data, list):
            for item in companies_data:
                href = (item or {}).get("href")
                text = repair_mojibake((item or {}).get("name") or "")
                if not href or not text:
                    continue
                parsed = parse_company_url(href)
                companies.append({
                    "name": text,
                    "url": parsed.get("url") or href,
                    "officeId": parsed.get("office_id"),
                    "sectorId": parsed.get("sector_id")
                })
            print(f"[INFO] Total companies found: {len(companies)}", file=sys.stderr)

        from bs4 import BeautifulSoup

        # Get the HTML content of the page
        html_content = await page.get_content()
        soup = BeautifulSoup(html_content, 'html.parser')

        # Find the machinery/equipment section (sidebarItem_5)
        machinery_section = soup.find('ul', {'id': 'sidebarItem_5'})
        if machinery_section:
            # Find all links in this section
            links = machinery_section.find_all('a', href=True)

            # Find the markers
            reports_link_found = False
            join_partner_found = False

            for link in links:
                href = link.get('href')
                text = repair_mojibake(link.get_text(strip=True))

                if not href or not text:
                    continue

                # Check for the "OÂ¦U,OOÃ±USOÃ±US" (My Reports) marker
                if "membership/reports/sector/4" in href:
                    reports_link_found = True
                    print("[INFO] Found reports link marker", file=sys.stderr)
                    continue

                # Check for the "OU+OU.OU. UÅ¸O'OÃ±USUÅ¸ U,U.U+O'OÅOc" (Join as Partner) marker
                if "organization/joinPartner/sector/4" in href:
                    join_partner_found = True
                    print("[INFO] Found join partner link marker", file=sys.stderr)
                    break  # Stop processing after this marker

                # If we're between the markers, check if it's a company link
                if reports_link_found and not join_partner_found:
                    if "organization/show/" in href and text:
                        parsed = parse_company_url(href)
                        companies.append({
                            "name": text,
                            "url": parsed.get("url") or href,
                            "officeId": parsed.get("office_id"),
                            "sectorId": parsed.get("sector_id")
                        })
                        office_log = parsed.get("office_id") or "unknown"
                        print(f"[INFO] Found company: {text} (office={office_log})", file=sys.stderr)

        deduped = []
        seen = set()
        for company in companies:
            key = company.get("officeId") or company.get("office_id") or company.get("url") or company.get("name")
            if not key:
                continue
            key = str(key)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(company)
        companies = deduped

        for company in companies:
            office_id = company.get("officeId") or company.get("office_id")
            sector_id = company.get("sectorId") or company.get("sector_id") or "4"
            try:
                valuers = await fetch_company_valuers(page, office_id, sector_id)
                company["valuers"] = valuers
            except Exception as e:
                print(f"[WARN] Failed to load valuers for office {office_id}: {e}", file=sys.stderr)
                company["valuers"] = []

        print(f"[INFO] Total companies found: {len(companies)}", file=sys.stderr)
        return {"status": "SUCCESS", "data": companies}
    except Exception as e:
        print(f"[ERROR] Error getting companies: {e}", file=sys.stderr)
        return {"status": "FAILED", "error": str(e)}
