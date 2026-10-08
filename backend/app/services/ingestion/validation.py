"""Per-row schema and cross-field checks with stable issue codes.

Rules mirror `furika_model.validate_exposure` (same classes, bounds, score range and
TIV tolerance) but report per row so each row can be accepted, reviewed, or rejected.
Location, hazard lookup and plausibility checks that need reference data live in
`enrichment.py`, which calls `check_row` first.
"""

from __future__ import annotations

import math
import re

from .. import furika_model as fm

HAZARD_FIELDS = tuple(f"hazard_score_{tier}" for tier in fm.TIERS)
REQUIRED_FIELDS = ("loc_id", "housing_class", "floor_area_m2", "cost_per_m2_kes")
TEXT_FIELDS = ("loc_id", "name", "region", "address", "housing_class")
NUMERIC_FIELDS = ("lat", "lon", "floor_area_m2", "cost_per_m2_kes", "tiv_kes", *HAZARD_FIELDS)
CANONICAL_FIELDS = ("loc_id", "lat", "lon", "housing_class", "floor_area_m2", "cost_per_m2_kes", "tiv_kes", *HAZARD_FIELDS, "name", "region", "address", "synthetic")
TIV_TOLERANCE = 0.02

UNSUPPORTED_CONSTRUCTION = re.compile(r"rcc|reinforced|concrete|high[\s_-]?rise|steel", re.IGNORECASE)
TRUE_VALUES = {"true", "t", "yes", "y", "1"}
SEVERITY_STATUS = (("error", "rejected"), ("review", "needs_review"), ("warning", "accepted_with_warnings"))
PROMOTABLE_STATUSES = {"accepted", "accepted_with_warnings"}
# Review issues a reviewer can accept as-is, versus ones that need the row edited first.
CONFIRMABLE_CODES = {"approximate_location", "hazard_far_from_grid"}
EDIT_REQUIRED_CODES = {"unsupported_construction", "geocode_failed"}


def issue(code: str, severity: str, message: str, field: str | None = None, evidence: dict | None = None) -> dict:
    return {"code": code, "severity": severity, "field": field, "message": message, "evidence": evidence or {}}


def parse_number(value: str) -> float:
    text = re.sub(r"(?i)^(kes|ksh\.?)\s*", "", str(value).strip()).replace(",", "").replace(" ", "")
    number = float(text)
    if not math.isfinite(number):
        raise ValueError(value)
    return number


def row_status(issues: list[dict]) -> str:
    severities = {item["severity"] for item in issues}
    for severity, status in SEVERITY_STATUS:
        if severity in severities:
            return status
    return "accepted"


def has_hazard_scores(data: dict) -> bool:
    return all(data.get(field) is not None for field in HAZARD_FIELDS)


def check_bounds(data: dict) -> list[dict]:
    lat, lon = data["lat"], data["lon"]
    bounds = fm.NAIROBI_BOUNDS
    if bounds["lat_min"] <= lat <= bounds["lat_max"] and bounds["lon_min"] <= lon <= bounds["lon_max"]:
        return []
    return [issue("outside_bounds", "error", "Coordinates fall outside the configured Nairobi bounds.", "lat", {"lat": lat, "lon": lon, "bounds": bounds})]


