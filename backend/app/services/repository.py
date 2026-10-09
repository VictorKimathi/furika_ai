"""Portfolio and property reads backed by PostgreSQL.

Return shapes match the contract `dummy.py` established. Hazard bands, probabilities and
losses stay null ("pending") until a model run writes HazardResult/LossResult rows; the
five supplied proxy hazard scores are exposed as-is.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import UTC

import numpy as np
from sqlalchemy import false, func, or_

from ..extensions import db
from ..models import DocumentChunk, FieldProvenance, HazardReferencePoint, HazardResult, Hotspot, LossResult, ModelRun, Portfolio, Property, Upload, UploadRow, ValidationIssue, new_id
from . import furika_model as fm
from .ingestion.enrichment import evaluate_row
from .ingestion.pipeline import apply_row_data, row_context
from .ingestion.validation import CANONICAL_FIELDS, EDIT_REQUIRED_CODES

PENDING = "pending"
VISIBLE_SEVERITIES = ("warning", "review")
CLUSTER_TYPES = ("neighbourhood", "grid", "hazard_band", "housing_class")
CLASS_MIX_KEYS = {"informal_iron_sheet": "informal", "semi_permanent": "semiPermanent", "permanent_masonry": "masonry", "concrete_rcc": "concrete"}
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


def _approved_run(portfolio_id: str) -> ModelRun | None:
    run = ModelRun.query.filter_by(portfolio_id=portfolio_id, status="approved").order_by(ModelRun.completed_at.desc()).first()
    if run is None:
        return None
    latest_property_change = db.session.query(func.max(Property.updated_at)).filter(Property.portfolio_id == portfolio_id).scalar()
    if latest_property_change and run.completed_at and latest_property_change.replace(tzinfo=UTC) > run.completed_at.replace(tzinfo=UTC):
        return None
    return run


def _modellable(prop: Property) -> str | None:
    """Why this property can't be modelled, or None if it can."""
    if prop.review_status != "confirmed":
        return "It is unconfirmed: confirm it in the review queue first."
    if prop.housing_class not in fm.VALID_CLASSES:
        return f"Its construction class '{prop.housing_class}' has no vulnerability curve in the model."
    scores = _hazard_scores(prop) or {}
    if not all(tier in scores for tier in fm.TIERS):
        return "It has no hazard scores yet (no supplied scores and no reference grid nearby)."
    if not (prop.insured_value_kes and prop.floor_area_m2 and prop.cost_per_m2_kes):
        return "Its floor area, cost per m² or insured value is missing."
    return None


def model_status(prop: Property, approved: ModelRun | None, draft: ModelRun | None, has_approved_result: bool, has_draft_result: bool) -> dict:
    """Which results the property shows and whether a new run can be started from it."""
    if has_approved_result:
        return {"state": "approved", "runId": approved.id, "canRun": False, "reason": None}
    if has_draft_result:
        return {"state": "draft", "runId": draft.id, "canRun": False, "reason": f"Draft results from run {draft.id}, awaiting approval."}
    reason = _modellable(prop)
    if reason:
        return {"state": "not_modellable", "runId": None, "canRun": False, "reason": reason}
    latest = ModelRun.query.filter_by(portfolio_id=prop.portfolio_id, status="approved").order_by(ModelRun.completed_at.desc()).first()
    if latest is not None and approved is None:
        return {"state": "stale", "runId": latest.id, "canRun": True, "reason": f"Portfolio data changed after run {latest.id} was approved, so its results are no longer shown. Run the model again."}
    if approved is not None:
        return {"state": "not_in_run", "runId": approved.id, "canRun": True, "reason": f"This property was added or changed after run {approved.id}. Run the model to include it."}
    return {"state": "no_run", "runId": None, "canRun": True, "reason": "No model run has been calculated for this portfolio yet."}


def _risk_band(probability: float | None, modelled: bool = True) -> str:
    """Risk band from the modelled annual flood probability (1/RP of the most frequent tier that floods)."""
    if not modelled:
        return PENDING
    if probability is None or probability <= 0:
        return "low"
    return "severe" if probability >= 0.1 else "high" if probability >= 0.04 else "moderate" if probability >= 0.01 else "low"


