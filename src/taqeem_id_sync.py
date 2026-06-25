"""
Taqeem ID Sync Script
======================

Goal
----
Add a `taqeemId` field to every document in the `regions` and `cities`
MongoDB collections, sourced from a messy scraped Excel file
(region_name, region_id, city_name, city_id).

The DB is treated as the source of truth. Matching is done on the Arabic
title (`titleAr`), normalized to absorb common scraping noise (diacritics,
alef/hamza variants, stray whitespace, etc).

This is the CONSERVATIVE / "fully sure" version: an id is only ever set
when every step along the way resolved cleanly and unambiguously. Anything
that requires a guess (majority vote, "doesn't matter which one") is now
left unset and logged for manual review instead.

Algorithm
---------
Regions:
  - Normalize every scraped region_name and bucket the region_ids seen
    under it.
  - For each DB region, look up its normalized titleAr (after folding any
    known aliases, e.g. "المدينة" -> "المدينة المنورة").
      * Not found in the scrape at all -> left unset, logged as unmatched.
      * More than one region_id seen for that name (corruption) -> left
        unset, logged as a conflict. (No more majority-vote guessing.)
      * Exactly one region_id seen -> set taqeemId, and mark this region
        as "confident" - i.e. trustworthy enough to anchor city matching.

Cities:
  - Normalize every scraped city_name, keeping an ordered list of
    (region_name, city_id) pairs seen for it.
  - For each DB city, pull all scraped candidates matching its name.
  - Keep only the candidates whose region_name is one of our *confident*
    DB regions (matched unambiguously above - not just "exists in the DB").
  - If every surviving candidate belongs to the same single region, take
    the first one encountered in the file - we already know it's the
    right region, so duplicate rows don't introduce real ambiguity.
  - If surviving candidates span more than one region, we can only resolve
    it by checking the city's own regionId in the DB: if that region is
    itself confident AND is one of the candidate regions, use the
    candidate(s) from that region (first one, if still more than one).
    Otherwise we genuinely can't tell which is correct.
  - Anything that doesn't cleanly satisfy the above is left unmatched
    (logged, not written).

Set DRY_RUN = False once you're happy with the printed summary.
"""

import re
from collections import Counter, defaultdict

import pandas as pd
from pymongo import MongoClient, UpdateOne

# ----------------------------------------------------------------------------
# CONFIG - replace these with your real values
# ----------------------------------------------------------------------------
MONGO_URI = "doithere"
DB_NAME = "ElectronDB"  # <- your db name
REGIONS_COLLECTION = "regions"
CITIES_COLLECTION = "cities"

EXCEL_PATH = "/home/altimate/Coding/0/electron-python-app/src/region_city_codes.xlsx"  # <- your excel file
EXCEL_SHEET = 0

# Column names in the excel file - adjust to match your actual headers
COL_REGION_NAME = "region_name"
COL_REGION_ID = "region_id"
COL_CITY_NAME = "city_name"
COL_CITY_ID = "city_id"

TAQEEM_FIELD = "taqeemId"

DRY_RUN = False  # set to False to actually write to the DB


# ----------------------------------------------------------------------------
# Arabic normalization
# ----------------------------------------------------------------------------
_DIACRITICS_RE = re.compile(r"[\u064B-\u0652\u0670\u0640]")  # tashkeel + tatweel
_NON_ARABIC_RE = re.compile(r"[^\u0600-\u06FF\s]")
# Administrative prefix words that show up inconsistently between the scrape
# and the DB (e.g. "منطقة المدينة المنورة" vs just "المدينة المنورة").
# Written in their POST-normalization form, since ة is converted to ه below
# before this regex ever runs.
_ADMIN_PREFIX_RE = re.compile(r"^(منطقه|محافظه)\s+")


def normalize_arabic(text):
    """Collapse common Arabic scraping/typing variants into one canonical key."""
    if text is None:
        return ""
    text = str(text).strip()
    text = _DIACRITICS_RE.sub("", text)
    text = text.replace("إ", "ا").replace("أ", "ا").replace("آ", "ا")
    text = text.replace("ة", "ه")
    text = text.replace("ى", "ي")
    text = _NON_ARABIC_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()  # collapse internal whitespace first...
    text = _ADMIN_PREFIX_RE.sub(
        "", text
    )  # ...so the prefix regex can match a real word boundary
    text = re.sub(
        r"\s+", "", text
    )  # then ignore remaining spacing differences entirely
    return text