def check_row(raw: dict[str, str | None]) -> tuple[dict, list[dict], dict[str, dict]]:
    """Parse one row of canonical raw strings.

    Returns (data, issues, filled) where `filled` maps fields the source didn't supply
    to their provenance ({"method", "quote", ...}).
    """
    data: dict = {field: raw.get(field) for field in TEXT_FIELDS}
    issues: list[dict] = []
    filled: dict[str, dict] = {}

    for field in NUMERIC_FIELDS:
        value = raw.get(field)
        data[field] = None
        if value is None:
            continue
        try:
            data[field] = parse_number(value)
        except ValueError:
            issues.append(issue("non_numeric", "error", f"{field} is not a number: {value!r}.", field, {"value": value}))
    flagged = {item["field"] for item in issues}

    for field in REQUIRED_FIELDS:
        if data.get(field) is None and field not in flagged:
            issues.append(issue("missing_required_field", "error", f"{field} is required.", field))
    for field, other in (("lat", "lon"), ("lon", "lat")):
        if data[field] is None and field not in flagged and (data[other] is not None or other in flagged):
            issues.append(issue("missing_required_field", "error", f"{field} is required when {other} is supplied.", field))

    area, cost = data["floor_area_m2"], data["cost_per_m2_kes"]
    if data["tiv_kes"] is None and "tiv_kes" not in flagged:
        if area is not None and cost is not None:
            data["tiv_kes"] = area * cost
            filled["tiv_kes"] = {"method": "derived", "quote": "floor_area_m2 × cost_per_m2_kes"}
        else:
            issues.append(issue("missing_required_field", "error", "tiv_kes is required when floor area or cost per m² is missing.", "tiv_kes"))

    housing_class = data["housing_class"]
    if housing_class:
        normalised = re.sub(r"[\s\-]+", "_", housing_class.strip().lower())
        if normalised in fm.VALID_CLASSES:
            data["housing_class"] = normalised
        elif UNSUPPORTED_CONSTRUCTION.search(housing_class):
            issues.append(issue(
                "unsupported_construction", "review",
                f"'{housing_class}' has no vulnerability curve in the model; edit the class or reject the row.",
                "housing_class", {"value": housing_class},
            ))
        else:
            issues.append(issue(
                "invalid_class", "error",
                f"housing_class '{housing_class}' is not one of {', '.join(fm.VALID_CLASSES)}.",
                "housing_class", {"value": housing_class},
            ))

    for field in ("floor_area_m2", "cost_per_m2_kes", "tiv_kes"):
        if data[field] is not None and data[field] <= 0:
            issues.append(issue("non_positive", "error", f"{field} must be positive.", field, {"value": data[field]}))

    present = [field for field in HAZARD_FIELDS if data[field] is not None or field in flagged]
    if present:
        for field in HAZARD_FIELDS:
            if field not in present:
                issues.append(issue("missing_required_field", "error", f"{field} is missing; supply all five hazard scores or none.", field))
            elif data[field] is not None and not 0 <= data[field] <= 1:
                issues.append(issue("score_out_of_range", "error", f"{field} must be between 0 and 1.", field, {"value": data[field]}))
        if has_hazard_scores(data):
            by_rarity = [data[f"hazard_score_{tier}"] for tier in fm.RP_ORDER]
            if any(right < left - 1e-12 for left, right in zip(by_rarity, by_rarity[1:])):
                issues.append(issue(
                    "hazard_non_monotonic", "warning",
                    "Hazard scores should not fall as events get rarer (extreme → common tier).",
                    None, {"scoresByIncreasingRp": dict(zip(fm.RP_ORDER, by_rarity))},
                ))

    tiv = data["tiv_kes"]
    if "tiv_kes" not in filled and tiv is not None and area and cost and area > 0 and cost > 0:
        calculated = area * cost
        if abs(tiv - calculated) / calculated > TIV_TOLERANCE:
            issues.append(issue(
                "tiv_mismatch", "warning",
                f"tiv_kes is {tiv / calculated:.2f}× floor_area_m2 × cost_per_m2_kes; the supplied TIV is kept.",
                "tiv_kes", {"supplied": tiv, "calculated": calculated},
            ))

    synthetic = raw.get("synthetic")
    if synthetic is None:
        filled["synthetic"] = {"method": "user"}
        data["synthetic"] = True
    else:
        data["synthetic"] = synthetic.strip().lower() in TRUE_VALUES
        if not data["synthetic"]:
            issues.append(issue("not_synthetic", "error", f"Every row must be synthetic=TRUE; found {synthetic!r}.", "synthetic", {"value": synthetic}))
    return data, issues, filled
