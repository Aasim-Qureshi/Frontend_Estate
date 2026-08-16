import sys
from datetime import date


field_map_1 = {
    "report_title": "[name='title']",  # req
    "valuationPurpose": "[name='purpose_id']",  # req
    "valuationHypothesis": "[name='value_premise_id']",  # req
    "valuationBasis": "[name='value_base_id']",  # req
    # "report_type": "[name='report_type']",
    "evalDate": "[name='valued_at']",  # req
    "reportDate": "[name='submitted_at']",  # req
    "assumptions": "[name='assumptions']",
    "special_assumptions": "[name='special_assumptions']",
    "finalAssetValue": "[name='value']",  # req
    "valuation_currency": "[name='currency_id']",
    "report_asset_file": "[name='report_file']",  # req
    "clientName": "[name='client[0][name]']",  # req
    "contactNo": "[name='client[0][telephone]']",  # req
    "email_address": "[name='client[0][email]']",  # req
    "otherUsers": "[name='has_user']",
    # "valuer_name": "[name='valuer[0][id]']",
    # "contribution_percentage": "[name='valuer[0][contribution]']",
}

field_types_1 = {
    "report_title": "text",
    "valuationPurpose": "select",
    "valuationHypothesis": "select",
    "valuationBasis": "select",
    # "report_type": "radio",
    "evalDate": "text",
    "reportDate": "text",
    "assumptions": "text",
    "special_assumptions": "text",
    "finalAssetValue": "text",
    "valuation_currency": "select",
    "report_asset_file": "file",
    "clientName": "text",
    "contactNo": "text",
    "email_address": "text",
    "otherUsers": "checkbox",
    # "valuer_name": "select",
    # "contribution_percentage": "select",
}

field_map_2 = {
    # Selects first — these trigger dynamic reveals on the Taqeem page and must
    # be set before any field that depends on that reveal.
    "propertyType": "[name='asset_type_id']",  # req
    "landUse": "[name='asset_usage_id']",  # req
    "marketApproachStatus": "[id='approach1']",
    "incomeApproachStatus": "[id='approach2']",
    "costApproachStatus": "[id='approach3']",
    # One of the above must at least be uesd
    "inspected_at": "[name='inspected_at']",  # req
    "finalAssetValue": "[name='value']",  # req
    "comparisonValue": "[name='approach[1][method][1][value]']",
    "investmentMethodValue": "[name='approach[2][method][7][value]']",
    "replacementCostValue": "[name='approach[3][method][9][value]']",
    "lng": "[name='longitude']",  # req
    "lat": "[name='latitude']",  # req
    "country": "[id='country_id']",  # req
    "regionName": "[id='region']",  # req
    "cityName": "[id='city']",  # req
}
field_types_2 = {
    "propertyType": "dynamic_select",
    "landUse": "dynamic_select",
    # Changed "select" -> "dynamic_select": a plain "select" wasn't firing the
    # page's reveal logic for the approach value fields underneath.
    "marketApproachStatus": "select",
    "incomeApproachStatus": "select",
    "costApproachStatus": "select",
    "inspected_at": "text",
    "finalAssetValue": "text",
    "comparisonValue": "text",
    "investmentMethodValue": "text",
    "replacementCostValue": "text",
    "lng": "text",
    "lat": "text",
    "country": "location",
    "regionName": "location",
    "cityName": "location",
}

