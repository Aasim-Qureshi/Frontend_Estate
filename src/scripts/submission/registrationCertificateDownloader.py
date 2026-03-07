import asyncio
import json
import os
import time
import re
import html as html_lib
from urllib.parse import unquote, urljoin

from scripts.core.browser import check_browser_status, get_browser, get_main_tab, spawn_new_browser


AR_STATUS_LABEL = "\u062d\u0627\u0644\u0629 \u0627\u0644\u062a\u0642\u0631\u064a\u0631:"
AR_STATUS_LABEL_SHORT = "\u062d\u0627\u0644\u0629 \u0627\u0644\u062a\u0642\u0631\u064a\u0631"
AR_STATUS_VALUE = "\u0645\u0639\u062a\u0645\u062f"
AR_CERTIFICATE_TEXT = "\u0634\u0647\u0627\u062f\u0629 \u0627\u0644\u062a\u0633\u062c\u064a\u0644"
AR_REPORT_TITLE_LABEL = "\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u062a\u0642\u0631\u064a\u0631"
AR_REPORT_NAME_LABEL = "\u0627\u0633\u0645 \u0627\u0644\u062a\u0642\u0631\u064a\u0631"
AR_ASSET_NAME_LABEL = "\u0627\u0633\u0645 \u0627\u0644\u0623\u0635\u0644"
AR_ASSET_TITLE_LABEL = "\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0623\u0635\u0644"
AR_ASSET_NAME_LABEL_ALT = "\u0627\u0633\u0645 \u0627\u0644\u0627\u0635\u0644"
AR_ASSET_TABLE_HEADER = "\u0627\u0633\u0645/\u0648\u0635\u0641 \u0627\u0644\u0623\u0635\u0644"

EN_REPORT_TITLE_LABEL = "Report Title"
EN_REPORT_NAME_LABEL = "Report Name"
EN_ASSET_NAME_LABEL = "Asset Name"

INVALID_FILENAME_CHARS = '<>:"/\\\\|?*'
INVISIBLE_CODEPOINTS = {
    0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
    0x2066, 0x2067, 0x2068, 0x2069,
}


def repair_mojibake(value: str) -> str:
    if not value or not isinstance(value, str):
        return value
    if any(ch in value for ch in ("\u00d8", "\u00d9", "\u00c3", "\u00c2")):
        try:
            return value.encode("latin1").decode("utf-8")
        except Exception:
            return value
    return value


def normalize_download_path(path: str) -> str:
    if not path:
        return ""
    text = repair_mojibake(str(path))
    text = text.strip().strip('"').strip("'")
    text = "".join(ch for ch in text if ord(ch) not in INVISIBLE_CODEPOINTS)
    return os.path.normpath(os.path.abspath(text))


def sanitize_filename(name: str, fallback: str = "certificate") -> str:
    if not name:
        return fallback
    cleaned = repair_mojibake(str(name))
    cleaned = "".join("_" if ch in INVALID_FILENAME_CHARS else ch for ch in cleaned)
    cleaned = "".join(
        ch for ch in cleaned
        if ord(ch) >= 32 and ord(ch) not in INVISIBLE_CODEPOINTS
    )
    cleaned = cleaned.strip().strip(".")
    if not cleaned:
        return fallback
    return cleaned[:180]


def ensure_unique_path(path: str) -> str:
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    idx = 1
    while True:
        candidate = f"{base} ({idx}){ext}"
        if not os.path.exists(candidate):
            return candidate
        idx += 1


def chunk_items(items, n):
    n = max(1, n)
    k, m = divmod(len(items), n)
    chunks = []
    start = 0
    for i in range(n):
        size = k + (1 if i < m else 0)
        chunks.append(items[start:start + size])
        start += size
    return chunks


