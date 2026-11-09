"""
Real-data mapping for the new Taqeem flow.
Each function returns overrides only for fields the record actually has;
flow.py merges them over the dummy defaults.
Dropdown texts come from the harvested taqeem_dropdowns JSON (exact option texts).
"""
import asyncio
import json
import os
import urllib.request
from datetime import datetime

from scripts.core.utils import log

from .data_filler import DATE_FMT, TODAY, DateStr

API_BASE = os.environ.get("TAQEEM_API_BASE", "http://localhost:3000")

APPROACH_HINT = {"market": "السوق", "income": "الدخل", "cost": "التكلفة"}
# role "1" = primary, "2" = secondary. VERIFY the secondary radio text with peek/inspect.
METHOD_TYPE = {"1": "أساسي", "2": "مساعد"}
APPRAISER_WEIGHT_KEY = {"market": "marketWeight", "income": "incomeWeight", "cost": "costWeight"}


def _split_to_100(raw: list) -> list:
    """Scale positive numbers to integers that sum to exactly 100 (largest remainder),
    each at least 1."""
    total = sum(raw)
    scaled = [x * 100 / total for x in raw]
    out = [int(s) for s in scaled]
    by_frac = sorted(range(len(raw)), key=lambda i: scaled[i] - out[i], reverse=True)
    for i in by_frac[: 100 - sum(out)]:
        out[i] += 1
    for i, w in enumerate(out):                      # never leave a 0
        if w < 1:
            out[i] = 1
            out[out.index(max(out))] -= 1
    return out