field_map_3 = {
    "blockNumber": "[name='attribute[1]']",
    "parcelNumber": "[name='attribute[2]']",
    "deedNumber": "[name='attribute[3]']",  # req
    "ownershipType": "[name='attribute[4]']",  # req
    "ownershipPercentage": "[name='attribute[5]']",
    "rental_duration": "[name='attribute[6]']",
    "rental_end_date": "[name='attribute[7]']",
    "street_facing_fronts": "[name='attribute[8]']",  # req
    "distance_from_city_center": "[name='attribute[9]']",
    "surroundingEnvironment": "[name='attribute[10][]']",  # req
    "landSpace": "[name='attribute[11]']",  # req
    "propertyArea": "[name='attribute[12]']",
    "authorized_land_cover_percentage": "[name='attribute[13]']",  # req
    "authorized_height": "[name='attribute[14]']",  # reqq
    "land_leased": "[id='15']",
    "buildingCondition": "[name='attribute[16]']",
    "finishLevel": "[name='attribute[17]']",
    "furnishing_status": "[name='attribute[18]']",
    "air_conditioning": "[name='attribute[19]']",
    "propertyModel": "[name='attribute[20]']",
    "availableServices": "[name='attribute[21][]']",
    "landUse": "[name='attribute[27]']",
    "propertyAge": "[name='attribute[28]']",
    "street": "[name='attribute[31]']",  # req
}

field_types_3 = {
    "blockNumber": "text",
    "parcelNumber": "text",
    "deedNumber": "text",
    "ownershipType": "select",
    "ownershipPercentage": "text",
    "rental_duration": "text",
    "rental_end_date": "text",
    "street_facing_fronts": "select",
    "distance_from_city_center": "text",
    "surroundingEnvironment": "checkbox",
    "landSpace": "text",
    "propertyArea": "text",
    "authorized_land_cover_percentage": "text",
    "authorized_height": "text",
    "land_leased": "radio",
    "buildingCondition": "select",
    "finishLevel": "select",
    "furnishing_status": "select",
    "air_conditioning": "select",
    "propertyModel": "select",
    "availableServices": "checkbox",
    "landUse": "radio",
    "propertyAge": "text",
    "street": "text",
}

form_steps = [
    {"field_map": field_map_1, "field_types": field_types_1, "is_valuers_step": True},
    {"field_map": field_map_2, "field_types": field_types_2, "is_valuers_step": False},
    {"field_map": field_map_3, "field_types": field_types_3, "is_valuers_step": False},
]

DEFAULT_APPROACH_VALUE = "1"  # placeholder used only when zero approach data exists

REQUIRED_FIELD_DEFAULTS = {
    "report_title": "Valuation Report",
    "valuationPurpose": 14,  # "Other"
    "valuationHypothesis": 2,  # "Current Use"
    "valuationBasis": 1,  # "Market Value"
    "finalAssetValue": "100",
    "clientName": "Not Provided",
    "contactNo": "123123123",
    "propertyType": 16,  # "Other"
    "landUse": 1,
    "lat": "24.7136",  # Riyadh fallback
    "lng": "46.6753",
    "regionName": "Riyadh",
    "cityName": "Riyadh",
    "deedNumber": "N/A",
    "ownershipType": 1,  # "Owner"
    "street_facing_fronts": 6,  # target value (source 1 -> 6)
    "surroundingEnvironment": ["otherServices"],
    "landSpace": "10",
    "authorized_land_cover_percentage": "10",
    "authorized_height": "0",
    "street": "10",
    "regionId": 3,
    "cityId": 1,
}



def _apply_default(field_name, value):
    is_empty = (
        value is None
        or (isinstance(value, str) and value.strip() == "")
        or (isinstance(value, (list, dict)) and len(value) == 0)
    )
    if not is_empty:
        return value
    if field_name in ("evalDate", "reportDate", "inspected_at"):
        return date.today().isoformat()
    return REQUIRED_FIELD_DEFAULTS.get(field_name, value)

def _num(s):
    """Mirrors the frontend's `p(s)` parser: strips commas, parses float, invalid -> 0."""
    if s is None:
        return 0.0
    try:
        return float(str(s).replace(",", ""))
    except (ValueError, TypeError):
        return 0.0