def extract_title_from_html(html_text: str) -> str:
    if not html_text:
        return ""
    match = re.search(r"<title[^>]*>(.*?)</title>", html_text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return ""
    title = html_lib.unescape(match.group(1))
    return title.replace("\u00a0", " ").strip()


async def get_asset_name_from_report_table(page, timeout: int = 8) -> str:
    end = time.time() + max(1, timeout)
    last_value = ""
    header_labels = [
        AR_ASSET_TABLE_HEADER,
        AR_ASSET_NAME_LABEL,
        AR_ASSET_TITLE_LABEL,
        AR_ASSET_NAME_LABEL_ALT,
        EN_ASSET_NAME_LABEL,
        "Asset Name/Description",
        "Asset Name / Description",
        "Asset Description",
    ]
    header_json = json.dumps(header_labels)
    while time.time() < end:
        try:
            value = await page.evaluate(
                f"""
                () => {{
                    const normalize = (value) => (value || '')
                        .replace(/[\\u00a0]/g, ' ')
                        .replace(/[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]/g, '')
                        .replace(/\\s+/g, ' ')
                        .trim();

                    const targets = {header_json}.map((t) => normalize(t));
                    const isTarget = (text) =>
                        targets.some((t) => text === t || text.includes(t));
                    const tables = [];
                    const push = (node) => {{
                        if (node && !tables.includes(node)) tables.push(node);
                    }};

                    [
                        '#m-table',
                        'table#m-table',
                        '.m-table',
                        'table.m-table',
                        '#mTable',
                        '.mTable'
                    ].forEach((selector) => push(document.querySelector(selector)));

                    if (!tables.length) {{
                        Array.from(document.querySelectorAll('table')).forEach(push);
                    }}

                    const findInTable = (table) => {{
                        if (!table) return '';
                        const rows = Array.from(table.querySelectorAll('tr'));
                        if (!rows.length) return '';

                        const headCells = Array.from(table.querySelectorAll('thead th'));
                        let headerCells = headCells;
                        let startRow = 0;
                        if (!headerCells.length && rows[0]) {{
                            headerCells = Array.from(rows[0].querySelectorAll('th, td'));
                            startRow = 1;
                        }}

                        let targetIndex = -1;
                        for (let i = 0; i < headerCells.length; i += 1) {{
                            const text = normalize(headerCells[i]?.textContent || '');
                            if (!text) continue;
                            if (isTarget(text)) {{
                                targetIndex = i;
                                break;
                            }}
                        }}

                        if (targetIndex !== -1) {{
                            const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
                            const dataRows = bodyRows.length ? bodyRows : rows.slice(startRow);
                            for (const row of dataRows) {{
                                const cells = Array.from(row.querySelectorAll('td, th'));
                                const text = normalize(cells[targetIndex]?.textContent || '');
                                if (text) return text;
                            }}
                        }}

                        for (const row of rows) {{
                            const cells = Array.from(row.querySelectorAll('td, th'));
                            if (cells.length < 2) continue;
                            const label = normalize(cells[0]?.textContent || '');
                            if (!label) continue;
                            if (isTarget(label)) {{
                                const value = normalize(cells[1]?.textContent || '');
                                if (value) return value;
                            }}
                        }}

                        return '';
                    }};

                    for (const table of tables) {{
                        const value = findInTable(table);
                        if (value) return value;
                    }}
                    return '';
                }}
                """
            )
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, str):
                last_value = value.strip()
        except Exception:
            pass
        await page.sleep(0.4)
    return last_value


