"""Portfolio and property reads backed by PostgreSQL.

Return shapes match the contract `dummy.py` established. Hazard bands, probabilities and
losses stay null ("pending") until a model run writes HazardResult/LossResult rows; the
five supplied proxy hazard scores are exposed as-is.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict

import numpy as np
from sqlalchemy import false, func, or_

from ..extensions import db
from ..models import FieldProvenance, Hotspot, Portfolio, Property, UploadRow, ValidationIssue, new_id
from . import furika_model as fm
from .ingestion.enrichment import evaluate_row
from .ingestion.pipeline import apply_row_data, row_context
from .ingestion.validation import CANONICAL_FIELDS, EDIT_REQUIRED_CODES

PENDING = "pending"
VISIBLE_SEVERITIES = ("warning", "review")
CLUSTER_TYPES = ("neighbourhood", "grid", "hazard_band", "housing_class")
CLASS_MIX_KEYS = {"informal_iron_sheet": "informal", "semi_permanent": "semiPermanent", "permanent_masonry": "masonry"}
SORT_COLUMNS = {"tiv": Property.insured_value_kes, "name": Property.name, "id": Property.id, "floorArea": Property.floor_area_m2}
MAX_LIMIT = 2000
LOCAL_RADIUS_KM = 0.5


class RepositoryError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def _num(value):
    return float(value) if value is not None else None


def _hazard_scores(prop: Property) -> dict | None:
    return (prop.attributes or {}).get("hazard_scores")


def property_item(prop: Property, issue_count: int = 0) -> dict:
    return {
        "id": prop.id,
        "portfolioId": prop.portfolio_id,
        "name": prop.name,
        "region": prop.region,
        "latitude": _num(prop.latitude),
        "longitude": _num(prop.longitude),
        "housingClass": prop.housing_class,
        "floorAreaM2": _num(prop.floor_area_m2),
        "costPerM2Kes": _num(prop.cost_per_m2_kes),
        "insuredValueKes": _num(prop.insured_value_kes),
        "hazardScore": None,
        "hazardBand": PENDING,
        "annualFloodProbability": None,
        "aalKes": None,
        "loss100Kes": None,
        "loss250Kes": None,
        "cluster": prop.region,
        "aiFlagged": None,
        "sourceTag": prop.source_tag,
        "reviewStatus": prop.review_status,
        "hazardSource": prop.hazard_source,
        "geocodePrecision": prop.geocode_precision,
        "hazardScores": _hazard_scores(prop),
        "issueCount": issue_count,
        "nearestHotspotKm": prop.nearest_hotspot_km,
    }


def _issues_for(property_ids: list[str]) -> dict[str, list[ValidationIssue]]:
    """Warnings and review items from the upload row that last wrote each property."""
    grouped = defaultdict(list)
    if not property_ids:
        return grouped
    rows = (
        db.session.query(UploadRow.property_id, ValidationIssue)
        .join(ValidationIssue, ValidationIssue.upload_row_id == UploadRow.id)
        .join(Property, Property.id == UploadRow.property_id)
        .filter(UploadRow.property_id.in_(property_ids), UploadRow.upload_id == Property.upload_id)
        .filter(ValidationIssue.severity.in_(VISIBLE_SEVERITIES))
        .filter(or_(ValidationIssue.resolution.is_(None), ValidationIssue.resolution != "superseded"))
    )
    for property_id, item in rows:
        grouped[property_id].append(item)
    return grouped


def portfolio_summary(portfolio_id: str) -> dict | None:
    portfolio = db.session.get(Portfolio, portfolio_id)
    if portfolio is None:
        return None
    count, tiv, as_of = (
        db.session.query(func.count(Property.id), func.sum(Property.insured_value_kes), func.max(Property.updated_at))
        .filter(Property.portfolio_id == portfolio_id)
        .one()
    )
    review = dict(db.session.query(Property.review_status, func.count()).filter_by(portfolio_id=portfolio_id).group_by(Property.review_status).all())
    hazard_missing = Property.query.filter_by(portfolio_id=portfolio_id, hazard_source="missing").count()
    tags = {tag for (tag,) in db.session.query(Property.source_tag).filter_by(portfolio_id=portfolio_id).distinct()}
    return {
        "portfolioId": portfolio.id,
        "name": portfolio.name,
        "status": portfolio.status,
        "totalInsuredValueKes": _num(tiv) or 0.0,
        "propertyCount": count,
        "confirmedCount": review.get("confirmed", 0),
        "unconfirmedCount": review.get("unconfirmed", 0),
        "hazardMissingCount": hazard_missing,
        "portfolioAalKes": None,
        "aalPercentTiv": None,
        "loss100Kes": None,
        "highRiskValueKes": None,
        "highRiskValueShare": None,
        "aiFlaggedCount": None,
        "sourceTag": tags.pop() if len(tags) == 1 else ("mixed" if tags else None),
        "asOf": as_of or portfolio.updated_at,
    }


def _parse_bbox(value: str):
    try:
        min_lng, min_lat, max_lng, max_lat = (float(part) for part in value.split(","))
    except ValueError as exc:
        raise RepositoryError("bbox must be minLng,minLat,maxLng,maxLat.") from exc
    return min_lng, min_lat, max_lng, max_lat


def list_properties(portfolio_id: str, filters: dict) -> dict | None:
    if db.session.get(Portfolio, portfolio_id) is None:
        return None
    query = Property.query.filter(Property.portfolio_id == portfolio_id)

    text = (filters.get("q") or "").strip()
    if text:
        pattern = f"%{text}%"
        query = query.filter(or_(Property.id.ilike(pattern), Property.name.ilike(pattern), Property.region.ilike(pattern)))
    if filters.get("housingClass"):
        query = query.filter(Property.housing_class == filters["housingClass"])
    if filters.get("hazardBand"):
        bands = {band.strip().lower() for band in filters["hazardBand"].split(",")}
        if PENDING not in bands:
            query = query.filter(false())  # no property has a modelled band yet
    if filters.get("minTiv") is not None:
        query = query.filter(Property.insured_value_kes >= filters["minTiv"])
    if filters.get("maxTiv") is not None:
        query = query.filter(Property.insured_value_kes <= filters["maxTiv"])
    if filters.get("minProbability") is not None or str(filters.get("aiFlagged", "")).lower() == "true":
        query = query.filter(false())  # requires model results
    if filters.get("nearHotspotKm") is not None:
        if Hotspot.query.count() == 0:
            raise RepositoryError("nearHotspotKm needs hotspot reference data, which is not loaded yet.")
        query = query.filter(Property.nearest_hotspot_km <= filters["nearHotspotKm"])
    if filters.get("bbox"):
        min_lng, min_lat, max_lng, max_lat = _parse_bbox(filters["bbox"])
        query = query.filter(Property.longitude.between(min_lng, max_lng), Property.latitude.between(min_lat, max_lat))

    total = query.count()
    sort_key, _, direction = (filters.get("sort") or "").partition(":")
    column = SORT_COLUMNS.get(sort_key, Property.id)
    query = query.order_by(column.desc() if direction == "desc" and sort_key in SORT_COLUMNS else column.asc(), Property.id.asc())

    try:
        offset = max(int(filters.get("cursor") or 0), 0)
    except ValueError as exc:
        raise RepositoryError("cursor is invalid.") from exc
    limit = min(max(int(filters.get("limit") or 50), 1), MAX_LIMIT)
    page = query.offset(offset).limit(limit).all()
    issues = _issues_for([prop.id for prop in page])
    return {
        "items": [property_item(prop, len(issues[prop.id])) for prop in page],
        "total": total,
        "nextCursor": str(offset + limit) if offset + limit < total else None,
        "dummy": False,
    }


def _portfolio_context(prop: Property) -> dict:
    rows = db.session.query(Property.latitude, Property.longitude, Property.insured_value_kes).filter(Property.portfolio_id == prop.portfolio_id).all()
    lat = np.array([float(row[0]) for row in rows])
    lon = np.array([float(row[1]) for row in rows])
    tiv = np.array([float(row[2] or 0) for row in rows])
    near = fm.haversine_km(lat, lon, float(prop.latitude), float(prop.longitude)) <= LOCAL_RADIUS_KM
    return {
        "aalRank": None,
        "cluster": prop.region,
        "propertiesWithin500m": int(near.sum()) - 1,
        "localInsuredValueKes": float(tiv[near].sum()),
    }


def property_detail(property_id: str) -> dict | None:
    prop = db.session.get(Property, property_id)
    if prop is None:
        return None
    scores = _hazard_scores(prop) or {}
    tiers = [
        {
            "name": tier,
            "returnPeriodYears": fm.DEFAULT_TIER_RP[tier],
            "returnPeriodSource": "assumed",
            "score": scores[tier],
            "depthM": round(float(fm.score_to_depth(scores[tier])), 3),
        }
        for tier in sorted(fm.TIERS, key=lambda tier: fm.DEFAULT_TIER_RP[tier])
        if tier in scores
    ]
    issues = _issues_for([prop.id])[prop.id]
    latest_row = UploadRow.query.filter_by(property_id=prop.id, upload_id=prop.upload_id).order_by(UploadRow.created_at.desc()).first()
    methods = Counter()
    if latest_row is not None:
        methods.update(method for (method,) in db.session.query(FieldProvenance.method).filter_by(subject_type="upload_row", subject_id=latest_row.id, superseded_by=None))
    else:
        methods.update(method for (method,) in db.session.query(FieldProvenance.method).filter_by(subject_type="property", subject_id=prop.id))
    item = property_item(prop, len(issues))
    return {
        "identity": {key: item[key] for key in ("id", "portfolioId", "name", "region", "latitude", "longitude", "housingClass", "sourceTag", "reviewStatus", "geocodePrecision")} | {"address": (prop.attributes or {}).get("address"), "geocode": (prop.attributes or {}).get("geocode")},
        "exposure": {"floorAreaM2": item["floorAreaM2"], "costPerM2Kes": item["costPerM2Kes"], "insuredValueKes": item["insuredValueKes"], "sourceTag": prop.source_tag, "extra": (prop.attributes or {}).get("extra", {})},
        "hazard": {
            "score": None,
            "band": PENDING,
            "annualFloodProbability": None,
            "tiers": tiers,
            "drivers": None,
            "nearestHotspot": (prop.attributes or {}).get("nearby_hotspots", [None])[0] if (prop.attributes or {}).get("nearby_hotspots") else None,
            "nearestHotspotKm": prop.nearest_hotspot_km,
            "nearbyHotspots": (prop.attributes or {}).get("nearby_hotspots", []),
            "source": prop.hazard_source,
            "lookup": (prop.attributes or {}).get("hazard_lookup"),
            "sourceTag": "proxy",
            "depthAssumption": {"dMaxM": fm.DEFAULT_D_MAX, "method": "score × d_max"},
        },
        "loss": {
            "aalKes": None,
            "aalPerMilleTiv": None,
            "loss10Kes": None,
            "loss100Kes": None,
            "loss250Kes": None,
            "portfolioLoss100Share": None,
            "epCurve": [],
            "sourceTag": "pending_model_run",
        },
        "explainability": {
            "summary": "Exposure and proxy hazard scores are loaded. Loss and flood probability appear after an approved model run.",
            "warnings": [{"code": issue.code, "severity": issue.severity, "message": issue.message} for issue in issues],
            "provenance": [{"method": method, "fields": count} for method, count in sorted(methods.items())],
        },
        "portfolioContext": _portfolio_context(prop),
        "dummy": False,
    }


def list_clusters(portfolio_id: str, cluster_type: str) -> dict | None:
    if db.session.get(Portfolio, portfolio_id) is None:
        return None
    if cluster_type not in CLUSTER_TYPES:
        raise RepositoryError(f"type must be one of {', '.join(CLUSTER_TYPES)}.")
    props = Property.query.filter_by(portfolio_id=portfolio_id).all()
    total_tiv = sum(_num(prop.insured_value_kes) or 0 for prop in props)
    groups: dict[str, list[Property]] = defaultdict(list)
    for prop in props:
        if cluster_type == "neighbourhood":
            key = prop.region or "Unassigned"
        elif cluster_type == "housing_class":
            key = prop.housing_class or "Unassigned"
        elif cluster_type == "grid":
            key = f"{float(prop.latitude):.2f}, {float(prop.longitude):.2f}"
        else:
            key = PENDING
        groups[key].append(prop)

    items = []
    for name, members in groups.items():
        tiv = sum(_num(prop.insured_value_kes) or 0 for prop in members)
        classes = Counter(CLASS_MIX_KEYS.get(prop.housing_class, "other") for prop in members)
        items.append({
            "id": "CLU-" + re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").upper(),
            "portfolioId": portfolio_id,
            "name": name,
            "type": cluster_type,
            "propertyCount": len(members),
            "insuredValueKes": tiv,
            "tivShare": tiv / total_tiv if total_tiv else None,
            "loss100Kes": None,
            "aalPercentTiv": None,
            "annualFloodProbability": None,
            "portfolioLossShare": None,
            "riskBand": PENDING,
            "classMix": {key: value / len(members) for key, value in classes.items()},
            "hotspotFlag": None,
            "accumulationFlag": None,
        })
    items.sort(key=lambda item: item["insuredValueKes"], reverse=True)
    return {"items": items, "total": len(items), "dummy": False}


PAYLOAD_FIELDS = {
    "id": "loc_id", "name": "name", "region": "region", "address": "address", "latitude": "lat", "longitude": "lon",
    "housingClass": "housing_class", "floorAreaM2": "floor_area_m2", "costPerM2Kes": "cost_per_m2_kes", "insuredValueKes": "tiv_kes",
}


def create_property(portfolio_id: str, payload: dict) -> dict:
    """Add one user-entered property. Uses the same evaluation as uploads, including geocoding and hazard lookup."""
    raw = {canonical: (str(payload[key]).strip() or None) if payload.get(key) is not None else None for key, canonical in PAYLOAD_FIELDS.items()}
    raw["loc_id"] = raw["loc_id"] or f"USR-{new_id()[:8].upper()}"
    data, issues, filled = evaluate_row(raw, row_context())
    blocking = [issue for issue in issues if issue["severity"] == "error" or issue["code"] in EDIT_REQUIRED_CODES]
    if blocking:
        raise RepositoryError(" ".join(issue["message"] for issue in blocking), 422)
    needs_review = any(issue["severity"] == "review" for issue in issues)
    if db.session.get(Property, data["loc_id"]) is not None:
        raise RepositoryError(f"Property {data['loc_id']} already exists.", 409)
    if db.session.get(Portfolio, portfolio_id) is None:
        db.session.add(Portfolio(id=portfolio_id, name=portfolio_id, status="draft", metadata_json={}))

    prop = Property(id=data["loc_id"], portfolio_id=portfolio_id, source_tag="synthetic", review_status="unconfirmed" if needs_review else "confirmed", attributes={})
    apply_row_data(prop, data)
    db.session.add(prop)
    for canonical in CANONICAL_FIELDS:
        value = data.get(canonical)
        if value is None or canonical == "synthetic":
            continue
        entry = filled.get(canonical, {"method": "user"})
        db.session.add(FieldProvenance(
            subject_type="property", subject_id=prop.id, field=canonical, value=value,
            raw_value=raw.get(canonical) or entry.get("raw_value"), method=entry["method"], quote=entry.get("quote"), confidence=1.0,
        ))
    db.session.commit()
    return property_item(prop) | {"issues": issues}