def compute_settlement_net_meter(
    comparison_rows, section1_rows, settlement_rows, bases, weights
):
    """Ports computeSettlementNetMeter() from TransactionEvaluationPage.tsx.
    Returns 0 if there are no active comparisons or weights don't sum to 100."""
    comparison_rows = comparison_rows or []
    section1_rows = section1_rows or []
    settlement_rows = settlement_rows or []
    bases = bases or []
    weights = weights or []

    active_comps = [
        {"row": row, "originalIndex": i}
        for i, row in enumerate(comparison_rows)
        if row.get("inReport") is not False
    ]
    n = len(active_comps)
    if n == 0:
        return 0.0

    def orig_idx(c):
        return active_comps[c]["originalIndex"]

    def get_base(c):
        idx = orig_idx(c)
        stored = bases[idx] if idx < len(bases) else None
        if stored not in (None, ""):
            return stored
        return comparison_rows[idx].get("price", "")

    def get_adj(row, c):
        idx = orig_idx(c)
        col_adj = row.get("colAdj") or []
        return col_adj[idx] if idx < len(col_adj) else ""

    effective_bases = [get_base(c) for c in range(n)]

    s1_adj_amounts = []
    for c in range(n):
        base = _num(effective_bases[c])
        total = sum(
            base * (_num(get_adj(r, c)) / 100)
            for r in section1_rows
            if r.get("inReport") is not False
        )
        s1_adj_amounts.append(total)

    price_after_s1 = [
        (_num(effective_bases[c]) + s1_adj_amounts[c])
        if _num(effective_bases[c])
        else 0.0
        for c in range(n)
    ]

    s2_adj_amounts = []
    for c in range(n):
        base = price_after_s1[c]
        total = sum(
            base * (_num(get_adj(r, c)) / 100)
            for r in settlement_rows
            if r.get("inReport") is not False
        )
        s2_adj_amounts.append(total)

    price_after_all = [price_after_s1[c] + s2_adj_amounts[c] for c in range(n)]

    def get_weight(c):
        idx = orig_idx(c)
        return weights[idx] if idx < len(weights) else ""

    total_weight = sum(_num(get_weight(c)) for c in range(n))
    if abs(total_weight - 100) > 0.01:
        return 0.0

    return sum(price_after_all[c] * (_num(get_weight(c)) / 100) for c in range(n))


def compute_replacement_derived(lines, fields):
    """Ports computeReplacementDerived() from TransactionEvaluationPage.tsx.
    `fields` is the flat eval_data dict — replacementFields live as top-level keys there."""
    lines = lines or []
    fields = fields or {}

    total_area = sum(_num(l.get("space")) for l in lines)
    total_val = sum(_num(l.get("total") or "0") for l in lines)

    admin_pct = _num(fields.get("managementPct")) / 100
    prof_pct = _num(fields.get("professionalPct")) / 100
    util_pct = _num(fields.get("utilityNetworkPct")) / 100
    emrg_pct = _num(fields.get("emergencyPct")) / 100
    fin_pct = _num(fields.get("financePct")) / 100
    dev_profit = _num(fields.get("earningsRate")) / 100
    year_dev_pct = _num(fields.get("yearDev")) / 100

    indirect_pct = admin_pct + prof_pct + util_pct + emrg_pct + fin_pct + year_dev_pct
    indirect = total_val * indirect_pct
    direct_total = total_val + indirect
    dev_profit_val = direct_total * dev_profit
    asset_val = direct_total + dev_profit_val

    phys_pct = _num(fields.get("depreciationPct"))
    econ_pct = _num(fields.get("economicPct"))
    func_pct = _num(fields.get("careerPct"))
    total_dep = min(100, phys_pct + econ_pct + func_pct)

    dep_val = asset_val * (total_dep / 100)
    net_asset = asset_val - dep_val  # costNetBuildings
    net_meter = (net_asset / total_area) if total_area > 0 else 0.0

    land_data_total = _num(fields.get("meterPriceLand")) * _num(
        fields.get("landSpace")
    )  # costNetLandPrice
    land_asset = land_data_total + net_asset  # costLandBuildTotal

    return {
        "netAsset": net_asset,
        "landDataTotal": land_data_total,
        "landAsset": land_asset,
        "netMeter": net_meter,
        "totalArea": total_area,
        "totalVal": total_val,
    }