async def get_asset_name_from_report_details(page, timeout: int = 8) -> str:
    end = time.time() + max(1, timeout)
    last_value = ""
    labels = [
        AR_ASSET_NAME_LABEL,
        AR_ASSET_TITLE_LABEL,
        AR_ASSET_NAME_LABEL_ALT,
        EN_ASSET_NAME_LABEL,
        "Asset Name/Description",
        "Asset Name / Description",
        "Asset Description",
    ]
    labels_json = json.dumps(labels)
    while time.time() < end:
        try:
            value = await page.evaluate(
                f"""
                () => {{
                    const normalize = (value) => (value || '')
                        .replace(/[\\u00a0]/g, ' ')
                        .replace(/[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]/g, '')
                        .replace(/\\s+/g, ' ')
                        .trim();

                    const labels = {labels_json}.map((t) => normalize(t));
                    const sortedLabels = labels.slice().sort((a, b) => b.length - a.length);
                    const isLabel = (text) => sortedLabels.some((label) => text === label || text.includes(label));

                    const tables = Array.from(document.querySelectorAll('table'));
                    for (const table of tables) {{
                        const rows = Array.from(table.querySelectorAll('tr'));
                        for (const row of rows) {{
                            const cells = Array.from(row.querySelectorAll('th, td'));
                            if (cells.length < 2) continue;
                            const label = normalize(cells[0]?.textContent || '');
                            if (!label || !isLabel(label)) continue;
                            const value = normalize(cells[1]?.textContent || '');
                            if (value && !isLabel(value)) return value;
                        }}
                    }}

                    const labelNodes = Array.from(
                        document.querySelectorAll('label, span, dt, th, td, div, p, li')
                    );
                    for (const node of labelNodes) {{
                        const labelText = normalize(node.textContent || '');
                        if (!labelText || !isLabel(labelText)) continue;

                        let sibling = node.nextElementSibling;
                        while (sibling) {{
                            const value = normalize(sibling.textContent || '');
                            if (value && !isLabel(value)) return value;
                            sibling = sibling.nextElementSibling;
                        }}

                        const parent = node.parentElement;
                        if (parent) {{
                            const siblings = Array.from(parent.children).filter((el) => el !== node);
                            for (const sib of siblings) {{
                                const value = normalize(sib.textContent || '');
                                if (value && !isLabel(value)) return value;
                            }}
                        }}
                    }}

                    const inputSelectors = [
                        'input[name="asset_name"]',
                        'input[name*="asset_name" i]',
                        'input[id*="asset_name" i]',
                        'input[name*="asset name" i]',
                        'input[placeholder*="Asset Name" i]',
                        'textarea[name="asset_name"]',
                        'textarea[name*="asset_name" i]',
                        'textarea[id*="asset_name" i]',
                        'textarea[placeholder*="Asset Name" i]'
                    ];
                    for (const selector of inputSelectors) {{
                        const field = document.querySelector(selector);
                        if (!field) continue;
                        const value = normalize(field.value || field.getAttribute('value') || '');
                        if (value && !isLabel(value)) return value;
                    }}

                    const rawText = document.body?.innerText || '';
                    const lines = rawText
                        .split(/\\n+/)
                        .map((line) => normalize(line))
                        .filter(Boolean);
                    for (let i = 0; i < lines.length; i += 1) {{
                        const line = lines[i];
                        const token = sortedLabels.find((label) => line.includes(label));
                        if (!token) continue;
                        let cleaned = normalize(line.replace(token, '').replace(':', ''));
                        if (cleaned && !isLabel(cleaned)) return cleaned;
                        const nextLine = lines[i + 1];
                        if (nextLine && !isLabel(nextLine)) return nextLine;
                    }}

                    return '';
                }}
                """
            )
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, str):
                last_value = value.strip()
        except Exception:
            pass
        await page.sleep(0.4)
    return last_value


