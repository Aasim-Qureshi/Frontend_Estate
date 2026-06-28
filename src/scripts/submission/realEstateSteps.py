import sys

field_map_1 = {
    "report_title": "[name='title']",
    "valuationPurpose": "[name='purpose_id']",
    "valuationHypothesis": "[name='value_premise_id']",
    "valuationBasis": "[name='value_base_id']",
    # "report_type": "[name='report_type']",
    "evalDate": "[name='valued_at']",
    "reportDate": "[name='submitted_at']",
    "assumptions": "[name='assumptions']",
    "special_assumptions": "[name='special_assumptions']",
    "finalAssetValue": "[name='value']",
    "valuation_currency": "[name='currency_id']",
    "report_asset_file": "[name='report_file']",
    "clientName": "[name='client[0][name]']",
    "contactNo": "[name='client[0][telephone]']",
    "email_address": "[name='client[0][email]']",
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
    "propertyType": "[name='asset_type_id']",
    "landUse": "[name='asset_usage_id']",
    "marketApproachStatus": "[id='approach1']",
    "incomeApproachStatus": "[id='approach2']",
    "costApproachStatus": "[id='approach3']",
    # Everything else
    "inspected_at": "[name='inspected_at']",
    "finalAssetValue": "[name='value']",
    "comparisonValue": "[name='approach[1][method][1][value]']",
    "investmentMethodValue": "[name='approach[2][method][7][value]']",
    "replacementCostValue": "[name='approach[3][method][9][value]']",
    "lng": "[name='longitude']",
    "lat": "[name='latitude']",
    "country": "[id='country_id']",
    "regionName": "[id='region']",
    "cityName": "[id='city']",
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
    "deedNumber": "[name='attribute[3]']",
    "ownershipType": "[name='attribute[4]']",
    "ownershipPercentage": "[name='attribute[5]']",
    "rental_duration": "[name='attribute[6]']",
    "rental_end_date": "[name='attribute[7]']",
    "street_facing_fronts": "[name='attribute[8]']",
    "distance_from_city_center": "[name='attribute[9]']",
    "surroundingEnvironment": "[name='attribute[10][]']",
    "landSpace": "[name='attribute[11]']",
    "propertyArea": "[name='attribute[12]']",
    "authorized_land_cover_percentage": "[name='attribute[13]']",
    "authorized_height": "[name='attribute[14]']",
    "land_leased": "[id='15']",
    "buildingCondition": "[name='attribute[16]']",
    "finishLevel": "[name='attribute[17]']",
    "furnishing_status": "[name='attribute[18]']",
    "air_conditioning": "[name='attribute[19]']",
    "propertyModel": "[name='attribute[20]']",
    "availableServices": "[name='attribute[21][]']",
    "landUse": "[name='attribute[27]']",
    "propertyAge": "[name='attribute[28]']",
    "street": "[name='attribute[31]']",
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

# realEstateSteps.py  ── add at the bottom ──


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
    """
    Decides the #approach1/2/3 select values: "1" = primary, "2" = secondary,
    None = unused/ignored.

    approach_selections comes from the frontend's primary/secondary/unused picker
    (shown when 2+ valuation methods have data) and looks like:
        {"market": "1", "income": "2", "cost": None}
    When provided, it's authoritative — whatever the user picked wins.

    When approach_selections is None (zero or only one method had data, so the
    frontend skipped the picker), each method with a computed value > 0 is
    auto-assigned "1" (primary) — safe here since there's at most one to assign.
    """
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
        return statuses

    return {key: ("1" if (val or 0) > 0 else None) for key, val in computed.items()}


def _fmt_value(value):
    """Formats a computed numeric value for typing into a text field."""
    if value is None or value <= 0:
        return None
    rounded = round(value, 2)
    if rounded == int(rounded):
        return str(int(rounded))
    return f"{rounded:.2f}"


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

    return {
        # ── Step 1 ─────────────────────────────────────────────
        "report_title": "0",  # missing from record
        "valuationPurpose": record.get("valuationPurpose"),  # top-level
        "valuationHypothesis": record.get("valuationHypothesis"),  # top-level
        "valuationBasis": record.get("valuationBasis"),  # top-level
        "report_type": None,  # missing from record
        "evalDate": eval_data.get("evalDate"),  # evalData
        "reportDate": eval_data.get("reportDate"),  # evalData
        "assumptions": eval_data.get("assumptions"),  # evalData
        "special_assumptions": None,  # missing from record
        "finalAssetValue": eval_data.get("finalAssetValue"),  # evalData
        "valuation_currency": 1,  # missing from record
        "report_asset_file": None,  # missing from record
        "clientName": record.get("clientName"),  # evalData
        "contactNo": record.get("contactNo"),  # evalData
        "email_address": record.get("email_address"),  # missing from record
        "otherUsers": eval_data.get("otherUsers"),  # evalData
        # "valuer_name": None,
        # "contribution_percentage": None,  # missing from record
        # ── Step 2 ─────────────────────────────────────────────
        "propertyType": eval_data.get("propertyTypeId"),  # evalData
        "inspected_at": eval_data.get("evalDate"),  # evalData (closest match)
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
        "lng": eval_data.get("lng"),  # evalData
        "lat": eval_data.get("lat"),  # evalData
        "landUse": eval_data.get("assetCategoryId"),  # evalData
        "country": 1,  # missing from record
        "regionName": eval_data.get("regionName"),  # evalData
        "cityName": eval_data.get("cityName"),  # evalData
        # taqeemId codes resolved server-side from the `regions` / `cities`
        # collections — these are the actual <option value> the site
        # expects, so set_location() can set them directly instead of
        # searching the dropdowns by regionName/cityName text.
        "regionId": record.get("regionTaqeemId"),  # top-level (from DB lookup)
        "cityId": record.get("cityTaqeemId"),  # top-level (from DB lookup)
        # ── Step 3 ─────────────────────────────────────────────
        "blockNumber": eval_data.get("blockNumber"),  # evalData
        "parcelNumber": eval_data.get("parcelNumber"),  # evalData
        "deedNumber": eval_data.get("deedNumber"),  # evalData
        "ownershipType": record.get("ownershipType"),  # top-level
        "ownershipPercentage": eval_data.get("ownershipPercentage"),  # evalData
        "rental_duration": None,  # missing from record
        "rental_end_date": None,  # missing from record
        "street_facing_fronts": None,  # missing from record
        "distance_from_city_center": None,  # missing from record
        "surroundingEnvironment": eval_data.get(
            "surroundingEnvironment"
        ),  # evalData (array)
        "landSpace": eval_data.get("landSpace"),  # evalData
        "propertyArea": eval_data.get("propertyArea"),  # evalData
        "authorized_land_cover_percentage": None,  # missing from record
        "authorized_height": None,  # missing from record
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
        "street": eval_data.get("street"),  # evalData
    }
