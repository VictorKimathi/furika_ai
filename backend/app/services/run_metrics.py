"""Metrics catalogue by stage for a model run (stages 0-7 of the Furika chain).

Each metric is {id, label, plain, tag, priority, value, display, status, note, chart, table}.
`chart` carries plotting data for the frontend: bar | stacked | line | heatmap | tornado | scatter.
Metrics that the data cannot support yet are returned with value None and a note saying why,
never with an invented number.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

from ..extensions import db
from ..models import (
    DocumentFact, FieldProvenance, Hotspot, LossResult, ModelRun, Property, Upload, UploadRow, ValidationIssue,
)
from . import furika_model as fm
from .ingestion.validation import HAZARD_FIELDS, REQUIRED_FIELDS

RP_BANDS = [("never", None), ("1 in 250", 250), ("1 in 100", 100), ("1 in 50", 50), ("1 in 25", 25), ("1 in 10", 10)]
DAMAGE_BANDS = [("light (<10%)", 0, 0.10), ("moderate (10-40%)", 0.10, 0.40), ("heavy (40-70%)", 0.40, 0.70), ("severe (>70%)", 0.70, 1.01)]
ACCUMULATION_TIV_SHARE = 0.10
ACCUMULATION_PROBABILITY = 0.01
GRID_DEGREES = 0.05
LIMITATIONS = [
    "Hazard scores are topographic susceptibility proxies, not measured flood depths.",
    "Tier-to-return-period mapping is assumed (extreme 10, severe 25, moderate 50, occasional 100, common 250 years).",
    "Depth = score x D_max is an assumption; D_max defaults to 4 m.",
    "Vulnerability curves are adapted from JRC/Huizinga references and are not calibrated to Kenyan claims.",
    "Five scenario tiers are not a stochastic event set; AAL is reported as a range.",
    "Gross and net losses use illustrative policy and reinsurance terms, not supplied contracts.",
    "Exposure is synthetic or redacted and has not been validated against an actual cedant book.",
]
STAGE_INFO = {
    "ingestion": ("0 Data entry", "Uploaded files (CSV, Excel, PDF, text)", "Validated property table, document index, provenance log", "ING-02"),
    "hazard": ("1 Hazard", "Property table, hazard scores, hotspots, assumptions (D_max, RP map)", "Depth per property per tier, flood probability", "HAZ-07"),
    "vulnerability": ("2 Vulnerability", "Depth, housing class, curve parameters", "Damage ratio per property per tier, damage matrix", "VUL-06"),
    "exposure": ("3 Exposure", "Validated property table", "Totals, class/region splits, accumulation", "EXP-01"),
    "financial": ("4 Financial engine", "Damage ratio, TIV, policy and reinsurance terms (assumed)", "Ground-up, gross and net loss per tier, EP curves, AAL", "FIN-01"),
    "ai": ("5 AI layer", "Reports, free text, model outputs", "Extracted records, parsed rows, chat answers", "AI-02"),
    "portfolio": ("6 Portfolio and map", "All results", "Clusters, rankings, map layers", "PORT-02"),
    "trust": ("7 Trust", "Whole run", "Provenance mix, sensitivity, checks", "TRU-05"),
}
_CACHE: dict[str, dict] = {}


class MetricsError(ValueError):
    pass


# ---------- formatting ----------

def kes(value) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "n/a"
    value = float(value)
    if abs(value) >= 1e9:
        return f"KES {value / 1e9:.3g} bn"
    if abs(value) >= 1e6:
        return f"KES {value / 1e6:.3g} m"
    if abs(value) >= 1e3:
        return f"KES {value / 1e3:.3g} k"
    return f"KES {value:.3g}"


def pct(value, digits: int = 1) -> str:
    return "n/a" if value is None else f"{float(value) * 100:.{digits}f}%"


def permille(value) -> str:
    return "n/a" if value is None else f"{float(value) * 1000:.2f}‰"


def num(value):
    if value is None:
        return None
    value = float(value)
    return None if np.isnan(value) or np.isinf(value) else round(value, 6)


def metric(id_, label, tag, priority, value=None, display=None, *, plain=None, status=None, note=None, chart=None, table=None, data=None) -> dict:
    return {"id": id_, "label": label, "plain": plain, "tag": tag, "priority": priority, "value": value,
            "display": display if display is not None else ("Not measured yet" if value is None else str(value)),
            "status": status, "note": note, "chart": chart, "table": table, "data": data}


def not_measured(id_, label, tag, priority, reason, plain=None) -> dict:
    return metric(id_, label, tag, priority, None, "Not measured yet", plain=plain, note=reason)


def rp_label(rp) -> str:
    return f"1 in {int(rp)}"


# ---------- inputs ----------

def _run_frame(run: ModelRun) -> tuple[list[Property], pd.DataFrame]:
    ids = [loss.property_id for loss in LossResult.query.filter_by(model_run_id=run.id).with_entities(LossResult.property_id)]
    query = Property.query.filter(Property.portfolio_id == run.portfolio_id)
    props = query.filter(Property.id.in_(ids)).order_by(Property.id).all() if ids else []
    if not props:
        from .model_runs import _properties
        props = _properties(run.portfolio_id)
    if not props:
        raise MetricsError("The run has no modelled properties.")
    rows = []
    for prop in props:
        scores = (prop.attributes or {}).get("hazard_scores") or {}
        if not all(tier in scores for tier in fm.TIERS):
            continue
        rows.append({"loc_id": prop.id, "lat": float(prop.latitude), "lon": float(prop.longitude), "housing_class": prop.housing_class,
                     "floor_area_m2": float(prop.floor_area_m2), "cost_per_m2_kes": float(prop.cost_per_m2_kes), "tiv_kes": float(prop.insured_value_kes),
                     "region": prop.region, **{f"hazard_score_{tier}": float(scores[tier]) for tier in fm.TIERS}})
    return props, pd.DataFrame(rows)


def _hotspot_frame() -> pd.DataFrame | None:
    spots = Hotspot.query.all()
    if not spots:
        return None
    return pd.DataFrame([{"name": spot.name, "lat": spot.latitude, "lon": spot.longitude, "severity": spot.severity or "medium", "weight": spot.weight} for spot in spots])


# ---------- stage 0: ingestion ----------

def _ingestion(portfolio_id: str, props: list[Property]) -> list[dict]:
    uploads = Upload.query.filter_by(portfolio_id=portfolio_id).order_by(Upload.created_at).all()
    upload_ids = [upload.id for upload in uploads]
    rows = UploadRow.query.filter(UploadRow.upload_id.in_(upload_ids)).all() if upload_ids else []
    issues = ValidationIssue.query.filter(ValidationIssue.upload_id.in_(upload_ids), ValidationIssue.resolution.is_(None) | (ValidationIssue.resolution != "superseded")).all() if upload_ids else []
    out = []

    by_type = Counter(upload.extractor for upload in uploads)
    out.append(metric("ING-01", "Files received", "Model", "P2", len(uploads), f"{len(uploads)} files",
                      chart={"type": "bar", "categories": list(by_type), "series": [{"name": "Files", "values": list(by_type.values())}], "unit": "files"},
                      table={"columns": ["File", "Type", "Size (KB)", "Status"], "rows": [[upload.filename, upload.extractor, round(upload.size_bytes / 1024, 1), upload.status] for upload in uploads]}))

    statuses = Counter(row.status for row in rows)
    total = len(rows)
    funnel = [("received", total), ("accepted", statuses["accepted"]), ("with warnings", statuses["accepted_with_warnings"]), ("needs review", statuses["needs_review"]), ("rejected", statuses["rejected"])]
    accepted_share = (statuses["accepted"] + statuses["accepted_with_warnings"]) / total if total else None
    out.append(metric("ING-02", "Row funnel", "Model", "P1", num(accepted_share), f"{pct(accepted_share)} accepted of {total} rows",
                      plain="How many uploaded rows were accepted, flagged, or rejected",
                      chart={"type": "bar", "categories": [name for name, _ in funnel], "series": [{"name": "Rows", "values": [value for _, value in funnel]}], "unit": "rows", "palette": "ordinal"}))

    fields = [*REQUIRED_FIELDS, "lat", "lon", "tiv_kes", *HAZARD_FIELDS]
    completeness = {name: (sum(1 for row in rows if (row.data or {}).get(name) is not None) / total if total else None) for name in fields}
    worst = min((value for value in completeness.values() if value is not None), default=None)
    out.append(metric("ING-03", "Field completeness", "Model", "P2", num(worst), f"lowest field {pct(worst)}", status=None if worst is None else ("pass" if worst >= 1 else "warn"),
                      chart={"type": "bar", "categories": fields, "series": [{"name": "% complete", "values": [num((value or 0) * 100) for value in completeness.values()]}], "unit": "%", "horizontal": True, "max": 100}))

    by_code = defaultdict(Counter)
    for item in issues:
        by_code[item.code][item.severity] += 1
    codes = sorted(by_code, key=lambda code: -sum(by_code[code].values()))[:10]
    severities = ["error", "review", "warning", "info"]
    errors = sum(by_code[code]["error"] for code in by_code)
    out.append(metric("ING-04", "Issues by severity and rule", "Model", "P1", len(issues), f"{len(issues)} issues · {errors} errors", status="pass" if errors == 0 else "warn",
                      chart={"type": "stacked", "categories": codes, "series": [{"name": severity, "values": [by_code[code][severity] for code in codes]} for severity in severities], "unit": "issues", "palette": "status", "horizontal": True}))

    ratios = [float(prop.insured_value_kes) / (float(prop.floor_area_m2) * float(prop.cost_per_m2_kes)) for prop in props if prop.floor_area_m2 and prop.cost_per_m2_kes and prop.insured_value_kes]
    median_ratio = float(np.median(ratios)) if ratios else None
    out.append(metric("ING-05", "TIV reconciliation ratio", "Model", "P1", num(median_ratio), f"{median_ratio:.2f}× floor area × cost" if median_ratio else "n/a",
                      status=None if median_ratio is None else ("pass" if 0.9 <= median_ratio <= 1.1 else "warn"),
                      note="Median of tiv / (floor_area × cost_per_m2). Far from 1 means the TIV definition needs confirming." if median_ratio and not 0.9 <= median_ratio <= 1.1 else None))

    precision = Counter(prop.geocode_precision for prop in props)
    bounds = fm.NAIROBI_BOUNDS
    inside = sum(1 for prop in props if bounds["lat_min"] <= float(prop.latitude) <= bounds["lat_max"] and bounds["lon_min"] <= float(prop.longitude) <= bounds["lon_max"])
    out.append(metric("ING-06", "Geocode quality", "Model", "P2", num(inside / len(props)) if props else None, f"{pct(inside / len(props)) if props else 'n/a'} inside Nairobi bounds",
                      chart={"type": "bar", "categories": list(precision), "series": [{"name": "Properties", "values": list(precision.values())}], "unit": "properties"}))

    duplicates = sum(1 for item in issues if item.code in ("duplicate_loc_id", "duplicate_location"))
    out.append(metric("ING-07", "Duplicates", "Model", "P3", duplicates, f"{duplicates} rows", status="pass" if duplicates == 0 else "warn"))

    row_ids = [row.id for row in rows]
    ai_prov = FieldProvenance.query.filter(FieldProvenance.subject_type == "upload_row", FieldProvenance.subject_id.in_(row_ids), FieldProvenance.method.in_(("ai_mapped", "ai_extracted")), FieldProvenance.superseded_by.is_(None)).all() if row_ids else []
    if ai_prov:
        edges = [0, 0.5, 0.7, 0.9, 1.0001]
        labels = ["<0.5", "0.5-0.7", "0.7-0.9", "≥0.9"]
        counts = [sum(1 for item in ai_prov if edges[i] <= (item.confidence or 0) < edges[i + 1]) for i in range(4)]
        below = sum(counts[:3]) / len(ai_prov)
        out.append(metric("ING-08", "Extraction confidence", "AI-derived", "P2", num(below), f"{pct(below)} below 0.9", note="Threshold 0.9: AI values at or above it are auto-confirmed for column mapping.",
                          chart={"type": "bar", "categories": labels, "series": [{"name": "AI values", "values": counts}], "unit": "values", "palette": "ordinal"}))
    else:
        out.append(not_measured("ING-08", "Extraction confidence", "AI-derived", "P2", "No AI-mapped or AI-extracted values in this portfolio: every column matched its header exactly."))

    extracted = sum(1 for item in ai_prov if item.method == "ai_extracted")
    dropped = sum(1 for item in issues if item.code == "ai_quote_not_found")
    if extracted + dropped:
        rate = extracted / (extracted + dropped)
        out.append(metric("ING-09", "Quote verification rate", "AI-derived", "P2", num(rate), pct(rate), status="pass" if rate >= 0.95 else "warn"))
    else:
        out.append(not_measured("ING-09", "Quote verification rate", "AI-derived", "P2", "No document values have been extracted by AI yet."))

    pending = statuses["needs_review"]
    unconfirmed = sum(1 for prop in props if prop.review_status == "unconfirmed")
    reviewed = [row for row in rows if row.reviewed_at is not None]
    confirmed = sum(1 for row in reviewed if row.status in ("accepted", "accepted_with_warnings"))
    rejected = sum(1 for row in reviewed if row.status == "rejected")
    edited = len({item.subject_id for item in FieldProvenance.query.filter(FieldProvenance.subject_type == "upload_row", FieldProvenance.subject_id.in_(row_ids), FieldProvenance.superseded_by.isnot(None))}) if row_ids else 0
    queue = [("pending", pending + unconfirmed), ("confirmed", confirmed), ("rejected", rejected), ("edited", edited)]
    out.append(metric("ING-10", "Review queue", "Model", "P1", pending + unconfirmed, f"{pending + unconfirmed} pending", status="pass" if pending + unconfirmed == 0 else "warn",
                      chart={"type": "bar", "categories": [name for name, _ in queue], "series": [{"name": "Rows", "values": [value for _, value in queue]}], "unit": "rows"}))

    checks = ["tiv_mismatch", "area_breakdown_mismatch", "unit_inconsistency", "hazard_non_monotonic", "cost_outlier", "offer_expiring"]
    check_counts = Counter(item.code for item in issues if item.code in checks)
    failing = sum(1 for check in checks if check_counts[check])
    out.append(metric("ING-11", "Cross-field consistency", "Model", "P2", len(checks) - failing, f"{len(checks) - failing}/{len(checks)} checks clear", status="pass" if failing == 0 else "warn",
                      table={"columns": ["Check", "Rows flagged", "Result"], "rows": [[check.replace("_", " "), check_counts[check], "pass" if not check_counts[check] else "warn"] for check in checks]}))

    complete = float(np.mean([value for value in completeness.values() if value is not None])) if total else 0.0
    validity = accepted_share or 0.0
    confirmation = sum(1 for prop in props if prop.review_status == "confirmed") / len(props) if props else 0.0
    score = round(100 * (0.4 * complete + 0.3 * validity + 0.3 * confirmation))
    out.append(metric("ING-12", "Data quality score", "Model", "P1", score, f"{score} / 100", status="pass" if score >= 85 else "warn",
                      plain="A 0-100 score combining completeness, validity and confirmation",
                      table={"columns": ["Component", "Weight", "Score"], "rows": [["Completeness", "40%", pct(complete)], ["Validity (rows accepted)", "30%", pct(validity)], ["Confirmation rate", "30%", pct(confirmation)]]}))

    latest = uploads[-1].created_at if uploads else None
    expiry = DocumentFact.query.filter(DocumentFact.upload_id.in_(upload_ids), DocumentFact.key == "offer_expiry").first() if upload_ids else None
    out.append(metric("ING-13", "Freshness", "Real", "P3", latest.isoformat() if latest else None, f"latest upload {latest:%Y-%m-%d %H:%M}" if latest else "no uploads",
                      note=f"Document expiry stated: {expiry.value} (page {expiry.page})" if expiry else None))
    return out


# ---------- stages 1-4 and 6-7 from the model result ----------

def _hazard(frame: pd.DataFrame, result: dict) -> list[dict]:
    losses = result["losses"]
    tiers = sorted(fm.TIERS, key=lambda tier: fm.DEFAULT_TIER_RP[tier])
    tier_labels = [f"{tier} ({rp_label(fm.DEFAULT_TIER_RP[tier])})" for tier in tiers]
    total_tiv = frame["tiv_kes"].sum()
    out = []

    bins = [0, 1e-12, 0.2, 0.4, 0.6, 0.8, 1.0001]
    bin_labels = ["0", "0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1"]
    matrix = []
    for tier in tiers:
        scores = frame[f"hazard_score_{tier}"]
        matrix.append([int(((scores >= bins[i]) & (scores < bins[i + 1])).sum()) for i in range(len(bin_labels))])
    out.append(metric("HAZ-01", "Score distribution per tier", "Proxy", "P3", None, "see chart",
                      chart={"type": "heatmap", "rows": tier_labels, "cols": bin_labels, "values": matrix, "unit": "properties"}))

    share_props = [float((frame[f"hazard_score_{tier}"] > 0).mean()) for tier in tiers]
    share_tiv = [float(frame.loc[frame[f"hazard_score_{tier}"] > 0, "tiv_kes"].sum() / total_tiv) for tier in tiers]
    out.append(metric("HAZ-02", "Footprint share per tier", "Proxy", "P1", num(share_props[-1]), f"{pct(share_props[-1])} of properties wet at 1 in 250",
                      plain="Share of properties (and value) reached by water in each scenario",
                      chart={"type": "bar", "categories": tier_labels, "series": [{"name": "% of properties", "values": [num(v * 100) for v in share_props]}, {"name": "% of TIV", "values": [num(v * 100) for v in share_tiv]}], "unit": "%"}))

    violations = len(result["monotonic_violations"])
    out.append(metric("HAZ-03", "Nesting check", "Model", "P1", violations, "pass: depth never falls as RP rises" if violations == 0 else f"{violations} properties fail", status="pass" if violations == 0 else "fail"))

    stats = []
    for tier in tiers:
        wet = losses[(losses["tier"] == tier) & (losses["depth_m"] > 0)]["depth_m"]
        stats.append((float(wet.mean()) if len(wet) else 0.0, float(np.percentile(wet, 90)) if len(wet) else 0.0, float(wet.max()) if len(wet) else 0.0))
    out.append(metric("HAZ-04", "Depth statistics per tier", "Assumed", "P2", num(stats[-1][2]), f"max {stats[-1][2]:.2f} m at 1 in 250",
                      chart={"type": "line", "x": [rp_label(fm.DEFAULT_TIER_RP[tier]) for tier in tiers], "series": [{"name": "mean", "values": [num(s[0]) for s in stats]}, {"name": "p90", "values": [num(s[1]) for s in stats]}, {"name": "max", "values": [num(s[2]) for s in stats]}], "unit": "m", "xLabel": "Return period", "yLabel": "Proxy depth (m)"}))

    first = result["flood_probability"].set_index("loc_id")["rp_first"] if len(result["flood_probability"]) else pd.Series(dtype=float)
    band_of = {loc: (rp_label(rp)) for loc, rp in first.items()}
    band_counts = Counter(band_of.get(loc, "never") for loc in frame["loc_id"])
    band_tiv = defaultdict(float)
    for loc, tiv in zip(frame["loc_id"], frame["tiv_kes"]):
        band_tiv[band_of.get(loc, "never")] += tiv
    labels = [name for name, _ in RP_BANDS]
    flooded_share = 1 - band_counts["never"] / len(frame)
    out.append(metric("HAZ-05", "Flood probability", "Assumed", "P1", num(flooded_share), f"{pct(flooded_share)} of properties reached in some scenario",
                      plain="Approximate chance each year a building is reached by floodwater",
                      chart={"type": "bar", "categories": labels, "series": [{"name": "Properties", "values": [band_counts[name] for name in labels]}], "unit": "properties", "palette": "ordinal"}))
    out.append(metric("HAZ-06", "TIV by flood-probability band", "Assumed", "P1", num(1 - band_tiv["never"] / total_tiv), f"{pct(1 - band_tiv['never'] / total_tiv)} of TIV in a flood band",
                      chart={"type": "bar", "categories": labels, "series": [{"name": "% of TIV", "values": [num(band_tiv[name] / total_tiv * 100) for name in labels]}], "unit": "%", "palette": "ordinal"}))

    hotspots = _hotspot_frame()
    if hotspots is not None:
        check = fm.validate_hotspots(frame, hotspots)
        out.append(metric("HAZ-07", "Hotspot hit-rate", "Real + Proxy", "P1", num(check["hitRate"]), f"{check['hits']} / {check['hotspotCount']}",
                          plain="How many known flood areas the model recognises",
                          note=f"Hit = nearest property's maximum score above {check['threshold']}.",
                          table={"columns": ["Hotspot", "Nearest property", "Distance (km)", "Score", "Hit"], "rows": [[d["name"], d["nearestProperty"], round(d["distanceKm"], 2), round(d["score"], 3), "yes" if d["hit"] else "no"] for d in check["details"]]}))
    else:
        out.append(not_measured("HAZ-07", "Hotspot hit-rate", "Real + Proxy", "P1", "No hotspot reference file is loaded. Load one with seed-reference --hotspots.", plain="How many known flood areas the model recognises"))
    out.append(not_measured("HAZ-08", "Hold-out hit-rate", "AI-derived", "P1", "No AI uplift is applied in this run, so there is nothing to hold out."))
    out.append(metric("HAZ-09", "Uplift coverage", "AI-derived", "P2", 0, "0 properties uplifted", note="Hotspot uplift is off for this run."))
    assumptions = result["assumptions"]
    out.append(metric("HAZ-10", "Assumption panel", "Assumed", "P1", assumptions["d_max_m"], f"D_max {assumptions['d_max_m']} m",
                      table={"columns": ["Assumption", "Value", "Status"], "rows": [["D_max (depth at score 1)", f"{assumptions['d_max_m']} m", "assumed"], ["Wet threshold", f"{assumptions['wet_threshold_m']} m", "assumed"],
                                                                                    *[[f"RP for {tier}", f"{assumptions['tier_rp'][tier]:g} years", "assumed"] for tier in tiers], ["Tail beyond 250 years", assumptions["rare_tail"], "assumed"]]}))
    return out


def _vulnerability(frame: pd.DataFrame, result: dict) -> list[dict]:
    losses = result["losses"]
    classes = [cls for cls in fm.VALID_CLASSES]
    tiers = sorted(fm.TIERS, key=lambda tier: fm.DEFAULT_TIER_RP[tier])
    out = []
    depths = [round(x, 2) for x in np.arange(0, 4.01, 0.25)]
    curves = [{"name": cls, "values": [num(v) for v in fm.damage_ratio(np.array(depths), [cls] * len(depths))]} for cls in classes]
    out.append(metric("VUL-01", "Damage curves", "Assumed", "P1", None, "3 class curves",
                      note="JRC reference overlay is not shown: the digitised JRC points are not loaded.",
                      chart={"type": "line", "x": depths, "series": curves, "unit": "ratio", "xLabel": "Depth (m)", "yLabel": "Damage ratio", "palette": "class"}))
    matrix_depths = [0.25, 0.5, 1, 2, 3, 4]
    out.append(metric("VUL-02", "Damage matrix", "Assumed", "P1", None, "class × depth",
                      chart={"type": "heatmap", "rows": classes, "cols": [f"{d} m" for d in matrix_depths], "values": [[num(v * 100) for v in fm.damage_ratio(np.array(matrix_depths, dtype=float), [cls] * len(matrix_depths))] for cls in classes], "unit": "%"}))
    out.append(metric("VUL-03", "Parameter table", "Assumed", "P2", None, "dr_max, d50, k per class",
                      table={"columns": ["Class", "dr_max", "d50 (m)", "k", "Source", "Status"], "rows": [[cls, fm.DEFAULT_VULN[cls]["dr_max"], fm.DEFAULT_VULN[cls]["d50"], fm.DEFAULT_VULN[cls]["k"], "Adapted JRC/Huizinga", "open"] for cls in classes]}))
    grid = np.linspace(0, 8, 161)
    checks = []
    for cls in classes:
        curve = fm.damage_ratio(grid, [cls] * len(grid))
        checks += [[cls, "monotonic", "pass" if np.all(np.diff(curve) >= -1e-12) else "fail"],
                   [cls, "capped at dr_max", "pass" if curve.max() <= fm.DEFAULT_VULN[cls]["dr_max"] + 1e-9 else "fail"],
                   [cls, "DR(0) = 0", "pass" if abs(curve[0]) < 1e-9 else "fail"]]
    ordering = fm.validate_vuln_params(fm.DEFAULT_VULN)
    checks.append(["all", "class ordering", "pass" if not ordering else "fail"])
    failed = sum(1 for row in checks if row[2] == "fail")
    out.append(metric("VUL-04", "Curve checks", "Model", "P2", len(checks) - failed, f"{len(checks) - failed}/{len(checks)} pass", status="pass" if failed == 0 else "fail",
                      table={"columns": ["Class", "Check", "Result"], "rows": checks}))
    out.append(not_measured("VUL-05", "Fit to reference", "Model", "P3", "Needs the digitised JRC reference points, which are not loaded."))

    wet = losses[losses["depth_m"] > 0]
    mean_dr = [{"name": cls, "values": [num(wet[(wet["tier"] == tier) & (wet["housing_class"] == cls)]["damage_ratio"].mean() * 100) if len(wet[(wet["tier"] == tier) & (wet["housing_class"] == cls)]) else 0 for tier in tiers]} for cls in classes]
    overall = float(wet["damage_ratio"].mean()) if len(wet) else 0.0
    out.append(metric("VUL-06", "Mean damage ratio", "Model", "P2", num(overall), f"{pct(overall)} among flooded property-scenarios",
                      chart={"type": "bar", "categories": [rp_label(fm.DEFAULT_TIER_RP[t]) for t in tiers], "series": mean_dr, "unit": "%", "palette": "class"}))
    bands = []
    for name, low, high in DAMAGE_BANDS:
        bands.append({"name": name, "values": [int(((wet["tier"] == tier) & (wet["damage_ratio"] >= low) & (wet["damage_ratio"] < high)).sum()) for tier in tiers]})
    out.append(metric("VUL-07", "Damage-band mix", "Model", "P2", None, "flooded properties by damage band",
                      chart={"type": "stacked", "categories": [rp_label(fm.DEFAULT_TIER_RP[t]) for t in tiers], "series": bands, "unit": "properties", "palette": "ordinal"}))
    caps = wet.apply(lambda row: row["damage_ratio"] >= 0.95 * fm.DEFAULT_VULN[row["housing_class"]]["dr_max"], axis=1) if len(wet) else pd.Series(dtype=bool)
    share = float(caps.mean()) if len(caps) else 0.0
    out.append(metric("VUL-08", "Cap utilisation", "Model", "P3", num(share), pct(share)))
    return out


def _lorenz(values: list[float], points: int = 21) -> tuple[list, list]:
    ordered = sorted(values, reverse=True)
    if not ordered:
        return [], []
    total = sum(ordered) or 1
    cumulative = np.cumsum(ordered) / total
    xs = [round(i / (points - 1), 3) for i in range(points)]
    ys = [0.0] + [float(cumulative[max(int(round(x * len(ordered))) - 1, 0)]) for x in xs[1:]]
    return [num(x * 100) for x in xs], [num(y * 100) for y in ys]


def _exposure(frame: pd.DataFrame, result: dict, props: list[Property]) -> list[dict]:
    losses = result["losses"]
    tiv = frame["tiv_kes"]
    total = float(tiv.sum())
    out = [metric("EXP-01", "Total exposure", "Synthetic", "P1", num(total), kes(total), plain="Total value insured in this portfolio (synthetic sample)"),
           metric("EXP-02", "Property count", "Synthetic", "P1", len(frame), f"{len(frame)} buildings"),
           metric("EXP-03", "Average and median TIV", "Synthetic", "P3", num(tiv.mean()), f"mean {kes(tiv.mean())} · median {kes(tiv.median())}")]
    classes = list(fm.VALID_CLASSES)
    tiv_share = [num(frame.loc[frame["housing_class"] == cls, "tiv_kes"].sum() / total * 100) for cls in classes]
    count_share = [num((frame["housing_class"] == cls).mean() * 100) for cls in classes]
    out.append(metric("EXP-04", "Class split", "Synthetic", "P1", None, "value vs count by class",
                      chart={"type": "bar", "categories": classes, "series": [{"name": "% of TIV", "values": tiv_share}, {"name": "% of count", "values": count_share}], "unit": "%"},
                      table={"columns": ["Class", "Properties", "TIV", "% TIV"], "rows": [[cls, int((frame["housing_class"] == cls).sum()), kes(frame.loc[frame["housing_class"] == cls, "tiv_kes"].sum()), f"{share:.1f}%"] for cls, share in zip(classes, tiv_share)]}))
    regions = frame["region"].fillna("unassigned")
    if (regions != "unassigned").any():
        split = frame.assign(region=regions).groupby("region")["tiv_kes"].agg(["sum", "count"]).sort_values("sum", ascending=False).head(10)
        out.append(metric("EXP-05", "Region split", "Synthetic", "P2", len(split), f"{len(split)} regions",
                          chart={"type": "bar", "categories": list(split.index), "series": [{"name": "TIV (KES m)", "values": [num(v / 1e6) for v in split["sum"]]}], "unit": "KES m", "horizontal": True}))
    else:
        out.append(not_measured("EXP-05", "Region split", "Synthetic", "P2", "The uploaded data has no region column; see the grid clusters under Portfolio and map."))
    tiers = sorted(fm.TIERS, key=lambda tier: fm.DEFAULT_TIER_RP[tier])
    exposed = [float(losses[(losses["tier"] == tier) & (losses["depth_m"] > 0)]["tiv_kes"].sum()) for tier in tiers]
    out.append(metric("EXP-06", "Exposed TIV per tier", "Model", "P1", num(exposed[-1]), f"{kes(exposed[-1])} ({pct(exposed[-1] / total)}) wet at 1 in 250",
                      chart={"type": "bar", "categories": [rp_label(fm.DEFAULT_TIER_RP[t]) for t in tiers], "series": [{"name": "Exposed TIV (KES m)", "values": [num(v / 1e6) for v in exposed]}], "unit": "KES m", "palette": "ordinal"}))
    top10 = float(tiv.nlargest(10).sum() / total)
    class_shares = frame.groupby("housing_class")["tiv_kes"].sum() / total
    hhi = float((class_shares ** 2).sum())
    xs, ys = _lorenz(list(tiv))
    out.append(metric("EXP-07", "Concentration", "Model", "P2", num(top10), f"top 10 hold {pct(top10)} of TIV · HHI (class) {hhi:.2f}",
                      note="HHI is across housing classes because the data has no regions.",
                      chart={"type": "line", "x": xs, "series": [{"name": "cumulative % of TIV", "values": ys}], "unit": "%", "xLabel": "% of properties (largest first)", "yLabel": "% of TIV"}))
    local = result["local_accumulation"].sort_values("tiv_local_kes", ascending=False)
    top = local.head(10)
    out.append(metric("EXP-08", "Local accumulation", "Model", "P1", num(local["tiv_local_kes"].max()), f"max {kes(local['tiv_local_kes'].max())} within 500 m",
                      table={"columns": ["Property", "Properties within 500 m", "TIV within 500 m"], "rows": [[row.loc_id, int(row.properties_within_radius), kes(row.tiv_local_kes)] for row in top.itertuples()]}))
    synthetic = sum(1 for prop in props if prop.source_tag == "synthetic") / len(props) if props else None
    out.append(metric("EXP-09", "Synthetic share", "Synthetic", "P1", num(synthetic), pct(synthetic), status="pass" if synthetic == 1 else "warn"))
    per_m2 = frame.assign(v=frame["tiv_kes"] / frame["floor_area_m2"])
    out.append(metric("EXP-10", "Value per m²", "Synthetic", "P3", None, "by class",
                      table={"columns": ["Class", "min", "p25", "median", "p75", "max"], "rows": [[cls, *[kes(per_m2.loc[per_m2["housing_class"] == cls, "v"].quantile(q)) for q in (0, 0.25, 0.5, 0.75, 1)]] for cls in classes if (per_m2["housing_class"] == cls).any()]}))
    return out


def _financial(frame: pd.DataFrame, result: dict, run: ModelRun) -> list[dict]:
    losses = result["losses"]
    tier_losses = result["tier_losses"]
    total = float(frame["tiv_kes"].sum())
    curve = result["ep_curve"]
    aal = result["aal"]
    l10, l100, l250 = (fm.interpolate_loss(curve, rp) for rp in (10, 100, 250))
    labels = [rp_label(rp) for rp in tier_losses["rp"]]
    out = [metric("FIN-01", "Ground-up loss per tier", "Model", "P1", num(l100), f"1 in 10: {kes(l10)} · 1 in 100: {kes(l100)} · 1 in 250: {kes(l250)}",
                  plain="Loss in a flood so severe it has about a 1% chance of being exceeded in any year (1 in 100)",
                  chart={"type": "bar", "categories": labels, "series": [{"name": "Loss (KES m)", "values": [num(v / 1e6) for v in tier_losses["loss_kes"]]}], "unit": "KES m", "palette": "ordinal"}),
           metric("FIN-02", "Loss ratio", "Model", "P1", num(l100 / total), f"{pct(l100 / total)} at 1 in 100",
                  plain="Share of the portfolio's value lost in this event",
                  chart={"type": "bar", "categories": labels, "series": [{"name": "Loss ratio %", "values": [num(v * 100) for v in tier_losses["loss_ratio"]]}], "unit": "%", "palette": "ordinal"})]
    tiers = list(tier_losses["tier"])
    affected = [int(((losses["tier"] == tier) & (losses["depth_m"] > 0)).sum()) for tier in tiers]
    heavy = [int(((losses["tier"] == tier) & (losses["damage_ratio"] > 0.10)).sum()) for tier in tiers]
    out.append(metric("FIN-03", "Affected properties", "Model", "P2", affected[-1], f"{affected[-1]} wet at 1 in 250",
                      chart={"type": "bar", "categories": labels, "series": [{"name": "depth > 0", "values": affected}, {"name": "damage > 10%", "values": heavy}], "unit": "properties"}))
    out.append(metric("FIN-04", "EP curve", "Model + Assumed", "P1", num(l100), "loss vs return period",
                      note="Anchored at RP 1 = 0, interpolated linearly in ln(RP), held flat beyond 250 years.",
                      chart={"type": "line", "x": [num(v) for v in curve["rp"]], "series": [{"name": "Loss (KES m)", "values": [num(v / 1e6) for v in curve["loss_kes"]]}], "unit": "KES m", "xLabel": "Return period (years, log scale)", "yLabel": "Loss (KES m)", "logX": True}))
    out.append(metric("FIN-05", "AAL range", "Model + Assumed", "P1", num(aal["aal_central"]), f"{kes(aal['aal_low'])} – {kes(aal['aal_high'])} (central {kes(aal['aal_central'])})",
                      plain="Average yearly flood cost over the long run (shown as a range)",
                      chart={"type": "bar", "categories": ["low", "central", "high"], "series": [{"name": "AAL (KES m)", "values": [num(aal[k] / 1e6) for k in ("aal_low", "aal_central", "aal_high")]}], "unit": "KES m"},
                      data={"low": num(aal["aal_low"]), "central": num(aal["aal_central"]), "high": num(aal["aal_high"])}))
    out.append(metric("FIN-06", "AAL rate", "Model", "P1", num(aal["aal_central"] / total), permille(aal["aal_central"] / total), plain="Average yearly cost as a share of insured value"))
    out.append(metric("FIN-07", "PML view", "Model", "P1", num(l100 / total), f"1 in 100: {pct(l100 / total)} · 1 in 250: {pct(l250 / total)} of TIV"))
    tail = l250 / l100 if l100 else None
    steep = l100 / l10 if l10 else None
    out.append(metric("FIN-08", "Curve shape", "Model", "P3", num(tail), f"tail L250/L100 {tail:.2f} · steepness L100/L10 {steep:.2f}" if tail and steep else (f"tail L250/L100 {tail:.2f} · L10 is 0" if tail else "n/a")))
    by_class = result["loss_by_class"]
    out.append(metric("FIN-09", "Loss by class", "Model", "P1", None, "per tier",
                      chart={"type": "stacked", "categories": labels, "series": [{"name": cls, "values": [num(by_class[(by_class["rp"] == rp) & (by_class["housing_class"] == cls)]["loss_kes"].sum() / 1e6) for rp in tier_losses["rp"]]} for cls in fm.VALID_CLASSES], "unit": "KES m", "palette": "class"}))
    if frame["region"].notna().any():
        merged = losses.merge(frame[["loc_id", "region"]], on="loc_id")
        regions = merged[merged["rp"] == 100].groupby("region")["loss_kes"].sum().sort_values(ascending=False).head(10)
        out.append(metric("FIN-10", "Loss by region", "Model", "P1", len(regions), "1 in 100 by region",
                          chart={"type": "bar", "categories": list(regions.index), "series": [{"name": "Loss (KES m)", "values": [num(v / 1e6) for v in regions]}], "unit": "KES m", "horizontal": True}))
    else:
        out.append(not_measured("FIN-10", "Loss by region", "Model", "P1", "No region column in the data; see grid clusters under Portfolio and map."))
    per_property = [float(loss.loss_100_kes or 0) for loss in LossResult.query.filter_by(model_run_id=run.id)]
    top10 = sum(sorted(per_property, reverse=True)[:10]) / (sum(per_property) or 1) if per_property else None
    out.append(metric("FIN-11", "Loss concentration", "Model", "P2", num(top10), f"top 10 properties: {pct(top10)} of 1 in 100 loss" if top10 is not None else "n/a"))
    out.extend(_insurance_layers(result, labels, total))
    ratio = aal["aal_high"] / aal["aal_low"] if aal["aal_low"] else None
    out.append(metric("FIN-15", "Anchor sensitivity", "Model", "P1", num(ratio), f"AAL high/low = {ratio:.2f}" if ratio else "AAL low is 0", status=None if ratio is None else ("pass" if ratio <= 2 else "warn"),
                      note="Above 2 means the AAL depends heavily on the anchor/tail assumption." if ratio and ratio > 2 else None))
    portfolio = tier_losses.set_index("tier")["loss_kes"]
    building = losses.groupby("tier")["loss_kes"].sum()
    class_sum = by_class.groupby("tier")["loss_kes"].sum()
    ok_building = bool(np.allclose(building.reindex(portfolio.index), portfolio, rtol=1e-6))
    ok_class = bool(np.allclose(class_sum.reindex(portfolio.index), portfolio, rtol=1e-6))
    out.append(metric("FIN-16", "Reconciliation", "Model", "P3", int(ok_building) + int(ok_class), f"{int(ok_building) + int(ok_class)}/2 reconcile", status="pass" if ok_building and ok_class else "fail",
                      table={"columns": ["Check", "Result"], "rows": [["building sum = portfolio (per tier)", "pass" if ok_building else "fail"], ["class sum = portfolio (per tier)", "pass" if ok_class else "fail"]]}))
    ordered = tier_losses.sort_values("rp")["loss_kes"].to_numpy()
    monotone = bool(np.all(np.diff(ordered) >= -1e-6))
    out.append(metric("FIN-17", "Loss monotonicity", "Model", "P1", int(monotone), "pass: loss rises with rarity" if monotone else "fail", status="pass" if monotone else "fail"))
    return out


def _worked_example(losses: pd.DataFrame) -> dict | None:
    """One building followed through every step: the median-loss flooded building at 1 in 100."""
    wet = losses[(losses["rp"] == 100) & (losses["loss_kes"] > 0)].sort_values("loss_kes")
    if wet.empty:
        return None
    loc = wet.iloc[len(wet) // 2]["loc_id"]
    rows = losses[losses["loc_id"] == loc].sort_values("rp")
    first = rows.iloc[0]
    return {"locId": loc, "housingClass": first["housing_class"], "tivKes": num(first["tiv_kes"]),
            "deductibleKes": num(first["deductible_kes"]), "limitKes": num(first["limit_kes"]),
            "steps": [{"rp": int(row.rp), "score": num(row.hazard_score), "depthM": num(row.depth_m), "damageRatio": num(row.damage_ratio),
                       "groundUpKes": num(row.loss_kes), "grossKes": num(row.gross_kes)} for row in rows.itertuples()]}


def _worked_example_metric(losses: pd.DataFrame) -> dict:
    example = _worked_example(losses)
    if example is None:
        return not_measured("FIN-19", "Worked example", "Model + Assumed", "P2", "No building is flooded at 1 in 100.")
    return metric("FIN-19", "Worked example", "Model + Assumed", "P2", example["steps"][-1]["groundUpKes"], f"{example['locId']} ({example['housingClass']}, {kes(example['tivKes'])})",
                  plain="One real building through every step: score → depth → damage ratio → × value → ground-up → gross",
                  table={"columns": ["Flood (assumed RP)", "Score", "Depth", "Damage ratio", "Ground-up", "Gross"],
                         "rows": [[rp_label(step["rp"]), f"{step['score']:.2f}", f"{step['depthM']:.2f} m", pct(step["damageRatio"]), kes(step["groundUpKes"]), kes(step["grossKes"])] for step in example["steps"]]},
                  data=example)


def _insurance_layers(result: dict, labels: list[str], total: float) -> list[dict]:
    """Ground-up -> gross (deductible, limit per building) -> net (quota share, then cat XL), per tier and as EP curves."""
    tiers = result["tier_losses"]
    financial = result["financial"]
    terms = financial["terms"]
    rows = [{"rp": int(row.rp), "groundUpKes": num(row.loss_kes), "ownerKeepsKes": num(row.retained_by_owner_kes), "aboveLimitKes": num(row.above_limit_kes),
             "grossKes": num(row.gross_kes), "quotaShareKes": num(row.quota_share_kes), "catXlKes": num(row.cat_xl_kes), "netKes": num(row.net_kes)}
            for row in tiers.itertuples()]
    at100 = next((row for row in rows if row["rp"] == 100), rows[-1])
    aal = {layer: financial["aal"][layer]["aal_central"] for layer in ("ground_up", "gross", "net")}
    curves = financial["ep_curves"]
    rp_axis = [num(v) for v in curves["ground_up"]["rp"]]
    out = [
        metric("FIN-12", "Gross vs ground-up", "Model + Assumed", "P1", at100["grossKes"], f"1 in 100: ground-up {kes(at100['groundUpKes'])} → gross {kes(at100['grossKes'])}",
               plain="What the insurer owes after each building's deductible and limit",
               note=f"Assumed terms: deductible {pct(terms['deductible_pct_tiv'])} of each building's value; limit {pct(terms['limit_pct_tiv'], 0)} of its value.",
               chart={"type": "bar", "categories": labels, "series": [{"name": "Ground-up", "values": [num(r["groundUpKes"] / 1e6) for r in rows]}, {"name": "Gross", "values": [num(r["grossKes"] / 1e6) for r in rows]}], "unit": "KES m"}),
        metric("FIN-13", "Reinsurance recoveries", "Model + Assumed", "P1", at100["quotaShareKes"] + at100["catXlKes"],
               f"1 in 100: quota share {kes(at100['quotaShareKes'])} · cat XL {kes(at100['catXlKes'])}",
               plain="What reinsurers pay back in each flood",
               note=f"Assumed treaties: {pct(terms['quota_share_ceded'], 0)} quota share applied first; cat excess of loss {kes(terms['cat_xl_limit_kes'])} xs {kes(terms['cat_xl_attachment_kes'])} on the retained share.",
               chart={"type": "stacked", "categories": labels, "series": [{"name": "Quota share", "values": [num(r["quotaShareKes"] / 1e6) for r in rows]}, {"name": "Cat XL", "values": [num(r["catXlKes"] / 1e6) for r in rows]}], "unit": "KES m"}),
        metric("FIN-14", "Gross vs net EP", "Model + Assumed", "P1", at100["netKes"], f"1 in 100: gross {kes(at100['grossKes'])} → net {kes(at100['netKes'])}",
               plain="Loss against rarity before insurance terms, after them, and after reinsurance",
               chart={"type": "line", "x": rp_axis, "series": [{"name": name, "values": [num(v / 1e6) for v in curves[layer]["loss_kes"]]} for layer, name in (("ground_up", "Ground-up"), ("gross", "Gross"), ("net", "Net"))],
                      "unit": "KES m", "xLabel": "Return period (years, log scale)", "yLabel": "Loss (KES m)", "logX": True}),
        metric("FIN-18", "Loss waterfall", "Model + Assumed", "P1", at100["netKes"], f"net {pct(at100['netKes'] / at100['groundUpKes']) if at100['groundUpKes'] else 'n/a'} of ground-up at 1 in 100",
               plain="How each flood's loss is split between owners, insurer and reinsurers",
               table={"columns": ["Flood (assumed RP)", "Ground-up", "Owners keep (deductible)", "Above limit", "Gross", "Quota share", "Cat XL", "Net"],
                      "rows": [[rp_label(r["rp"]), kes(r["groundUpKes"]), kes(r["ownerKeepsKes"]), kes(r["aboveLimitKes"]), kes(r["grossKes"]), kes(r["quotaShareKes"]), kes(r["catXlKes"]), kes(r["netKes"])] for r in rows]},
               data={"tiers": rows}),
        _worked_example_metric(result["losses"]),
        metric("FIN-20", "AAL by layer", "Model + Assumed", "P1", num(aal["net"]), f"ground-up {kes(aal['ground_up'])} · gross {kes(aal['gross'])} · net {kes(aal['net'])}",
               plain="Average yearly cost before terms, after policy terms, and after reinsurance",
               data={key: num(value) for key, value in aal.items()}),
        metric("FIN-21", "Financial assumptions", "Assumed", "P1", None, "tier return periods and insurance terms",
               plain="Every number here is an assumption, not a supplied term",
               table={"columns": ["Assumption", "Value"], "rows": [*[[f"Tier '{tier}' represents", f"1 in {int(rp)} years"] for tier, rp in sorted(result["assumptions"]["tier_rp"].items(), key=lambda item: item[1])],
                                                              ["Deductible per building", f"{pct(terms['deductible_pct_tiv'])} of its value"], ["Limit per building", f"{pct(terms['limit_pct_tiv'], 0)} of its value"],
                                                              ["Quota share ceded", pct(terms["quota_share_ceded"], 0)], ["Cat XL attachment", kes(terms["cat_xl_attachment_kes"])], ["Cat XL limit", kes(terms["cat_xl_limit_kes"])],
                                                              ["Order", "deductible and limit per building, then quota share, then cat XL on the retained share"]]},
               data={"tierRp": result["assumptions"]["tier_rp"], "terms": {key: num(value) for key, value in terms.items()}}),
    ]
    return out


def _ai(portfolio_id: str) -> list[dict]:
    uploads = Upload.query.filter_by(portfolio_id=portfolio_id).all()
    ids = [upload.id for upload in uploads]
    rows = UploadRow.query.filter(UploadRow.upload_id.in_(ids)).all() if ids else []
    row_ids = [row.id for row in rows]
    prov = FieldProvenance.query.filter(FieldProvenance.subject_type == "upload_row", FieldProvenance.subject_id.in_(row_ids)).all() if row_ids else []
    ai_fields = [item for item in prov if item.method in ("ai_mapped", "ai_extracted")]
    out = [not_measured("AI-01", "Extraction accuracy", "AI-derived", "P1", "Needs a human-checked sample of extracted fields.")]
    doc_ids = {upload.id for upload in uploads if upload.extractor in ("pdf", "docx", "text")}
    doc_rows = [row for row in rows if row.upload_id in doc_ids and (row.data or {}).get("sources")]
    ai_doc_rows = [row for row in doc_rows if any(src.get("method") == "ai_extracted" for src in (row.data.get("sources") or {}).values())]
    if ai_doc_rows:
        coverage = float(np.mean([sum(1 for name in REQUIRED_FIELDS if (row.data or {}).get(name) is not None) / len(REQUIRED_FIELDS) for row in ai_doc_rows]))
        out.append(metric("AI-02", "Extraction coverage", "AI-derived", "P2", num(coverage), pct(coverage)))
    else:
        out.append(not_measured("AI-02", "Extraction coverage", "AI-derived", "P2", "No buildings have been extracted from documents by AI yet."))
    out.append(not_measured("AI-03", "Confidence calibration", "AI-derived", "P3", "Needs a human-checked sample to compare confidence with accuracy."))
    if ai_fields:
        pending = sum(1 for item in ai_fields if item.confirmed_at is None)
        edited = sum(1 for item in ai_fields if item.superseded_by)
        out.append(metric("AI-04", "Review burden", "AI-derived", "P2", num(pending / len(ai_fields)), f"{pct(pending / len(ai_fields))} need confirmation · edit rate {pct(edited / len(ai_fields))}"))
    else:
        out.append(metric("AI-04", "Review burden", "AI-derived", "P2", 0, "0 AI values to confirm", note="All values came from exact columns."))
    facts = Counter(fact.upload_id for fact in DocumentFact.query.filter(DocumentFact.upload_id.in_(ids)).all()) if ids else Counter()
    findings = Counter(item.upload_id for item in ValidationIssue.query.filter(ValidationIssue.upload_id.in_(ids), ValidationIssue.upload_row_id.is_(None), ValidationIssue.evidence.isnot(None)).all() if (item.evidence or {}).get("source") == "ai") if ids else Counter()
    doc_uploads = [upload for upload in uploads if upload.extractor in ("pdf", "docx", "text")]
    out.append(metric("AI-05", "Records extracted", "AI-derived", "P2", sum((upload.summary or {}).get("buildings", 0) or 0 for upload in doc_uploads), f"{len(doc_uploads)} documents",
                      table={"columns": ["Document", "Type", "Buildings", "Facts", "AI findings"], "rows": [[upload.filename, (upload.summary or {}).get("documentType") or upload.extractor, (upload.summary or {}).get("buildings") or (upload.summary or {}).get("rows") or 0, facts[upload.id], findings[upload.id]] for upload in doc_uploads]}))
    out.append(not_measured("AI-06", "Hit-rate lift", "AI-derived", "P1", "No AI uplift is applied in this run."))
    out.append(not_measured("AI-07", "Loss impact", "AI-derived", "P1", "No AI-adjusted hazard: base and adjusted losses are identical."))
    out.append(metric("AI-08", "Properties re-rated", "AI-derived", "P2", 0, "0 properties", note="No AI uplift applied."))
    tables = [upload for upload in doc_uploads if (upload.summary or {}).get("documentType") == "data table"]
    if tables:
        out.append(metric("AI-09", "Free-text parse success", "AI-derived", "P2", sum((upload.summary or {}).get("rows", 0) for upload in tables), "rows parsed from tables in documents",
                          table={"columns": ["Document", "Rows parsed", "Lines skipped", "Accepted"], "rows": [[upload.filename, (upload.summary or {}).get("rows"), (upload.summary or {}).get("unparsedLines", 0), (upload.summary or {}).get("promoted")] for upload in tables]}))
    else:
        out.append(not_measured("AI-09", "Free-text parse success", "AI-derived", "P2", "No free-text or document tables have been parsed yet."))
    out.append(not_measured("AI-10", "Briefing check", "AI-derived", "P1", "No generated briefing exists for this run yet."))
    for id_, label, reason in (("AI-11", "Chat grounding", "Chat answers are not logged yet."), ("AI-12", "\"Couldn't find\" rate", "Chat answers are not logged yet."),
                               ("AI-13", "Latency and cache hits", "AI call timings are not logged yet."), ("AI-14", "User feedback", "Answer feedback is not collected yet.")):
        out.append(not_measured(id_, label, "AI-derived" if id_ == "AI-11" else "Model", "P3", reason))
    return out


def _clusters(frame: pd.DataFrame, result: dict, run: ModelRun) -> pd.DataFrame:
    losses = {loss.property_id: loss for loss in LossResult.query.filter_by(model_run_id=run.id)}
    probability = result["flood_probability"].set_index("loc_id")["p_flood"] if len(result["flood_probability"]) else pd.Series(dtype=float)
    data = frame.assign(
        cluster=_cluster_labels(frame),
        l100=frame["loc_id"].map(lambda loc: float(losses[loc].loss_100_kes or 0) if loc in losses else 0.0),
        aal=frame["loc_id"].map(lambda loc: float(losses[loc].aal_kes or 0) if loc in losses else 0.0),
        p=frame["loc_id"].map(lambda loc: float(probability.get(loc, 0.0))),
    )
    grouped = data.groupby("cluster").agg(properties=("loc_id", "count"), tiv=("tiv_kes", "sum"), l100=("l100", "sum"), aal=("aal", "sum"), p=("p", "mean"))
    grouped["share"] = grouped["tiv"] / grouped["tiv"].sum()
    grouped["aal_rate"] = grouped["aal"] / grouped["tiv"]
    for cls in fm.VALID_CLASSES:
        grouped[cls] = data[data["housing_class"] == cls].groupby("cluster")["tiv_kes"].sum().reindex(grouped.index).fillna(0) / grouped["tiv"]
    return grouped.sort_values("l100", ascending=False)


def _portfolio(frame: pd.DataFrame, result: dict, run: ModelRun) -> list[dict]:
    clusters = _clusters(frame, result, run)
    note = "Clusters are 0.05° grid cells (about 5.5 km) because the data has no region column." if frame["region"].isna().all() else None
    top = clusters.head(10)
    out = [metric("PORT-01", "Cluster card", "Model", "P1", len(clusters), f"{len(clusters)} clusters", note=note,
                  table={"columns": ["Cluster", "Properties", "TIV", "% of TIV", "1 in 100 loss", "AAL", "AAL ‰", "Mean flood prob.", "Class mix (informal/semi/masonry)"],
                         "rows": [[name, int(row.properties), kes(row.tiv), pct(row.share), kes(row.l100), kes(row.aal), permille(row.aal_rate), pct(row.p), " / ".join(pct(row[cls], 0) for cls in fm.VALID_CLASSES)] for name, row in top.iterrows()]})]
    flagged = clusters[(clusters["share"] > ACCUMULATION_TIV_SHARE) & (clusters["p"] > ACCUMULATION_PROBABILITY)]
    out.append(metric("PORT-02", "Accumulation flag", "Model", "P1", len(flagged), f"{len(flagged)} clusters flagged", status="pass" if flagged.empty else "warn",
                      plain="Too much value sits in the same flood-prone area",
                      note=f"Flag when a cluster holds more than {ACCUMULATION_TIV_SHARE:.0%} of TIV with mean flood probability above {ACCUMULATION_PROBABILITY:.0%} (defaults; adjustable).",
                      table={"columns": ["Cluster", "% of TIV", "Mean flood prob."], "rows": [[name, pct(row.share), pct(row.p)] for name, row in flagged.iterrows()]} if not flagged.empty else None))
    out.append(metric("PORT-03", "Value-vs-risk quadrant", "Model", "P2", None, "cluster TIV vs flood probability",
                      chart={"type": "scatter", "points": [{"label": name, "x": num(row.p * 100), "y": num(row.tiv / 1e6), "size": num(row.l100 / 1e6)} for name, row in clusters.head(25).iterrows()], "xLabel": "Mean flood probability (%)", "yLabel": "TIV (KES m)", "sizeLabel": "1 in 100 loss (KES m)"}))
    out.append(metric("PORT-04", "Region ranking", "Model", "P1", None, "by 1 in 100 loss", note=note,
                      chart={"type": "bar", "categories": list(top.index), "series": [{"name": "1 in 100 loss (KES m)", "values": [num(v / 1e6) for v in top["l100"]]}], "unit": "KES m", "horizontal": True}))
    aal = sorted(LossResult.query.filter_by(model_run_id=run.id).with_entities(LossResult.aal_kes), key=lambda row: -float(row[0] or 0))
    values = [float(row[0] or 0) for row in aal]
    xs, ys = _lorenz(values)
    riskiest = sum(values[: max(1, len(values) // 10)]) / (sum(values) or 1) if values else None
    out.append(metric("PORT-05", "Cumulative AAL", "Model", "P2", num(riskiest), f"riskiest 10% of properties carry {pct(riskiest)} of AAL" if riskiest is not None else "Not measured yet",
                      note=None if values else "No per-property AAL results are available for this run.",
                      chart={"type": "line", "x": xs, "series": [{"name": "cumulative % of AAL", "values": ys}], "unit": "%", "xLabel": "% of properties (riskiest first)", "yLabel": "% of AAL"} if values else None))
    losses = result["losses"].merge(pd.DataFrame({"loc_id": frame["loc_id"]}), on="loc_id")
    data = frame[["loc_id"]].assign(cluster=_cluster_labels(frame))
    merged = losses.merge(data, on="loc_id")
    heat_clusters = list(top.index[:8])
    rps = sorted(merged["rp"].unique())
    heat = [[num(merged[(merged["cluster"] == name) & (merged["rp"] == rp)]["loss_kes"].sum() / 1e6) for rp in rps] for name in heat_clusters]
    out.append(metric("PORT-06", "Region heat-table", "Model", "P2", None, "cluster × return period loss (KES m)", note=note,
                      chart={"type": "heatmap", "rows": heat_clusters, "cols": [rp_label(rp) for rp in rps], "values": heat, "unit": "KES m"}))
    out.append(metric("PORT-07", "Map modes", "Model", "P1", 6, "Risk · Property count · Insured value · Loss · Loss ratio · Flood probability", note="Available on the Portfolio map."))
    return out


def _cluster_labels(frame: pd.DataFrame) -> pd.Series:
    if frame["region"].notna().any():
        return frame["region"].fillna("unassigned")
    keys = (frame["lat"] / GRID_DEGREES).round().astype(int).astype(str) + "/" + (frame["lon"] / GRID_DEGREES).round().astype(int).astype(str)
    centres = frame.assign(key=keys).groupby("key")[["lat", "lon"]].mean()
    return keys.map(lambda key: f"Grid {centres.loc[key, 'lat']:.2f}, {centres.loc[key, 'lon']:.2f}")


def _sensitivity(frame: pd.DataFrame, base: dict) -> list[tuple[str, float, float, float, float]]:
    """(parameter, L100 low, L100 high, AAL low, AAL high) for each varied assumption."""
    def run(**kwargs):
        result = fm.run_model(frame, **kwargs)
        return fm.interpolate_loss(result["ep_curve"], 100), result["aal"]["aal_central"]
    scaled = lambda factor: {cls: {**params, "dr_max": min(1.0, params["dr_max"] * factor)} for cls, params in fm.DEFAULT_VULN.items()}
    rows = []
    low, high = run(d_max=3.0), run(d_max=5.0)
    rows.append(("D_max 3–5 m", low[0], high[0], low[1], high[1]))
    alt = run(tier_rp=fm.ALTERNATIVE_TIER_RP)
    rows.append(("RP map 2/10/25/100/250", min(alt[0], fm.interpolate_loss(base["ep_curve"], 100)), max(alt[0], fm.interpolate_loss(base["ep_curve"], 100)), min(alt[1], base["aal"]["aal_central"]), max(alt[1], base["aal"]["aal_central"])))
    try:
        low, high = run(vuln_params=scaled(0.8)), run(vuln_params=scaled(1.2))
        rows.append(("Vulnerability ±20%", low[0], high[0], low[1], high[1]))
    except ValueError:
        pass
    aal = base["aal"]
    l100 = fm.interpolate_loss(base["ep_curve"], 100)
    rows.append(("AAL anchor/tail", l100, l100, aal["aal_low"], aal["aal_high"]))
    return rows


def _trust(frame: pd.DataFrame, result: dict, run: ModelRun, stages: dict) -> list[dict]:
    out = []
    uploads = [upload.id for upload in Upload.query.filter_by(portfolio_id=run.portfolio_id)]
    rows = [row.id for row in UploadRow.query.filter(UploadRow.upload_id.in_(uploads))] if uploads else []
    methods = Counter(item.method for item in FieldProvenance.query.filter(FieldProvenance.subject_type == "upload_row", FieldProvenance.subject_id.in_(rows), FieldProvenance.superseded_by.is_(None)).with_entities(FieldProvenance.method)) if rows else Counter()
    tag_of = {"exact": "Synthetic", "user": "Real", "geocoded": "Real", "derived": "Model", "lookup": "Proxy", "ai_mapped": "AI-derived", "ai_extracted": "AI-derived"}
    tags = Counter()
    for method, count in methods.items():
        tags[tag_of.get(method, "Model")] += count
    tags["Assumed"] += 2 + len(fm.TIERS) + len(fm.VALID_CLASSES) * 3  # D_max, wet threshold, RP map, curve parameters
    total = sum(tags.values()) or 1
    order = ["Real", "Proxy", "Assumed", "Synthetic", "AI-derived", "Model"]
    out.append(metric("TRU-01", "Provenance mix", "Model", "P1", None, " · ".join(f"{tag} {tags[tag] / total:.1%}" if tags[tag] / total < 0.01 else f"{tag} {tags[tag] / total:.0%}" for tag in order if tags[tag]),
                      chart={"type": "bar", "categories": [tag for tag in order if tags[tag]], "series": [{"name": "% of inputs", "values": [num(tags[tag] / total * 100) for tag in order if tags[tag]]}], "unit": "%", "horizontal": True}))
    ing05 = next((m for m in stages["ingestion"]["metrics"] if m["id"] == "ING-05"), {})
    open_items = [["Tier-to-return-period mapping", "assumed 10/25/50/100/250"], ["D_max", f"{result['assumptions']['d_max_m']} m"], ["Vulnerability parameters", "adapted, not calibrated"],
                  ["Anchor and tail treatment", "range reported"], ["Hotspot hit threshold and radius", "not fixed"], ["Accumulation thresholds", f"{ACCUMULATION_TIV_SHARE:.0%} TIV, {ACCUMULATION_PROBABILITY:.0%} probability"],
                  ["Policy terms and reinsurance", "out of scope"]]
    if ing05.get("status") == "warn":
        open_items.append(["TIV definition", f"median ratio {ing05.get('display')}"])
    out.append(metric("TRU-02", "Open assumptions", "Assumed", "P1", len(open_items), f"{len(open_items)} open", status="warn",
                      table={"columns": ["Assumption", "Current value"], "rows": open_items}))
    sens = _sensitivity(frame, result)
    base_l100 = fm.interpolate_loss(result["ep_curve"], 100)
    base_aal = result["aal"]["aal_central"]
    out.append(metric("TRU-03", "Sensitivity (tornado)", "Model", "P1", num(max(abs(h - l) for _, l, h, _, _ in sens) / base_l100) if base_l100 else None, f"base 1 in 100 {kes(base_l100)}",
                      chart={"type": "tornado", "params": [row[0] for row in sens], "unit": "KES m", "panels": [
                          {"measure": "1 in 100 loss", "low": [num(row[1] / 1e6) for row in sens], "high": [num(row[2] / 1e6) for row in sens], "base": num(base_l100 / 1e6)},
                          {"measure": "AAL", "low": [num(row[3] / 1e6) for row in sens], "high": [num(row[4] / 1e6) for row in sens], "base": num(base_aal / 1e6)},
                      ]},
                      table={"columns": ["Parameter", "L100 low", "L100 high", "AAL low", "AAL high"], "rows": [[row[0], kes(row[1]), kes(row[2]), kes(row[3]), kes(row[4])] for row in sens]}))
    curve = result["ep_curve"]
    rps = [10, 25, 50, 100, 250]
    variants = [result["ep_curve"]] + [fm.run_model(frame, d_max=d)["ep_curve"] for d in (3.0, 5.0)]
    band = [[fm.interpolate_loss(c, rp) for c in variants] for rp in rps]
    out.append(metric("TRU-04", "Uncertainty band", "Model", "P2", None, "min–max loss across D_max 3–5 m",
                      chart={"type": "line", "x": [rp_label(rp) for rp in rps], "series": [{"name": "min", "values": [num(min(b) / 1e6) for b in band]}, {"name": "base", "values": [num(fm.interpolate_loss(curve, rp) / 1e6) for rp in rps]}, {"name": "max", "values": [num(max(b) / 1e6) for b in band]}], "unit": "KES m", "xLabel": "Return period", "yLabel": "Loss (KES m)"}))
    checks = []
    for stage_key, ids in (("hazard", ["HAZ-03"]), ("vulnerability", ["VUL-04"]), ("financial", ["FIN-16", "FIN-17", "FIN-15"]), ("ingestion", ["ING-05", "ING-07", "ING-11"])):
        for m in stages[stage_key]["metrics"]:
            if m["id"] in ids and m["status"]:
                checks.append([m["id"], m["label"], m["status"]])
    bounds = not any("outside the configured Nairobi bounds" in issue for issue in result["validation_issues"])
    checks.append(["bounds", "Coordinates inside Nairobi bounds", "pass" if bounds else "fail"])
    passed = sum(1 for row in checks if row[2] == "pass")
    out.append(metric("TRU-05", "Model checks", "Model", "P1", passed, f"{passed}/{len(checks)} checks passed", status="pass" if passed == len(checks) else "warn",
                      plain="Automatic tests the model passed on this run", table={"columns": ["Metric", "Check", "Result"], "rows": checks}))
    config_hash = hashlib.sha256(json.dumps(run.configuration or {}, sort_keys=True, default=str).encode()).hexdigest()[:12]
    out.append(metric("TRU-06", "Run identity", "Model", "P3", run.id, f"{run.id} · {run.status}",
                      table={"columns": ["Field", "Value"], "rows": [["Run ID", run.id], ["Status", run.status], ["Started", (run.started_at or run.created_at).isoformat()], ["Config hash", config_hash], ["Hazard mode", "proxy scores, no AI uplift"]]}))
    previous = ModelRun.query.filter(ModelRun.portfolio_id == run.portfolio_id, ModelRun.id != run.id, ModelRun.status.in_(("approved", "superseded", "review"))).order_by(ModelRun.created_at.desc()).first()
    if previous and (previous.configuration or {}).get("summary"):
        a, b = previous.configuration["summary"], (run.configuration or {}).get("summary", {})
        rows_cmp = [["Properties", a.get("propertyCount"), b.get("propertyCount")], ["TIV", kes(a.get("totalTivKes")), kes(b.get("totalTivKes"))], ["Central AAL", kes(a.get("aalKes")), kes(b.get("aalKes"))]]
        out.append(metric("TRU-07", "Run comparison", "Model", "P2", previous.id, f"vs {previous.id} ({previous.status})", table={"columns": ["Metric", previous.id, run.id], "rows": rows_cmp}))
    else:
        out.append(not_measured("TRU-07", "Run comparison", "Model", "P2", "No earlier run to compare with."))
    out.append(metric("TRU-08", "Known limitations", "Real", "P1", len(LIMITATIONS), f"{len(LIMITATIONS)} limitations", table={"columns": ["Limitation"], "rows": [[item] for item in LIMITATIONS]}))
    return out


def compute(run: ModelRun) -> dict:
    stamp = db.session.query(db.func.max(Property.updated_at)).filter(Property.portfolio_id == run.portfolio_id).scalar()
    key = f"{run.id}:{run.status}:{stamp}"
    if key in _CACHE:
        return _CACHE[key]
    props, frame = _run_frame(run)
    if frame.empty:
        raise MetricsError("No modelled properties have complete hazard scores.")
    result = fm.run_model(frame.drop(columns=["region"]))
    stages = {}
    builders = {
        "ingestion": lambda: _ingestion(run.portfolio_id, props),
        "hazard": lambda: _hazard(frame, result),
        "vulnerability": lambda: _vulnerability(frame, result),
        "exposure": lambda: _exposure(frame, result, props),
        "financial": lambda: _financial(frame, result, run),
        "ai": lambda: _ai(run.portfolio_id),
        "portfolio": lambda: _portfolio(frame, result, run),
    }
    for stage_key, build in builders.items():
        title, input_, output, headline = STAGE_INFO[stage_key]
        stages[stage_key] = {"key": stage_key, "title": title, "input": input_, "output": output, "headline": headline, "metrics": build()}
    title, input_, output, headline = STAGE_INFO["trust"]
    stages["trust"] = {"key": "trust", "title": title, "input": input_, "output": output, "headline": headline, "metrics": _trust(frame.drop(columns=["region"]), result, run, stages)}
    payload = {"runId": run.id, "portfolioId": run.portfolio_id, "status": run.status, "propertyCount": len(frame), "stages": stages,
               "note": "Metrics are recalculated from the run's properties with the run's assumptions."}
    _CACHE.clear()
    _CACHE[key] = payload
    return payload


def summary_text(payload: dict, stage_key: str) -> str:
    """Compact text of one stage's metrics, for the chat agent."""
    stage = payload["stages"].get(stage_key)
    if stage is None:
        return ""
    lines = [f"Stage {stage['title']} metrics for run {payload['runId']} ({payload['status']}). Input: {stage['input']}. Output: {stage['output']}."]
    for item in stage["metrics"]:
        line = f"{item['id']} {item['label']} [{item['tag']}, {item['priority']}]: {item['display']}"
        if item.get("status"):
            line += f" (check: {item['status']})"
        if item.get("note"):
            line += f". Note: {item['note']}"
        lines.append(line)
    return "\n".join(lines)