async def get_report_title(page, timeout: int = 12, report_id: str = "") -> str:
    end = time.time() + max(1, timeout)
    last_title = ""
    report_id_value = repair_mojibake(str(report_id)) if report_id else ""
    report_id_json = json.dumps(report_id_value)
    while time.time() < end:
        try:
            direct_title = await page.evaluate("document.title")
            if isinstance(direct_title, str):
                cleaned = direct_title.replace("\u00a0", " ").strip()
                if cleaned:
                    return cleaned
                last_title = cleaned
        except Exception:
            pass

        try:
            html_text = await page.get_content()
            html_title = extract_title_from_html(html_text)
            if html_title:
                return html_title
        except Exception:
            pass

        try:
            title = await page.evaluate(
                f"""
                () => {{
                    const stripBidi = (value) => (value || '')
                        .replace(/[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]/g, '');
                    const normalize = (value) => stripBidi(value || '')
                        .replace(/[\\u00a0]/g, ' ')
                        .replace(/\\s+/g, ' ')
                        .trim();

                    const headTitleRaw = document.querySelector('head > title')?.textContent || '';
                    const headTitle = headTitleRaw.replace(/[\\u00a0]/g, ' ').trim();
                    if (headTitle) return headTitle;

                    const reportId = {report_id_json};
                    const arabicDigits = {{
                        '\u0660': '0',
                        '\u0661': '1',
                        '\u0662': '2',
                        '\u0663': '3',
                        '\u0664': '4',
                        '\u0665': '5',
                        '\u0666': '6',
                        '\u0667': '7',
                        '\u0668': '8',
                        '\u0669': '9'
                    }};
                    const normalizeForCompare = (value) =>
                        normalize(value).replace(/[\\u0660-\\u0669]/g, (d) => arabicDigits[d] || d);
                    const normalizedReportId = normalizeForCompare(reportId);

                    const isReportId = (value) => {{
                        if (!normalizedReportId) return false;
                        return normalizeForCompare(value) === normalizedReportId;
                    }};

                    const blacklist = [
                        'Report Status', '{AR_STATUS_LABEL}', '{AR_STATUS_LABEL_SHORT}',
                        'Registration Certificate', '{AR_CERTIFICATE_TEXT}',
                        'Confirmed', '{AR_STATUS_VALUE}'
                    ].map((value) => normalize(value));

                    const labels = [
                        '{EN_REPORT_TITLE_LABEL}', '{EN_REPORT_NAME_LABEL}', '{EN_ASSET_NAME_LABEL}',
                        '{AR_REPORT_TITLE_LABEL}', '{AR_REPORT_NAME_LABEL}', '{AR_ASSET_NAME_LABEL}',
                        '{AR_ASSET_TITLE_LABEL}', '{AR_ASSET_NAME_LABEL_ALT}'
                    ].map((value) => normalize(value));

                    const isValid = (text) => {{
                        const normalized = normalize(text);
                        if (!normalized) return false;
                        if (isReportId(normalized)) return false;
                        return !blacklist.some((b) => normalized.includes(b));
                    }};

                    const stripSiteSuffix = (text) => {{
                        if (!text) return text;
                        const separators = [" - ", " | "];
                        for (const sep of separators) {{
                            if (!text.includes(sep)) continue;
                            const parts = text.split(sep).map((p) => normalize(p)).filter(Boolean);
                            if (parts.length < 2) continue;
                            const tail = parts[parts.length - 1].toLowerCase();
                            if (tail.includes("qima") || tail.includes("taqeem")) {{
                                return parts[0];
                            }}
                        }}
                        return text;
                    }};

                    const headTitleFallback = stripSiteSuffix(
                        normalize(document.querySelector('head > title')?.textContent || '')
                    );
                    if (isValid(headTitleFallback)) return headTitleFallback;

                    const statusBlocks = Array.from(document.querySelectorAll('div.d-flex'));
                    for (const block of statusBlocks) {{
                        const span = block.querySelector('span');
                        if (!span) continue;
                        const label = normalize(span.textContent);
                        if (labels.some((token) => label.includes(token))) {{
                            const candidates = Array.from(block.querySelectorAll('b, strong, span'))
                                .filter((el) => el !== span);
                            for (const candidate of candidates) {{
                                const value = normalize(candidate.textContent);
                                if (isValid(value)) return value;
                            }}
                            const blockText = normalize(block.textContent);
                            const cleaned = normalize(blockText.replace(label, ''));
                            if (isValid(cleaned)) return cleaned;
                        }}
                    }}

                    const labelValues = Array.from(document.querySelectorAll('div, li, tr, p, dd'));
                    for (const row of labelValues) {{
                        const label = normalize(row.querySelector('span, label, th, td, div')?.textContent || '');
                        if (!label) continue;
                        if (labels.some((token) => label.includes(token))) {{
                            const value = normalize(
                                row.querySelector('b, strong, td:nth-child(2), span:nth-child(2), div:nth-child(2)')?.textContent || ''
                            );
                            if (isValid(value)) return value;
                            const rowText = normalize(row.textContent);
                            const cleaned = normalize(rowText.replace(label, ''));
                            if (isValid(cleaned)) return cleaned;
                        }}
                    }}

                    const labelNodes = Array.from(document.querySelectorAll('span, label, th, td, div, p, dt'));
                    for (const node of labelNodes) {{
                        const label = normalize(node.textContent);
                        if (!label || label.length > 80) continue;
                        if (!labels.some((token) => label.includes(token))) continue;

                        let sibling = node.nextElementSibling;
                        while (sibling) {{
                            const value = normalize(sibling.textContent);
                            if (isValid(value)) return value;
                            sibling = sibling.nextElementSibling;
                        }}

                        const parent = node.parentElement;
                        if (parent) {{
                            const candidates = Array.from(parent.children).filter((el) => el !== node);
                            for (const candidate of candidates) {{
                                const value = normalize(candidate.textContent);
                                if (isValid(value)) return value;
                            }}
                        }}
                    }}

                    const rawText = document.body?.innerText || '';
                    const lines = rawText
                        .split(/\\n+/)
                        .map((line) => normalize(line))
                        .filter(Boolean);
                    for (let i = 0; i < lines.length; i++) {{
                        const line = lines[i];
                        const token = labels.find((label) => line.includes(label));
                        if (!token) continue;
                        let cleaned = normalize(line.replace(token, '').replace(':', ''));
                        cleaned = cleaned.replace(/^-+/, '');
                        if (isValid(cleaned)) return cleaned;
                        const nextLine = lines[i + 1];
                        if (isValid(nextLine)) return nextLine;
                    }}

                    const elements = Array.from(
                        document.querySelectorAll('h1, h2, h3, h4, h5, .page-title, .report-title, .report-name, .title, .card-title')
                    );
                    const texts = elements
                        .map((el) => normalize(el.textContent))
                        .filter((text) => isValid(text));
                    if (texts.length) {{
                        texts.sort((a, b) => b.length - a.length);
                        return texts[0];
                    }}

                    const boldTexts = Array.from(document.querySelectorAll('b, strong'))
                        .map((el) => normalize(el.textContent))
                        .filter((text) => isValid(text));
                    if (boldTexts.length) {{
                        boldTexts.sort((a, b) => b.length - a.length);
                        return boldTexts[0];
                    }}

                    const formTitle = normalize(
                        document.querySelector('input[name*="title" i], input[name*="name" i], textarea[name*="title" i], textarea[name*="name" i]')?.value || ''
                    );
                    if (isValid(formTitle)) return formTitle;

                    const metaTitle = normalize(
                        document.querySelector('meta[property="og:title"], meta[name="title"]')?.content || ''
                    );
                    if (isValid(metaTitle)) return metaTitle;

                    const docTitle = stripSiteSuffix(normalize(document.title));
                    return isValid(docTitle) ? docTitle : '';
                }}
                """
            )
            if isinstance(title, str) and title.strip():
                return title.strip()
            if isinstance(title, str):
                last_title = title.strip()
        except Exception:
            pass
        await page.sleep(0.5)
    return last_title