def _assign_weights(rows: list, record: dict) -> None:
    """Weights from evalData.appraiserData when every selected approach has one > 0,
    rescaled to total 100. Otherwise an even split (remainder to the first rows)."""
    ad = (record.get("evalData") or {}).get("appraiserData") or {}
    raw = []
    for r in rows:
        v = _num(ad.get(APPRAISER_WEIGHT_KEY[r["key"]]))
        raw.append(float(v) if v and float(v) > 0 else None)

    if all(w is not None for w in raw):
        weights = _split_to_100(raw)
        log(f"[taqeemNew] weights from record: {raw} -> {weights}", "OK")
    else:
        n = len(rows)
        weights = [100 // n + (1 if i < 100 % n else 0) for i in range(n)]
        log(f"[taqeemNew] weights missing/zero in record ({raw}), even split -> {weights}", "WARN")

    for r, w in zip(rows, weights):
        r["weight"] = w


def real_approaches(approaches, final_amount: int, record: dict | None = None) -> list:
    """[{key, role, value}] from the UI -> ordered rows for the method step.
    Primary first. Falls back to one primary market row at the final value."""
    rows = []
    for a in approaches or []:
        if not isinstance(a, dict):
            continue
        key, role = a.get("key"), str(a.get("role"))
        v = _num(a.get("value"))
        if key not in APPROACH_HINT or role not in METHOD_TYPE:
            continue
        rows.append({
            "key": key,
            "hint": APPROACH_HINT[key],
            "method_type": METHOD_TYPE[role],
            "value": int(round(float(v))) if v and float(v) > 0 else final_amount,
            "role": role,
        })
    rows.sort(key=lambda r: r["role"])          # "1" before "2"
    if not rows:
        log("[taqeemNew] approaches: none supplied, using single market row", "WARN")
        return [{"key": "market", "hint": "السوق", "method_type": METHOD_TYPE["1"],
                 "weight": 100, "value": final_amount, "role": "1"}]
    if rows[0]["role"] != "1":
        log("[taqeemNew] approaches: no primary supplied, promoting first", "WARN")
        rows[0].update(method_type=METHOD_TYPE["1"], role="1")
    _assign_weights(rows, record or {})
    log(f"[taqeemNew] approaches: {[(r['hint'], r['method_type'], r['weight'], r['value']) for r in rows]}", "OK")
    return rows

# ── Fetching (unchanged) ─────────────────────────────────────────────────────
def _get_json(url: str, timeout: float = 15):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


async def fetch_record(record_id: str) -> dict:
    url = f"{API_BASE}/api/transactions/{record_id}"
    data = await asyncio.get_running_loop().run_in_executor(None, _get_json, url)
    warnings = data.get("warnings") if isinstance(data, dict) else None
    if isinstance(data, dict) and "evalData" not in data:
        for key in ("item", "data", "transaction", "report"):
            if isinstance(data.get(key), dict):
                data = data[key]
                break
    if not isinstance(data, dict) or "evalData" not in data:
        raise ValueError(f"Unexpected record shape from {url}: keys={list(data)[:10]}")
    for w in warnings or []:
        log(f"[taqeemNew] backend warning: {w}", "WARN")
    data["_warnings"] = warnings or []
    return data


# ── Value helpers ────────────────────────────────────────────────────────────
def _txt(v):
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _num(v):
    s = _txt(v)
    if s is None:
        return None
    s = s.replace(",", "")
    try:
        float(s)
    except ValueError:
        return None
    return s


def _date(v):
    s = _txt(v)
    if s is None:
        return None
    for parse in (
        lambda x: datetime.strptime(x[:10], "%Y-%m-%d"),
        lambda x: datetime.strptime(x[:10], "%d/%m/%Y"),
    ):
        try:
            return DateStr(parse(s).strftime(DATE_FMT))
        except ValueError:
            continue
    return None


def _int(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _pad_name(v, n=9):
    """Taqeem needs a minimum client-name length (old script padded with '_')."""
    s = _txt(v)
    if s and len(s) < n:
        s = s + "_" * (n - len(s))
    return s


def _collect(tag: str, pairs) -> dict:
    out, missing = {}, []
    for label, value in pairs:
        if value is None:
            missing.append(label)
        else:
            out[label] = value
    log(f"[taqeemNew] {tag}: using real data for {list(out)}", "OK")
    if missing:
        log(f"[taqeemNew] {tag}: no data, keeping dummy for {missing}", "WARN")
    return out


def _lookup(table: dict, our_id, what: str):
    """Mapped option text, or None (caller keeps the dummy default)."""
    key = _int(our_id)
    hit = table.get(key)
    if hit is None and key is not None:
        log(f"[taqeemNew] no mapping for {what}={our_id!r}, keeping dummy", "WARN")
    return hit


# ── Dropdown mappings (exact texts from the harvest) ─────────────────────────
OTHER = "أخرى"
_IFRS = "القيمة العادلة (المعايير المحاسبية الدولية) (IFRS)"

PURPOSE = {
    1: "تمويل", 2: "الشراء", 3: "البيع", 4: "رهن عقاري", 5: "أغراض محاسبية",
    6: "تصفية أو إنهاء نشاط", 7: "الاستحواذ", 8: OTHER, 9: "ضريبية",
    10: "أغراض التأمين", 11: "النزاعات والتقاضي", 12: OTHER, 13: "نزع الملكية",
    14: OTHER, 15: "تقسيم تركة", 16: OTHER, 17: "تقسيم تركة", 18: OTHER,
    19: OTHER, 20: "تقدير القيمة التأجيرية", 21: "تصفية أو إنهاء نشاط",
    50: "الاستثمار", 54: OTHER,
}
BASIS = {
    1: "القيمة السوقية", 2: "القيمة الاستثمارية", 3: "القيمة المنصفة",
    4: "قيمة التصفية", 5: "القيمة التكاملية", 6: "الإيجار السوقي",
    7: "القيمة السوقية", 8: _IFRS, 10: _IFRS,
}
# Only "أعلى وأفضل استخدام" is verified; the rest are unverified guesses.
HYPOTHESIS = {
    1: "الاستخدام الحالي", 2: "أعلى وأفضل استخدام",
    3: "التصفية المنظمة", 4: "البيع القسري",
}

_LAND, _VILLA, _APT, _BLD = "أرض", "فيلا", "وحدة سكنية", "عمارة سكنية"
_SHOP, _COMBLD, _MIXED = "وحدة تجارية", "عمارة تجارية", "عمارة تجارية سكنية"
_OFFICE, _OFFC2, _STN = "مبنى مكتبي", "مبنى مكتبي تجاري", "محطة"
_WH, _TOWER, _FARM = "مستودع", "برج", "مزرعة"
ASSET_TYPE = {
    1: _LAND, 2: _APT, 3: _VILLA, 4: _BLD, 5: _APT, 6: _FARM, 7: _WH,
    108: _STN, 9: _SHOP, 10: _APT, 111: "ورشة", 112: _LAND, 113: "مرفق تعليمي",
    114: _VILLA, 115: "مصنع", 116: _SHOP, 117: _SHOP, 118: _BLD, 119: _LAND,
    120: _LAND, 21: _LAND, 22: _LAND, 123: _LAND, 24: "فندق", 125: _BLD,
    126: _STN, 127: _LAND, 28: _COMBLD, 129: _OFFC2,
    130: "أرض غير مطورة (خام)", 131: "مجمع سكني", 132: _LAND, 133: _TOWER,
    134: _TOWER, 135: _OFFICE, 136: _OFFICE, 137: "مرفق رياضي",
    138: "مرفق رياضي", 139: _VILLA, 140: _LAND, 141: _WH, 142: _LAND,
    143: _LAND, 144: _LAND, 145: _MIXED, 146: _BLD, 147: _FARM, 148: _BLD,
    149: _OFFC2, 150: "مرفق حكومي", 151: "مجمع سكني", 152: _MIXED,
    153: "مجمع تجاري", 154: _VILLA, 155: _LAND, 156: _STN, 157: _SHOP,
    158: _VILLA, 159: _MIXED, 160: _TOWER, 161: _SHOP, 162: _SHOP,
    163: "مرفق حكومي", 164: _MIXED, 165: _VILLA, 166: _BLD, 67: _BLD,
    168: _LAND, 169: _WH, 170: "مصنع", 171: _LAND, 172: _APT, 173: _BLD,
    174: _TOWER, 175: _APT, 176: _LAND, 177: _LAND, 178: _BLD, 179: _BLD,
    180: _SHOP, 181: _SHOP, 182: _COMBLD, 183: "بيت شعبي", 184: _FARM,
    185: _OFFICE, 186: _MIXED,
}
USAGE_BY_OUR_ID = {21: "سكني", 176: "سكني", 22: "تجاري", 155: "تجاري",
                   123: "تجاري سكني", 120: "زراعي", 144: "صناعي"}
USAGE_BY_TYPE = {
    _SHOP: "تجاري", _COMBLD: "تجاري", "مجمع تجاري": "تجاري", _STN: "تجاري",
    _MIXED: "تجاري سكني", "مجمع سكني": "تجاري سكني",
    _OFFICE: "تجاري مكتبي", _OFFC2: "تجاري مكتبي", _TOWER: "تجاري مكتبي",
    _WH: "صناعي", "ورشة": "صناعي", "مصنع": "صناعي", _FARM: "زراعي",
    "فندق": "فندقي", "مرفق رياضي": "ترفيهي", "مرفق تعليمي": "مرافق حكومية",
    "مرفق حكومي": "مرافق حكومية",
}
REGIONS = [
    "منطقة الرياض", "منطقة مكة المكرمة", "منطقة المدينة المنورة", "منطقة القصيم",
    "المنطقة الشرقية", "منطقة عسير", "منطقة تبوك", "منطقة حائل",
    "منطقة الحدود الشمالية", "منطقة جازان", "منطقة نجران", "منطقة الباحة",
    "منطقة الجوف",
]


# ── Per-step overrides ───────────────────────────────────────────────────────
def real_step1(record: dict) -> dict:
    ev = record.get("evalData") or {}
    return _collect("step1", [
        ("اسم العميل", _pad_name(record.get("clientName") or ev.get("clientName"))),
        ("الغرض من التقييم", _lookup(PURPOSE, record.get("valuationPurpose"), "purpose")),
        ("أساس القيمة", _lookup(BASIS, record.get("valuationBasis"), "basis")),
        ("فرضية القيمة", _lookup(HYPOTHESIS, record.get("valuationHypothesis"), "hypothesis")),
        ("تاريخ المعاينة", _date(ev.get("evalDate"))),
        ("تاريخ التقييم", _date(ev.get("completedDate") or ev.get("evalDate"))),
        ("تاريخ إصدار التقرير", _date(ev.get("reportDate"))),
    ])


def real_step2(record: dict) -> dict:
    ev = record.get("evalData") or {}
    tid = _int(ev.get("propertyTypeId"))
    atype = _lookup(ASSET_TYPE, tid, "propertyType")
    usage = (USAGE_BY_OUR_ID.get(tid) or USAGE_BY_TYPE.get(atype)) if atype else None
    built = 0.0
    for line in ev.get("replacementLines") or []:
        built += float(_num(line.get("space")) or 0)
    return _collect("asset", [
        ("نوع الأصل", atype),
        ("الاستخدام الحالي للأرض", usage or ("سكني" if atype else None)),
        ("رقم صك الملكية أو السجل العيني", _txt(ev.get("deedNumber"))),
        ("اسم المالك", _txt(ev.get("ownerName"))),
        ("رقم القطعة", _txt(ev.get("parcelNumber"))),
        ("رقم البلوك", _txt(ev.get("blockNumber"))),
        ("مساحة الأرض (متر مربع)", _num(ev.get("landSpace"))),
        ("مساحة المبنى (متر مربع)",
         str(round(built)) if built > 0 else (_num(ev.get("propertyArea")) or _num(ev.get("landSpace")))),
    ])


def real_region_city(record: dict, default_region: str, default_city: str) -> dict:
    """Uses the Taqeem names resolved by the backend from each region/city's
    `taqeemName` (top-level regionTaqeemName / cityTaqeemName)."""
    # Backend warning text still reads "Default regionName/cityName used ...".
    if any("regionName" in w or "cityName" in w for w in record.get("_warnings", [])):
        log("[taqeemNew] backend could not resolve region/city taqeemName; "
            "it fell back to الرياض. Check regionId/cityId on this record.", "WARN")
    region = _txt(record.get("regionName")) or default_region
    city = _txt(record.get("cityName")) or default_city
    log(f"[taqeemNew] region/city: {region} / {city}", "OK")
    return {"المنطقة": region, "المدينة": city}


def real_coords(record: dict, default_lat: str, default_lng: str):
    ev = record.get("evalData") or {}
    lat, lng = _num(ev.get("lat")), _num(ev.get("lng"))
    if lat is None or lng is None:
        log("[taqeemNew] coords: missing, keeping dummy lat/lng", "WARN")
        return default_lat, default_lng
    return lat, lng


def real_amount(record: dict, default: int) -> int:
    ev = record.get("evalData") or {}
    v = _num(ev.get("finalAssetValue"))
    if v is None or float(v) <= 0:
        log("[taqeemNew] amount: no finalAssetValue, keeping dummy", "WARN")
        return default
    return int(round(float(v)))