def compute_investment_total(investment_entries):
    """Ports the `investmentTotal` reduce() from TransactionEvaluationPage.tsx."""
    total = 0.0
    for entry in investment_entries or []:
        lines = entry.get("lines") or []
        cap_included_income = sum(
            _num(l.get("space")) * _num(l.get("value"))
            for l in lines
            if l.get("inCapitalization") is not False
        )
        vacancy_rate = _num(entry.get("vacancyRate"))
        vacancy_amt = cap_included_income * (vacancy_rate / 100 if vacancy_rate else 0)
        effective_income = cap_included_income - vacancy_amt
        maintenance_rate = _num(entry.get("maintenanceRate"))
        maintenance_amt = effective_income * (
            maintenance_rate / 100 if maintenance_rate else 0
        )
        noi = effective_income - maintenance_amt
        cap_rate = _num(entry.get("capitalizationRate"))
        if cap_rate > 0:
            total += noi / (cap_rate / 100)
    return total


def compute_comparison_value(eval_data):
    """Ports the `market` branch of methodTotals (TransactionEvaluationPage.tsx):
    stored marketMethodTotal (if >0) -> else meterPrice x area, settlement-derived."""
    manual_total = _num(eval_data.get("marketMethodTotal"))
    if manual_total > 0:
        return manual_total

    settl_net_meter = compute_settlement_net_meter(
        eval_data.get("comparisonRows"),
        eval_data.get("section1Rows"),
        eval_data.get("settlementRows"),
        eval_data.get("settlementBases"),
        eval_data.get("settlementWeights"),
    )
    meter_price = _num(eval_data.get("marketMeterPrice")) or settl_net_meter
    area = _num(eval_data.get("propertyAreaMethod")) or _num(
        eval_data.get("propertyArea")
    )
    return meter_price * area


def compute_replacement_cost_value(eval_data):
    """Ports the `cost` branch of methodTotals (TransactionEvaluationPage.tsx):
    stored costLandBuildTotal (if >0) -> else user buildings/land -> else derived landAsset."""
    manual_total = _num(eval_data.get("costLandBuildTotal"))
    if manual_total > 0:
        return manual_total

    derived = compute_replacement_derived(eval_data.get("replacementLines"), eval_data)

    user_buildings = _num(eval_data.get("costNetBuildings"))
    user_land = _num(eval_data.get("costNetLandPrice"))
    if user_buildings > 0 or user_land > 0:
        return (user_buildings or derived["netAsset"]) + (
            user_land or derived["landDataTotal"]
        )

    return derived["landAsset"]


def compute_investment_method_value(eval_data):
    """Ports the `income` value of methodTotals — always the computed investmentTotal.
    (The frontend's manual incomeTotal override field is not actually used for this value.)"""
    return compute_investment_total(eval_data.get("investmentEntries"))


def resolve_approach_statuses(
    comparison_value,
    investment_method_value,
    replacement_cost_value,
    approach_selections=None,
):
    computed = {
        "market": comparison_value,
        "income": investment_method_value,
        "cost": replacement_cost_value,
    }

    if approach_selections is not None:
        statuses = {}
        for key in ("market", "income", "cost"):
            sel = approach_selections.get(key)
            statuses[key] = str(sel) if sel in ("1", "2", 1, 2) else None
        if not any(statuses.values()):
            statuses["market"] = "1"
        return statuses

    statuses: dict[str, str | None] = {"market": None, "income": None, "cost": None}
    for key, val in computed.items():
        if (val or 0) > 0:
            statuses[key] = "1"
            break

    # Constraint: at least one approach must be set. If none has real data,
    # default to Market as primary with a placeholder value.
    if not any(statuses.values()):
        statuses["market"] = "1"

    return statuses


def _fmt_value(value):
    """Formats a computed numeric value for typing into a text field."""
    if value is None or value <= 0:
        return None
    return str(round(value))