async def has_confirmed_status(page) -> bool:
    try:
        result = await page.evaluate(
            f"""
            () => {{
                const normalize = (value) => (value || '')
                    .replace(/[\\u00a0]/g, ' ')
                    .replace(/\\s+/g, ' ')
                    .trim();

                const blocks = Array.from(document.querySelectorAll('div.d-flex.pt-sm.fs-xs'));
                for (const block of blocks) {{
                    const span = block.querySelector('span');
                    const b = block.querySelector('b');
                    if (!span || !b) continue;
                    const label = normalize(span.textContent);
                    const value = normalize(b.textContent);
                    const hasLabel =
                        label.includes('Report Status') ||
                        label.includes('{AR_STATUS_LABEL}') ||
                        label.includes('{AR_STATUS_LABEL_SHORT}');
                    const hasValue =
                        value.includes('Confirmed') ||
                        value.includes('{AR_STATUS_VALUE}');
                    if (hasLabel && hasValue) {{
                        return true;
                    }}
                }}

                const bodyText = normalize(document.body?.innerText || '');
                if ((bodyText.includes('Report Status') && bodyText.includes('Confirmed')) ||
                    (bodyText.includes('{AR_STATUS_LABEL}') && bodyText.includes('{AR_STATUS_VALUE}')) ||
                    (bodyText.includes('{AR_STATUS_LABEL_SHORT}') && bodyText.includes('{AR_STATUS_VALUE}'))) {{
                    return true;
                }}
                return false;
            }}
            """
        )
        return bool(result)
    except Exception:
        try:
            html = await page.get_content()
        except Exception:
            return False
        return (
            ("Report Status" in html and "Confirmed" in html)
            or (AR_STATUS_LABEL in html and AR_STATUS_VALUE in html)
            or (AR_STATUS_LABEL_SHORT in html and AR_STATUS_VALUE in html)
        )


