import re
from urllib.parse import parse_qs, urlparse

"""
Central place to store the currently selected company (office) so all scripts
can pick up the correct office/sector IDs without hardcoded values.
"""

_selected_company = {}


def _strip(url: str) -> str:
    return (url or "").strip().strip("\"'\\")


def _to_absolute_url(url: str) -> str:
    """
    Ensure we always work with an absolute https URL so browser.get is happy.
    Falls back to qima.taqeem.gov.sa when we get a relative path.
    """
    clean = _strip(url)
    if not clean:
        return ""

    if clean.startswith(("http://", "https://")):
        return clean

    if clean.startswith("//"):
        return f"https:{clean}"

    if not clean.startswith("/"):
        clean = f"/{clean}"

    return f"https://qima.taqeem.gov.sa{clean}"


def parse_company_url(url: str) -> dict:
    """
    Extract sector_id and office_id from the given company/report URL.
    Works with either absolute or relative URLs.
    """
    absolute_url = _to_absolute_url(url)
    sector_id = None
    office_id = None

    try:
        parsed = urlparse(absolute_url)

        # Query param ?office=123 wins if present
        qs = parse_qs(parsed.query or "")
        office_param = (qs.get("office") or [None])[0]
        if office_param:
            office_id = str(office_param)

        path = parsed.path or ""

        # Common patterns: /organization/show/<sector>/<office>, /report/create/<sector>/<office>
        pattern = (
            r"/(?:organization/show|report/create)/(?P<sector>\d+)/(?P<office>\d+)"
        )
        match = re.search(pattern, path)
        if match:
            sector_id = match.group("sector")
            office_id = office_id or match.group("office")

        if not office_id:
            # Fallback: last numeric segment is usually the office id
            parts = [p for p in path.split("/") if p]
            numeric_parts = [p for p in parts if p.isdigit()]
            if numeric_parts:
                office_id = numeric_parts[-1]
                if len(numeric_parts) >= 2 and not sector_id:
                    sector_id = numeric_parts[-2]
    except Exception:
        # We intentionally swallow parsing errors; caller will validate result
        pass

    return {
        "url": absolute_url,
        "sector_id": str(sector_id) if sector_id else None,
        "office_id": str(office_id) if office_id else None,
    }


def set_selected_company(
    url: str,
    name: str = None,
    office_id: str | int = None,
    sector_id: str | int = None,
    type: str = None,
) -> dict:
    parsed = parse_company_url(url)
    office = office_id or parsed.get("office_id")
    sector = sector_id or parsed.get("sector_id")

    global _selected_company
    _selected_company = {
        "name": name,
        "url": parsed.get("url") or _to_absolute_url(url),
        "office_id": str(office) if office else None,
        "sector_id": str(sector) if sector else None,
        "type": type,
    }
    return _selected_company


def get_selected_company(default: dict | None = None) -> dict:
    return _selected_company if _selected_company else (default or {})


def require_selected_company() -> dict:
    company = get_selected_company()
    if not company or not company.get("office_id"):
        raise RuntimeError(
            "No company selected. Please choose a company via the Get Companies screen first."
        )
    return company


def require_selected_company_of_type(expected_type: str) -> dict:
    company = require_selected_company()
    actual_type = company.get("type")
    if actual_type != expected_type:
        raise RuntimeError(
            f"Selected company is type '{actual_type or 'unknown'}', "
            f"but a '{expected_type}' company is required. "
            f"Please select a {expected_type} company first."
        )
    return company


def get_office_id() -> str:
    return require_selected_company().get("office_id")


def get_sector_id(default: str = "4") -> str:
    company = get_selected_company()
    return company.get("sector_id") or default


def build_report_url(report_id: str, office_id: str | int | None = None) -> str:
    office = str(office_id or get_office_id())
    return f"https://qima.taqeem.gov.sa/report/{report_id}?office={office}"


def build_report_create_url(
    sector_id: str | int | None = None, office_id: str | int | None = None
) -> str:
    office = str(office_id or get_office_id())
    sector = str(sector_id or get_sector_id())
    return f"https://qima.taqeem.gov.sa/report/create/{sector}/{office}"