def property_item(prop: Property, issue_count: int = 0, hazard: HazardResult | None = None, loss: LossResult | None = None) -> dict:
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
        "hazardScore": _num(hazard.hazard_score) if hazard else None,
        "hazardBand": _risk_band(_num(hazard.annual_flood_probability), modelled=True) if hazard else PENDING,
        "annualFloodProbability": _num(hazard.annual_flood_probability) if hazard else None,
        "aalKes": _num(loss.aal_kes) if loss else None,
        "loss100Kes": _num(loss.loss_100_kes) if loss else None,
        "loss250Kes": _num(loss.loss_250_kes) if loss else None,
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
    """Warnings and review items from the upload that last wrote each property: its row's issues plus document-level ones."""
    grouped = defaultdict(list)
    if not property_ids:
        return grouped
    current = or_(ValidationIssue.resolution.is_(None), ValidationIssue.resolution != "superseded")
    row_issues = (
        db.session.query(UploadRow.property_id, ValidationIssue)
        .join(ValidationIssue, ValidationIssue.upload_row_id == UploadRow.id)
        .join(Property, Property.id == UploadRow.property_id)
        .filter(UploadRow.property_id.in_(property_ids), UploadRow.upload_id == Property.upload_id)
        .filter(ValidationIssue.severity.in_(VISIBLE_SEVERITIES), current)
    )
    upload_issues = (
        db.session.query(Property.id, ValidationIssue)
        .join(ValidationIssue, ValidationIssue.upload_id == Property.upload_id)
        .filter(Property.id.in_(property_ids), ValidationIssue.upload_row_id.is_(None))
        .filter(ValidationIssue.severity.in_(VISIBLE_SEVERITIES), current)
    )
    for property_id, item in [*row_issues, *upload_issues]:
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
    approved = _approved_run(portfolio_id)
    run_summary = (approved.configuration or {}).get("summary", {}) if approved else {}
    loss100 = next((item.get("loss_kes") for item in run_summary.get("tierLosses", []) if item.get("rp") == 100), None)
    return {
        "portfolioId": portfolio.id,
        "name": portfolio.name,
        "status": "approved" if approved else portfolio.status,
        "totalInsuredValueKes": _num(tiv) or 0.0,
        "propertyCount": count,
        "confirmedCount": review.get("confirmed", 0),
        "unconfirmedCount": review.get("unconfirmed", 0),
        "hazardMissingCount": hazard_missing,
        "portfolioAalKes": run_summary.get("aalKes"),
        "aalPercentTiv": run_summary.get("aalKes") / float(tiv) * 100 if tiv and run_summary.get("aalKes") else None,
        "loss100Kes": loss100,
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


def _exclude_reference_properties(query):
    """Keep the seeded hazard locations out of Accumulation's underwriter exposure."""
    reference_uploads = db.session.query(HazardReferencePoint.source_upload_id).filter(HazardReferencePoint.source_upload_id.isnot(None))
    return query.filter(or_(Property.upload_id.is_(None), Property.upload_id.notin_(reference_uploads)))


def list_properties(portfolio_id: str, filters: dict) -> dict | None:
    if db.session.get(Portfolio, portfolio_id) is None:
        return None
    query = Property.query.filter(Property.portfolio_id == portfolio_id)
    if str(filters.get("excludeReference") or "").lower() == "true":
        query = _exclude_reference_properties(query)
    upload_id = filters.get("uploadId")
    if upload_id:
        if Upload.query.filter_by(id=upload_id, portfolio_id=portfolio_id).first() is None:
            raise RepositoryError("The selected upload was not found in this portfolio.", 404)
        query = query.filter(Property.upload_id == upload_id)

    text = (filters.get("q") or "").strip()
    if text:
        pattern = f"%{text}%"
        query = query.filter(or_(Property.id.ilike(pattern), Property.name.ilike(pattern), Property.region.ilike(pattern)))
    if filters.get("housingClass"):
        query = query.filter(Property.housing_class == filters["housingClass"])
    approved = _approved_run(portfolio_id)
    in_run = db.session.query(HazardResult.property_id).filter(HazardResult.model_run_id == approved.id) if approved else None
    if filters.get("hazardBand"):
        bands = {band.strip().lower() for band in filters["hazardBand"].split(",")}
        if approved is None:
            if PENDING not in bands:
                query = query.filter(false())  # no approved results yet
        else:
            probability = HazardResult.annual_flood_probability
            ranges = {"severe": probability >= 0.1, "high": (probability >= 0.04) & (probability < 0.1),
                      "moderate": (probability >= 0.01) & (probability < 0.04), "low": or_(probability.is_(None), probability < 0.01)}
            conditions = [Property.id.in_(in_run.filter(ranges[band])) for band in bands if band in ranges]
            if PENDING in bands:
                conditions.append(Property.id.notin_(in_run))
            query = query.filter(or_(*conditions)) if conditions else query.filter(false())
    if filters.get("minTiv") is not None:
        query = query.filter(Property.insured_value_kes >= filters["minTiv"])
    if filters.get("maxTiv") is not None:
        query = query.filter(Property.insured_value_kes <= filters["maxTiv"])
    if filters.get("minProbability") is not None:
        query = query.filter(Property.id.in_(in_run.filter(HazardResult.annual_flood_probability >= filters["minProbability"]))) if approved else query.filter(false())
    if str(filters.get("aiFlagged", "")).lower() == "true":
        query = query.filter(false())  # no AI uplift is applied yet
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
    approved = _approved_run(portfolio_id)
    ids = [prop.id for prop in page]
    hazards = {item.property_id: item for item in HazardResult.query.filter(HazardResult.model_run_id == approved.id, HazardResult.property_id.in_(ids)).all()} if approved and ids else {}
    losses = {item.property_id: item for item in LossResult.query.filter(LossResult.model_run_id == approved.id, LossResult.property_id.in_(ids)).all()} if approved and ids else {}
    return {
        "items": [property_item(prop, len(issues[prop.id]), hazards.get(prop.id), losses.get(prop.id)) for prop in page],
        "total": total,
        "nextCursor": str(offset + limit) if offset + limit < total else None,
        "dummy": False,
    }


def _aal_rank(prop: Property, run, loss_result) -> tuple[str | None, float | None]:
    """Rank label by AAL within the approved run, and this property's share of the portfolio 1-in-100 loss."""
    if run is None or loss_result is None:
        return None, None
    aal = float(loss_result.aal_kes or 0)
    count = LossResult.query.filter_by(model_run_id=run.id).count()
    higher = LossResult.query.filter(LossResult.model_run_id == run.id, LossResult.aal_kes > aal).count()
    total_100 = db.session.query(func.sum(LossResult.loss_100_kes)).filter(LossResult.model_run_id == run.id).scalar()
    share = float(loss_result.loss_100_kes or 0) / float(total_100) if total_100 else None
    if aal <= 0:
        return f"No AAL (of {count})", share
    percent = (higher + 1) / count * 100
    return (f"Top {max(percent, 1):.0f}%" if percent <= 50 else f"Bottom {max(100 - percent, 1):.0f}%") + f" · #{higher + 1} of {count}", share


def _summary(prop: Property, hazard_result, loss_result, tiers: list[dict]) -> str:
    if loss_result is None:
        return "Exposure and proxy hazard scores are loaded. Losses and flood probability appear once a model run that includes this property is approved."
    probability = _num(hazard_result.annual_flood_probability) if hazard_result else None
    tiv = _num(prop.insured_value_kes) or 0
    first_wet = next((tier for tier in tiers if tier["depthM"] > 0), None)
    if not probability or first_wet is None:
        return f"None of the five flood scenarios reaches this property in the approved run, so its modelled loss is zero."
    loss100 = _num(loss_result.loss_100_kes) or 0
    return (f"Floodwater first reaches this property in the {first_wet['name']} scenario (about 1 in {first_wet['returnPeriodYears']} years, "
            f"so roughly a {probability:.0%} chance each year), at a proxy depth of {first_wet['depthM']:.2f} m. "
            f"In a 1-in-100 flood it could lose about {loss100 / tiv:.0%} of its insured value (KES {loss100 / 1e6:,.1f}M). "
            f"Its long-run average yearly flood cost is KES {(_num(loss_result.aal_kes) or 0) / 1e6:,.2f}M.")


def _portfolio_context(prop: Property, rank: str | None = None) -> dict:
    rows = db.session.query(Property.latitude, Property.longitude, Property.insured_value_kes).filter(Property.portfolio_id == prop.portfolio_id).all()
    lat = np.array([float(row[0]) for row in rows])
    lon = np.array([float(row[1]) for row in rows])
    tiv = np.array([float(row[2] or 0) for row in rows])
    near = fm.haversine_km(lat, lon, float(prop.latitude), float(prop.longitude)) <= LOCAL_RADIUS_KM
    return {
        "aalRank": rank,
        "cluster": prop.region,
        "propertiesWithin500m": int(near.sum()) - 1,
        "localInsuredValueKes": float(tiv[near].sum()),
    }


def property_detail(property_id: str, include_draft: bool = False) -> dict | None:
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
    approved = _approved_run(prop.portfolio_id)
    hazard_result = HazardResult.query.filter_by(property_id=prop.id, model_run_id=approved.id).first() if approved else None
    loss_result = LossResult.query.filter_by(property_id=prop.id, model_run_id=approved.id).first() if approved else None
    has_approved = loss_result is not None
    draft = None
    if not has_approved and include_draft:
        draft = ModelRun.query.filter_by(portfolio_id=prop.portfolio_id, status="review").order_by(ModelRun.created_at.desc()).first()
        if draft is not None:
            hazard_result = HazardResult.query.filter_by(property_id=prop.id, model_run_id=draft.id).first()
            loss_result = LossResult.query.filter_by(property_id=prop.id, model_run_id=draft.id).first()
    status = model_status(prop, approved, draft, has_approved, not has_approved and loss_result is not None)
    item = property_item(prop, len(issues), hazard_result, loss_result)
    rank, share = _aal_rank(prop, approved if has_approved else draft, loss_result)
    return {
        "identity": {key: item[key] for key in ("id", "portfolioId", "name", "region", "latitude", "longitude", "housingClass", "sourceTag", "reviewStatus", "geocodePrecision")} | {"address": (prop.attributes or {}).get("address"), "geocode": (prop.attributes or {}).get("geocode")},
        "exposure": {"floorAreaM2": item["floorAreaM2"], "costPerM2Kes": item["costPerM2Kes"], "insuredValueKes": item["insuredValueKes"], "sourceTag": prop.source_tag, "extra": (prop.attributes or {}).get("extra", {})},
        "hazard": {
            "score": item["hazardScore"],
            "band": item["hazardBand"],
            "annualFloodProbability": item["annualFloodProbability"],
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
            "aalKes": item["aalKes"],
            "aalPerMilleTiv": item["aalKes"] / item["insuredValueKes"] * 1000 if item["aalKes"] is not None and item["insuredValueKes"] else None,
            "loss10Kes": _num(loss_result.loss_10_kes) if loss_result else None,
            "loss100Kes": item["loss100Kes"],
            "loss250Kes": item["loss250Kes"],
            "portfolioLoss100Share": share,
            "epCurve": loss_result.ep_curve if loss_result else [],
            "sourceTag": ("modelled" if has_approved else "draft") if loss_result else "pending_model_run",
        },
        "explainability": {
            "summary": _summary(prop, hazard_result, loss_result, tiers),
            "warnings": [{"code": issue.code, "severity": issue.severity, "message": issue.message, "scope": "row" if issue.upload_row_id else "document", "evidence": issue.evidence} for issue in issues],
            "provenance": [{"method": method, "fields": count} for method, count in sorted(methods.items())],
        },
        "portfolioContext": _portfolio_context(prop, rank),
        "modelStatus": status,
        "dummy": False,
    }


def list_clusters(portfolio_id: str, cluster_type: str, upload_id: str | None = None, exclude_reference: bool = False) -> dict | None:
    if db.session.get(Portfolio, portfolio_id) is None:
        return None
    if cluster_type not in CLUSTER_TYPES:
        raise RepositoryError(f"type must be one of {', '.join(CLUSTER_TYPES)}.")
    query = Property.query.filter_by(portfolio_id=portfolio_id)
    if exclude_reference:
        query = _exclude_reference_properties(query)
    if upload_id:
        if Upload.query.filter_by(id=upload_id, portfolio_id=portfolio_id).first() is None:
            raise RepositoryError("The selected upload was not found in this portfolio.", 404)
        query = query.filter(Property.upload_id == upload_id)
    props = query.all()
    total_tiv = sum(_num(prop.insured_value_kes) or 0 for prop in props)
    approved = _approved_run(portfolio_id)
    losses = {item.property_id: item for item in LossResult.query.filter_by(model_run_id=approved.id)} if approved else {}
    hazards = {item.property_id: item for item in HazardResult.query.filter_by(model_run_id=approved.id)} if approved else {}
    portfolio_l100 = sum(_num(item.loss_100_kes) or 0 for item in losses.values())
    groups: dict[str, list[Property]] = defaultdict(list)
    if cluster_type == "neighbourhood" and not any(prop.region for prop in props):
        cluster_type = "grid"  # no regions in the data: neighbourhoods fall back to ~5.5 km grid cells
    for prop in props:
        if cluster_type == "neighbourhood":
            key = prop.region or "Unassigned"
        elif cluster_type == "housing_class":
            key = prop.housing_class or "Unassigned"
        elif cluster_type == "grid":  # ~5.5 km cells
            key = f"Grid {round(float(prop.latitude) / 0.05) * 0.05:.2f}, {round(float(prop.longitude) / 0.05) * 0.05:.2f}" if prop.latitude is not None and prop.longitude is not None else "Unlocated"
        else:
            hazard = hazards.get(prop.id)
            key = _risk_band(_num(hazard.annual_flood_probability)) if hazard else PENDING
        groups[key].append(prop)

    items = []
    for name, members in groups.items():
        tiv = sum(_num(prop.insured_value_kes) or 0 for prop in members)
        geocoded = [prop for prop in members if prop.latitude is not None and prop.longitude is not None]
        classes = Counter(CLASS_MIX_KEYS.get(prop.housing_class, "other") for prop in members)
        modelled = [prop for prop in members if prop.id in losses]
        l100 = sum(_num(losses[prop.id].loss_100_kes) or 0 for prop in modelled) if modelled else None
        aal = sum(_num(losses[prop.id].aal_kes) or 0 for prop in modelled) if modelled else None
        probabilities = [_num(hazards[prop.id].annual_flood_probability) or 0 for prop in modelled if prop.id in hazards]
        mean_probability = sum(probabilities) / len(probabilities) if probabilities else None
        items.append({
            "id": "CLU-" + re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").upper(),
            "portfolioId": portfolio_id,
            "name": name,
            "type": cluster_type,
            "propertyCount": len(members),
            "geocodedCount": len(geocoded),
            "unconfirmedCount": sum(prop.review_status != "confirmed" for prop in members),
            "centroidLat": sum(float(prop.latitude) for prop in geocoded) / len(geocoded) if geocoded else None,
            "centroidLng": sum(float(prop.longitude) for prop in geocoded) / len(geocoded) if geocoded else None,
            "insuredValueKes": tiv,
            "tivShare": tiv / total_tiv if total_tiv else None,
            "loss100Kes": l100,
            "aalPercentTiv": aal / tiv * 100 if aal is not None and tiv else None,
            "annualFloodProbability": mean_probability,
            "portfolioLossShare": l100 / portfolio_l100 if l100 is not None and portfolio_l100 else None,
            "riskBand": _risk_band(mean_probability) if modelled else PENDING,
            "classMix": {key: value / len(members) for key, value in classes.items()},
            "hotspotFlag": None,
            "accumulationFlag": None,
        })
    items.sort(key=lambda item: (item["loss100Kes"] or 0, item["insuredValueKes"]), reverse=True)
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


SNIPPET_CHARS = 240


def _snippet(text: str, terms: list[str]) -> str:
    lowered = text.lower()
    positions = [lowered.find(term.lower()) for term in terms if lowered.find(term.lower()) >= 0]
    start = max(min(positions) - SNIPPET_CHARS // 3, 0) if positions else 0
    snippet = text[start:start + SNIPPET_CHARS].strip()
    return ("…" if start else "") + snippet + ("…" if start + SNIPPET_CHARS < len(text) else "")


def search_documents(portfolio_id: str, text: str, limit: int = 10) -> dict:
    """Full-text search over document chunks (Postgres FTS; substring match on other databases)."""
    text = (text or "").strip()
    terms = [term for term in re.findall(r"\w+", text) if len(term) > 1]
    if not terms:
        raise RepositoryError("q must contain at least one word.")
    query = (
        db.session.query(DocumentChunk, Upload.filename)
        .join(Upload, Upload.id == DocumentChunk.upload_id)
        .filter(DocumentChunk.portfolio_id == portfolio_id)
    )
    if db.engine.dialect.name == "postgresql":
        vector = func.to_tsvector("english", DocumentChunk.text)
        search = func.websearch_to_tsquery("english", text)
        query = query.filter(vector.op("@@")(search)).order_by(func.ts_rank(vector, search).desc())
    else:
        for term in terms:
            query = query.filter(DocumentChunk.text.ilike(f"%{term}%"))
        query = query.order_by(DocumentChunk.upload_id, DocumentChunk.chunk_index)
    results = query.limit(min(max(limit, 1), 50)).all()
    return {
        "items": [
            {"uploadId": chunk.upload_id, "filename": filename, "page": chunk.page, "chunkIndex": chunk.chunk_index, "snippet": _snippet(chunk.text, terms), "text": chunk.text}
            for chunk, filename in results
        ],
        "total": len(results),
    }