async def find_registration_certificate_target(page, timeout: int = 8):
    end = time.time() + max(1, timeout)
    while time.time() < end:
        try:
            anchors = await page.query_selector_all("a[href]")
        except Exception:
            anchors = []

        for anchor in anchors:
            try:
                href = (anchor.attrs.get("href") or "").strip()
            except Exception:
                href = ""

            if "/registration" in href:
                return {"element": anchor, "href": href}

        try:
            buttons = await page.query_selector_all("button")
        except Exception:
            buttons = []

        for btn in buttons:
            try:
                text = (btn.text or "").strip()
            except Exception:
                text = ""
            normalized = " ".join(text.split()).lower()
            if "registration certificate" in normalized or AR_CERTIFICATE_TEXT in normalized:
                return {"element": btn, "href": None}

        await page.sleep(0.5)

    return None


async def resolve_registration_url(page, target):
    href = target.get("href")
    if not href and target.get("element"):
        try:
            parent = target["element"].parent
            if parent and parent.tag_name == "a":
                href = (parent.attrs.get("href") or "").strip()
        except Exception:
            href = ""

    if not href and target.get("element"):
        try:
            await target["element"].click()
            await page.sleep(1)
            href = await page.evaluate("window.location.href")
        except Exception:
            href = ""

    href = (href or "").strip()
    if href.startswith("/"):
        href = urljoin("https://qima.taqeem.gov.sa", href)
    return href


def _cookie_value(cookie, attr):
    if hasattr(cookie, attr):
        return getattr(cookie, attr)
    if isinstance(cookie, dict):
        return cookie.get(attr)
    return None


def build_cookie_header(cookies):
    pairs = []
    for cookie in cookies:
        name = _cookie_value(cookie, "name")
        value = _cookie_value(cookie, "value")
        domain = _cookie_value(cookie, "domain") or ""
        if not name:
            continue
        if "taqeem.sa" not in domain:
            continue
        pairs.append(f"{name}={value}")
    return "; ".join(pairs)


def _parse_content_disposition_filename(value: str) -> str:
    if not value:
        return ""
    parts = [part.strip() for part in value.split(";") if part.strip()]
    filename_star = ""
    filename = ""
    for part in parts:
        lowered = part.lower()
        if lowered.startswith("filename*="):
            filename_star = part.split("=", 1)[1].strip()
        elif lowered.startswith("filename="):
            filename = part.split("=", 1)[1].strip()
    if filename_star:
        cleaned = filename_star.strip("\"'")
        if "''" in cleaned:
            _, cleaned = cleaned.split("''", 1)
        return unquote(cleaned)
    if filename:
        return filename.strip("\"'")
    return ""