def _round_int_str(value):
    """Rounds a numeric-ish value to the nearest integer, returned as a string.
    Non-numeric or empty values are passed through unchanged."""
    if value is None:
        return value
    try:
        return str(int(round(float(str(value).replace(",", "")))))
    except (ValueError, TypeError):
        return value


_TRANSLATIONS: dict[str, dict[int, int]] = {
    "valuationPurpose": {
        1: 9,  # Financing          → Financing
        2: 2,  # Purchase           → Buying
        3: 1,  # Sale               → Selling
        4: 7,  # Mortgage           → Mortgage
        5: 8,  # Accounting         → Accounting Purposes
        6: 14,  # Bankruptcy         → Other (closest)
        7: 3,  # Acquisition        → Mergers and Acquisition
        8: 14,  # Financial Reporting → Other (closest)
        9: 12,  # Taxation           → Tax Related Valuations
        10: 6,  # Insurance Purposes → Insurance
        11: 10,  # Litigation         → Disputes and Litigation
        12: 15,  # Internal Purposes  → Internal Decision Making
        13: 11,  # Expropriation      → Expropriation
        14: 14,  # Transfer           → Other (no match)
        15: 17,  # Inheritance        → Inheritance and division of estates
        16: 14,  # Other              → Other
        17: 17,  # Estate Distribution → Inheritance and division of estates (closest)
        18: 14,  # Forced Sale        → Other (purpose field; Forced Sale is a hypothesis)
        19: 14,  # Market Value Assessment → Other (no match)
        20: 5,  # Rental Value Assessment → Rent Value
        21: 16,  # Liquidation        → Liquidation
        50: 4,  # Investment Purposes → Investment
        54: 14,  # Compensation       → Other (no match)
    },
    "valuationHypothesis": {
        # Values differ between systems but all map cleanly.
        1: 2,  # Current Use          → Current Use
        2: 1,  # Highest and Best Use → Highest and Best Use
        3: 3,  # Orderly Liquidation  → Orderly Liquidation
        4: 4,  # Forced Sale          → Forced Sale
    },
    "valuationBasis": {
        # 1 → 1 and 5 → 5 are identity mappings but included for explicitness.
        1: 1,  # Market Value               → Market Value
        2: 4,  # Investment Value           → Investment Value/Worth
        3: 7,  # Fair Value                 → Fair Value
        4: 6,  # Liquidation Value          → Liquidation Value
        5: 5,  # Synergistic Value          → Synergistic Value
        6: 2,  # Market Rent                → Market Rent
        7: 1,  # Market Value / Market Rent → Market Value (closest)
        8: 7,  # Fair Value (duplicate)     → Fair Value
        10: 9,  # Financial Statement Recognition → Other (no match)
    },
    # ── Future dropdowns ───────────────────────────────────────────────────
    "propertyType": {
        1: 16,  # Land                → Other (no direct match)
        2: 1,  # Apartment           → Residential
        3: 1,  # Residential Villa   → Residential
        4: 14,  # Building            → Multi Use
        5: 1,  # Rest House          → Residential (closest)
        6: 5,  # Farm                → Agricultural
        7: 7,  # Warehouse           → Warehouse
        9: 3,  # Shop                → Commercial
        10: 14,  # Floor               → Multi Use (closest)
        21: 1,  # Residential Land    → Residential
        22: 3,  # Commercial Land     → Commercial
        24: 8,  # Hotel               → Hotels
        28: 3,  # Commercial Building → Commercial
        67: 1,  # Residential Building → Residential
    },
    "ownershipType": {
        1: 1,  # Freehold             → Owner
        2: 1,  # Conditional Ownership → Owner (closest)
        3: 1,  # Restricted Ownership  → Owner (closest)
        4: 4,  # Life Interest         → Other (no match)
        5: 4,  # Usufruct              → Other (no match)
        6: 52,  # Common Ownership      → ملكية مشاعة
        7: 4,  # Mortgaged             → Other (no match)
    },
    "street_facing_fronts": {
        1: 6,
        2: 7,
        3: 8,
        4: 9,
        5: 10,
        # extend as needed — pattern is n → n+5
    },
}


