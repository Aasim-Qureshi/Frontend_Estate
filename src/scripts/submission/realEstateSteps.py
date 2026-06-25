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
    "propertyType": "[name='asset_type_id']",
    "inspected_at": "[name='inspected_at']",
    "finalAssetValue": "[name='value']",
    "marketMethodTotal": "[id='approach1']",
    "marketMeterPrice": "[name='approach[1][method][1][value]']",
    "incomeTotal": "[id='approach2']",
    "incomeReason": "[name='approach[2][method][5][value]']",
    "costLandBuildTotal": "[id='approach3']",
    "costReason": "[name='approach[3][method][11][value]']",
    "lng": "[name='longitude']",
    "lat": "[name='latitude']",
    "landUse": "[name='asset_usage_id']",
    "country": "[id='country_id']",
    "regionName": "[id='region']",
    "cityName": "[id='city']",
}

field_types_2 = {
    "propertyType": "dynamic_select",
    "inspected_at": "text",
    "finalAssetValue": "text",
    "marketMethodTotal": "select",
    "marketMeterPrice": "text",
    "incomeTotal": "select",
    "incomeReason": "text",
    "costLandBuildTotal": "select",
    "costReason": "text",
    "lng": "text",
    "lat": "text",
    "landUse": "dynamic_select",
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


def extract_record_values(record):
    """
    Flattens a realEstate record into a single dict matching the field_map keys.
    Pulls from top-level fields and evalData as appropriate.
    buildingCondition is a sub-object so we extract .status from it.
    """
    eval_data = record.get("evalData", {})
    building_condition = eval_data.get("buildingCondition", {})

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
        "marketMethodTotal": eval_data.get("marketMethodTotal"),  # evalData
        "marketMeterPrice": eval_data.get("marketMeterPrice"),  # evalData
        "incomeTotal": eval_data.get("incomeTotal"),  # evalData
        "incomeReason": eval_data.get("incomeReason"),  # evalData
        "costLandBuildTotal": eval_data.get("costLandBuildTotal"),  # evalData
        "costReason": eval_data.get("costReason"),  # evalData
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