def download_pdf_with_cookies(url, dest_dir, preferred_name, cookie_header, headers=None, timeout=60):
    import urllib.request

    request_headers = headers.copy() if headers else {}
    if cookie_header:
        request_headers["Cookie"] = cookie_header

    req = urllib.request.Request(url, headers=request_headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = getattr(resp, "status", None) or resp.getcode()
        if status and status >= 400:
            raise RuntimeError(f"Download failed with status {status}")
        disposition = resp.headers.get("Content-Disposition", "")
        base_name = sanitize_filename(preferred_name, fallback="")
        if not base_name:
            suggested_name = _parse_content_disposition_filename(disposition)
            base_name = sanitize_filename(suggested_name, fallback="certificate")
        if not base_name.lower().endswith(".pdf"):
            base_name = f"{base_name}.pdf"

        target_path = ensure_unique_path(os.path.join(dest_dir, base_name))
        with open(target_path, "wb") as handle:
            while True:
                chunk = resp.read(1024 * 64)
                if not chunk:
                    break
                handle.write(chunk)
        return target_path


async def download_single_certificate(page, browser, report_id, asset_name, download_path):
    try:
        await page.get(f"https://qima.taqeem.gov.sa/report/{report_id}")
        await page.sleep(1)

        asset_name_page = repair_mojibake((await get_asset_name_from_report_table(page)).strip())
        if not asset_name_page:
            asset_name_page = repair_mojibake((await get_asset_name_from_report_details(page)).strip())

        target = await find_registration_certificate_target(page)
        if not target:
            return {"reportId": report_id, "status": "NOT_CONFIRMED"}

        registration_url = await resolve_registration_url(page, target)
        if not registration_url:
            return {"reportId": report_id, "status": "NOT_CONFIRMED"}

        try:
            user_agent = await page.evaluate("navigator.userAgent")
        except Exception:
            user_agent = ""

        headers = {
            "Accept": "application/pdf",
            "Referer": f"https://qima.taqeem.gov.sa/report/{report_id}",
        }
        if user_agent:
            headers["User-Agent"] = user_agent

        cookies = await browser.cookies.get_all()
        cookie_header = build_cookie_header(cookies)

        fallback_name = asset_name_page or asset_name or ""
        target_path = download_pdf_with_cookies(
            registration_url,
            download_path,
            fallback_name,
            cookie_header,
            headers=headers,
            timeout=60,
        )
        return {
            "reportId": report_id,
            "status": "DOWNLOADED",
            "filePath": target_path,
            "fileName": os.path.basename(target_path),
        }
    except Exception as e:
        return {"reportId": report_id, "status": "FAILED", "error": str(e)}


async def download_registration_certificates(cmd):
    download_path = cmd.get("downloadPath") or cmd.get("download_path") or cmd.get("path")
    reports = cmd.get("reports") or []

    if not download_path:
        return {"status": "FAILED", "error": "Missing downloadPath"}

    if not reports:
        return {"status": "FAILED", "error": "No reports provided"}

    browser_status = await check_browser_status()
    if not browser_status.get("browserOpen", False):
        return {"status": "FAILED", "error": "Browser is not open"}
    if browser_status.get("status") != "SUCCESS":
        return {"status": "NOT_LOGGED_IN", "error": "User not logged in"}

    download_path = normalize_download_path(download_path)
    if not download_path:
        return {"status": "FAILED", "error": "Missing downloadPath"}

    base_browser = await get_browser()

    tabs_raw = cmd.get("tabsNum") or cmd.get("tabs_num") or cmd.get("tabs") or 1
    try:
        tabs = int(tabs_raw)
    except Exception:
        tabs = 1
    tabs = max(1, tabs)
    if reports:
        tabs = min(tabs, len(reports))

    working_browser = None
    spawned_browser = None
    try:
        spawned_browser = await spawn_new_browser(base_browser)
        working_browser = spawned_browser
    except Exception:
        working_browser = base_browser

    pages = []
    if working_browser:
        try:
            if tabs > 1:
                pages = [await working_browser.get("about:blank", new_tab=True) for _ in range(tabs)]
            else:
                main_tab = working_browser.main_tab
                pages = [main_tab] if main_tab else [await working_browser.get("about:blank")]
        except Exception:
            pages = []

    if not pages:
        pages = [await get_main_tab()]

    results = []
    normalized_reports = []

    for rep in reports:
        report_id = None
        asset_name = None
        if isinstance(rep, str):
            report_id = rep.strip()
        elif isinstance(rep, dict):
            report_id = rep.get("reportId") or rep.get("report_id") or rep.get("reportid")
            asset_name = rep.get("assetName") or rep.get("asset_name") or rep.get("asset")

        report_id = str(report_id).strip() if report_id else ""
        asset_name = repair_mojibake(str(asset_name)) if asset_name else None
        if not report_id:
            results.append({"reportId": None, "status": "SKIPPED", "reason": "missing_report_id"})
            continue
        normalized_reports.append({"reportId": report_id, "assetName": asset_name})

    async def process_chunk(page, chunk):
        out = []
        for rep in chunk:
            res = await download_single_certificate(
                page,
                working_browser,
                rep.get("reportId"),
                rep.get("assetName"),
                download_path,
            )
            out.append(res)
        return out

    if normalized_reports:
        chunks = chunk_items(normalized_reports, len(pages))
        chunk_results = await asyncio.gather(
            *(process_chunk(p, c) for p, c in zip(pages, chunks))
        )
        for chunk in chunk_results:
            results.extend(chunk)

    if spawned_browser:
        try:
            await spawned_browser.stop()
        except Exception:
            pass

    downloaded = sum(1 for r in results if r.get("status") == "DOWNLOADED")
    failed = sum(1 for r in results if r.get("status") == "FAILED")
    skipped = sum(1 for r in results if r.get("status") in ("SKIPPED", "NOT_CONFIRMED"))

    return {
        "status": "SUCCESS",
        "results": results,
        "summary": {
            "downloaded": downloaded,
            "skipped": skipped,
            "failed": failed,
            "total": len(reports),
        },
    }