def translate_field(field_name: str, source_value) -> int | None:
    """Translate a dropdown value from System A to System B (Taqeem).

    Args:
        field_name:   Key matching a _TRANSLATIONS entry (e.g. "valuationPurpose").
        source_value: The integer (or int-castable) value from System A.

    Returns:
        The mapped target integer, or None if:
          - the field has no translation table (values are identical — pass through as-is), or
          - the source value is None/falsy, or
          - the value is not found in the table (logs a warning).
    """
    if source_value is None:
        return None

    table = _TRANSLATIONS.get(field_name)
    if table is None:
        # No translation needed for this field — caller should use value directly.
        return int(source_value)

    try:
        key = int(source_value)
    except (ValueError, TypeError):
        return None

    result = table.get(key)
    if result is None:
        print(
            f"[translate_field] WARNING: no mapping for {field_name}={key}",
            file=sys.stderr,
        )
    return result

def _pad_client_name(value, min_length=9, pad_char="_"):
    """Pads a client name with trailing spaces if it's shorter than
    min_length. Spaces are unobtrusive — they don't change how the name
    reads/displays, they just satisfy the length constraint."""
    if value is None:
        return value
    value = str(value)
    if len(value) < min_length:
        value = value + (pad_char * (min_length - len(value)))
    return value