# Known alternate region names that legitimately refer to the same region
# but don't share a common substring after normalization - e.g. Medina is
# very commonly written as just "المدينة" instead of the full official
# "المدينة المنورة". Add more entries here as you find them (left side =
# the alternate/short form, right side = the canonical DB form).
_REGION_ALIASES_RAW = {
    "المدينة": "المدينة المنورة",
}


def normalize_region_name(text):
    """Like normalize_arabic, but also folds known regional aliases onto the
    same canonical key (e.g. 'المدينة' -> 'المدينة المنورة'). Use this -
    instead of normalize_arabic - for anything that represents a *region*
    name, on either the DB side or the scraped-excel side. City names should
    keep using plain normalize_arabic."""
    key = normalize_arabic(text)
    for alias, canonical in _REGION_ALIASES_RAW.items():
        if key == normalize_arabic(alias):
            return normalize_arabic(canonical)
    return key


def clean_id(value):
    """pandas often turns int-like ids into floats (123 -> 123.0) - fix that."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


# ----------------------------------------------------------------------------
# Load source-of-truth (DB) and scraped data
# ----------------------------------------------------------------------------
def load_db(client):
    db = client[DB_NAME]
    regions = list(db[REGIONS_COLLECTION].find({}))
    cities = list(db[CITIES_COLLECTION].find({}))
    return db, regions, cities


def load_excel():
    df = pd.read_excel(EXCEL_PATH, sheet_name=EXCEL_SHEET)
    df = df.dropna(subset=[COL_REGION_NAME, COL_REGION_ID, COL_CITY_NAME, COL_CITY_ID])
    return df


# ----------------------------------------------------------------------------
# Build lookup tables from the scraped (messy) data
# ----------------------------------------------------------------------------
def build_region_lookup(df):
    """normalized_region_name -> Counter({region_id: occurrences})"""
    lookup = defaultdict(Counter)
    for _, row in df.iterrows():
        key = normalize_region_name(row[COL_REGION_NAME])
        rid = clean_id(row[COL_REGION_ID])
        if key and rid:
            lookup[key][rid] += 1
    return lookup


def build_city_lookup(df):
    """normalized_city_name -> ordered list of (normalized_region_name, city_id)"""
    lookup = defaultdict(list)
    for _, row in df.iterrows():
        city_key = normalize_arabic(row[COL_CITY_NAME])
        region_key = normalize_region_name(row[COL_REGION_NAME])
        cid = clean_id(row[COL_CITY_ID])
        if city_key and cid:
            lookup[city_key].append((region_key, cid))
    return lookup


# ----------------------------------------------------------------------------
# Matching logic
# ----------------------------------------------------------------------------
def resolve_regions(regions, region_lookup):
    """
    For every DB region, find its taqeemId - but only set it when the
    scraped data gives a single, unambiguous region_id for that name.

    Returns:
      updates              - UpdateOne ops for the confidently-matched regions
      unmatched             - titleAr values with no scrape entry at all
      conflicts              - (titleAr, {id: count}) for names with >1 id seen
      confident_region_keys - normalized keys that are safe to anchor city
                                matching on (i.e. exactly the ones we set above)
    """
    updates = []
    unmatched = []
    conflicts = []
    confident_region_keys = set()

    for region in regions:
        key = normalize_region_name(region.get("titleAr"))
        counter = region_lookup.get(key)
        if not counter:
            unmatched.append(region.get("titleAr"))
            continue
        if len(counter) > 1:
            # Ambiguous in the source data - we're no longer fully sure which
            # id is correct, so don't guess via majority vote. Leave unset.
            conflicts.append((region.get("titleAr"), dict(counter)))
            continue

        resolved_id = counter.most_common(1)[0][0]
        confident_region_keys.add(key)
        updates.append(
            UpdateOne({"_id": region["_id"]}, {"$set": {TAQEEM_FIELD: resolved_id}})
        )

    return updates, unmatched, conflicts, confident_region_keys


def resolve_cities(cities, region_by_id, city_lookup, confident_region_keys):
    """
    For every DB city, only set taqeemId when we can be fully confident:

      1. There's at least one scraped candidate whose region is one of our
         *confident* DB regions (i.e. that region itself matched
         unambiguously - not just "exists somewhere in the DB").
      2. If all the surviving candidates share a single region, take the
         first one encountered in the file - we already know it's the
         right region, so duplicate rows aren't real ambiguity.
      3. If the surviving candidates span more than one region, only
         proceed if the city's *own* region (per its regionId field in the
         DB) is one of those candidate regions AND is itself confident.
         Use that region's candidate (first one, if more than one remains).
         Otherwise we genuinely can't tell which region/id is correct.

    Anything that doesn't cleanly satisfy the above is left unmatched
    (logged, not written).
    """
    updates = []
    unmatched = []
    ambiguous = []  # matched fine, but multiple distinct ids existed for the chosen region (FYI only)
    region_mismatches = []  # single-region match, but != city's own DB region (FYI only)

    for city in cities:
        city_key = normalize_arabic(city.get("titleAr"))
        candidates = city_lookup.get(city_key, [])
        valid_candidates = [c for c in candidates if c[0] in confident_region_keys]

        if not valid_candidates:
            unmatched.append(city.get("titleAr"))
            continue

        own_region = region_by_id.get(str(city.get("regionId")))
        own_region_key = (
            normalize_region_name(own_region.get("titleAr")) if own_region else None
        )

        distinct_region_keys = {c[0] for c in valid_candidates}

        if len(distinct_region_keys) == 1:
            # All surviving candidates agree on the region - we're sure of
            # the region. Just take the first row for the id.
            pool = valid_candidates
            chosen_region_key, chosen_city_id = pool[0]

            if own_region_key is not None and chosen_region_key != own_region_key:
                region_mismatches.append(
                    (city.get("titleAr"), own_region.get("titleAr"))
                )
        else:
            # Candidates disagree on region - only resolvable via the city's
            # own DB region, and only if that region is itself confident.
            if own_region_key is None or own_region_key not in confident_region_keys:
                unmatched.append(city.get("titleAr"))
                continue

            pool = [c for c in valid_candidates if c[0] == own_region_key]
            if not pool:
                unmatched.append(city.get("titleAr"))
                continue

            chosen_region_key, chosen_city_id = pool[0]

        distinct_ids_in_pool = {c[1] for c in pool if c[0] == chosen_region_key}
        if len(distinct_ids_in_pool) > 1:
            ambiguous.append((city.get("titleAr"), sorted(distinct_ids_in_pool)))

        updates.append(
            UpdateOne({"_id": city["_id"]}, {"$set": {TAQEEM_FIELD: chosen_city_id}})
        )

    return updates, unmatched, ambiguous, region_mismatches


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main():
    client = MongoClient(MONGO_URI)
    db, regions, cities = load_db(client)
    df = load_excel()

    region_lookup = build_region_lookup(df)
    city_lookup = build_city_lookup(df)

    region_updates, unmatched_regions, region_conflicts, confident_region_keys = (
        resolve_regions(regions, region_lookup)
    )

    region_by_id = {str(r["_id"]): r for r in regions}

    city_updates, unmatched_cities, ambiguous_cities, region_mismatches = (
        resolve_cities(cities, region_by_id, city_lookup, confident_region_keys)
    )

    print("=" * 60)
    print(f"Regions matched (confident):  {len(region_updates)} / {len(regions)}")
    print(f"Regions unmatched (no scrape entry): {len(unmatched_regions)}")
    print(
        f"Regions left unset due to conflict (ambiguous in scrape): {len(region_conflicts)}"
    )
    if unmatched_regions:
        print("  Unmatched region names (review manually):")
        for name in unmatched_regions:
            print(f"    - {name}")
    if region_conflicts:
        print("  Region conflicts left unset (name -> {id: count}):")
        for name, counts in region_conflicts:
            print(f"    - {name}: {counts}")

    print("-" * 60)
    print(f"Cities matched (confident):   {len(city_updates)} / {len(cities)}")
    print(f"Cities unmatched:              {len(unmatched_cities)}")
    print(
        f"Cities matched but w/ duplicate id rows in the chosen region (took first): {len(ambiguous_cities)}"
    )
    print(
        f"Cities matched but under a different region than DB expects (FYI only): {len(region_mismatches)}"
    )
    print("=" * 60)

    if unmatched_cities:
        print("\nFirst 20 unmatched cities (no fully-confident candidate found):")
        for name in unmatched_cities[:20]:
            print(f"  - {name}")

    if DRY_RUN:
        print("\nDRY_RUN is True - no writes performed. Set DRY_RUN = False to apply.")
        return

    if region_updates:
        db[REGIONS_COLLECTION].bulk_write(region_updates)
    if city_updates:
        db[CITIES_COLLECTION].bulk_write(city_updates)

    print("\nDone - DB updated.")


if __name__ == "__main__":
    main()