def extract_record_values(record, approach_selections=None):
    """
    Flattens a realEstate record into a single dict matching the field_map keys.
    Pulls from top-level fields and evalData as appropriate.
    buildingCondition is a sub-object so we extract .status from it.
    """
    eval_data = record.get("evalData", {})
    building_condition = eval_data.get("buildingCondition", {})

    comparison_value = compute_comparison_value(eval_data)
    investment_method_value = compute_investment_method_value(eval_data)
    replacement_cost_value = compute_replacement_cost_value(eval_data)
    approach_statuses = resolve_approach_statuses(
        comparison_value,
        investment_method_value,
        replacement_cost_value,
        approach_selections,
    )
    comparison_value_str = _fmt_value(comparison_value)
    if approach_statuses["market"] and comparison_value_str is None:
        comparison_value_str = DEFAULT_APPROACH_VALUE

    income_value_str = _fmt_value(investment_method_value)
    if approach_statuses["income"] and income_value_str is None:
        income_value_str = DEFAULT_APPROACH_VALUE

    cost_value_str = _fmt_value(replacement_cost_value)
    if approach_statuses["cost"] and cost_value_str is None:
        cost_value_str = DEFAULT_APPROACH_VALUE

    return {
        # ── Step 1 ─────────────────────────────────────────────
        "report_title": _apply_default(
            "report_title",
            translate_field("report_title", record.get("report_title")),
        ),
        "valuationPurpose": _apply_default(
            "valuationPurpose",
            translate_field("valuationPurpose", record.get("valuationPurpose")),
        ),
        "valuationHypothesis": _apply_default(
            "valuationHypothesis",
            translate_field("valuationHypothesis", record.get("valuationHypothesis")),
        ),
        "valuationBasis": _apply_default(
            "valuationBasis",
            translate_field("valuationBasis", record.get("valuationBasis")),
        ),
        "report_type": None,  # missing from record
        "evalDate": _apply_default("evalDate", eval_data.get("evalDate")),
        "reportDate": _apply_default("reportDate", eval_data.get("reportDate")),
        "assumptions": eval_data.get("assumptions"),  # evalData
        "special_assumptions": None,  # missing from record
        "finalAssetValue": _round_int_str(
            _apply_default("finalAssetValue", eval_data.get("finalAssetValue"))
        ),
        "valuation_currency": 1,  # missing from record
        "report_asset_file": None,  # missing from record
        "clientName": _pad_client_name(
                    _apply_default("clientName", record.get("clientName"))
                ),        "contactNo": _apply_default("contactNo", record.get("contactNo")),
        "email_address": record.get("email_address"),  # missing from record
        "otherUsers": eval_data.get("otherUsers"),  # evalData
        # "valuer_name": None,
        # "contribution_percentage": None,  # missing from record
        # ── Step 2 ─────────────────────────────────────────────
        "propertyType": _apply_default(
            "propertyType",
            translate_field("propertyType", eval_data.get("propertyTypeId")),
        ),
        "inspected_at": _apply_default("inspected_at", eval_data.get("evalDate")),
        # NOTE: comparisonValue / investmentMethodValue / replacementCostValue are
        # COMPUTED, not stored — the DB only holds the raw building blocks
        # (comparisonRows, investmentEntries, replacementLines, etc). These mirror
        # the live calculations in TransactionEvaluationPage.tsx (methodTotals).
        "marketApproachStatus": approach_statuses["market"],
        "comparisonValue": _fmt_value(comparison_value)
        if approach_statuses["market"]
        else None,
        "incomeApproachStatus": approach_statuses["income"],
        "investmentMethodValue": _fmt_value(investment_method_value)
        if approach_statuses["income"]
        else None,
        "costApproachStatus": approach_statuses["cost"],
        "replacementCostValue": _fmt_value(replacement_cost_value)
        if approach_statuses["cost"]
        else None,
        "lng": _apply_default("lng", eval_data.get("lng")),
        "lat": _apply_default("lat", eval_data.get("lat")),
        "landUse": eval_data.get("assetCategoryId"),  # evalData
        "country": 1,  # missing from record
        "regionName": _apply_default("regionName", eval_data.get("regionName")),
        "cityName": _apply_default("cityName", eval_data.get("cityName")),
        # taqeemId codes resolved server-side from the `regions` / `cities`
        # collections — these are the actual <option value> the site
        # expects, so set_location() can set them directly instead of
        # searching the dropdowns by regionName/cityName text.
        "regionId": _apply_default("regionId", record.get("regionTaqeemId")),
        "cityId": _apply_default("cityId", record.get("cityTaqeemId")),
        # ── Step 3 ─────────────────────────────────────────────
        "blockNumber": eval_data.get("blockNumber"),  # evalData
        "parcelNumber": eval_data.get("parcelNumber"),  # evalData
        "deedNumber": _apply_default("deedNumber", eval_data.get("deedNumber")),
        "ownershipType": _apply_default(
            "ownershipType",
            translate_field("ownershipType", record.get("ownershipType")),
        ),
        "ownershipPercentage": eval_data.get("ownershipPercentage"),  # evalData
        "rental_duration": None,  # missing from record
        "rental_end_date": None,  # missing from record
        "street_facing_fronts": _apply_default(
            "street_facing_fronts",
            translate_field("street_facing_fronts", eval_data.get("streetFronts")),
        ),
        "distance_from_city_center": None,  # missing from record
        "surroundingEnvironment": _apply_default(
            "surroundingEnvironment", eval_data.get("surroundingEnvironment")
        ),
        "landSpace": _apply_default("landSpace", eval_data.get("landSpace")),
        "propertyArea": _apply_default(
            "propertyArea",
            eval_data.get("landSpace") or eval_data.get("propertyArea"),
        ),
        "authorized_land_cover_percentage": _apply_default(
            "authorized_land_cover_percentage", eval_data.get("authorizedLandCoverPct")
        ),
        "authorized_height": _apply_default(
            "authorized_height", eval_data.get("elevation")
        ),
        "land_leased": None,  # missing from record
        "buildingCondition": building_condition.get(
            "status"
        ),  # evalData.buildingCondition.status
        "finishLevel": eval_data.get("finishLevel"),  # evalData
        "furnishing_status": None,  # missing from record
        "air_conditioning": None,  # missing from record
        "propertyModel": eval_data.get("propertyModel"),  # evalData
        "availableServices": eval_data.get("availableServices"),  # evalData (dict)
        "propertyAge": eval_data.get("propertyAge"),  # evalData
        "street": _apply_default("street", eval_data.get("streetWidth")),
    }
