"""Load reference data: the scored hazard grid and named flood hotspots."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pandas as pd

from ..extensions import db
from ..models import HazardReferencePoint, Hotspot, Property, Upload, UploadRow
from . import furika_model as fm
from .ingestion.enrichment import ReferenceData
from .ingestion.validation import PROMOTABLE_STATUSES, has_hazard_scores, parse_number


def load_reference_points(upload: Upload) -> int:
    """Use the upload's accepted rows with supplied scores as the hazard grid. Returns rows added."""
    existing = {point_id for (point_id,) in db.session.query(HazardReferencePoint.id)}
    added = 0
    for row in UploadRow.query.filter(UploadRow.upload_id == upload.id, UploadRow.status.in_(PROMOTABLE_STATUSES)):
        data = row.data
        if data.get("hazard", {}).get("source") != "supplied" or not has_hazard_scores(data) or data["loc_id"] in existing:
            continue
        db.session.add(HazardReferencePoint(
            id=data["loc_id"], latitude=data["lat"], longitude=data["lon"],
            scores={tier: data[f"hazard_score_{tier}"] for tier in fm.TIERS},
            housing_class=data["housing_class"], cost_per_m2_kes=data["cost_per_m2_kes"], source_upload_id=upload.id,
        ))
        added += 1
    db.session.commit()
    return added


def load_hotspots(path: Path) -> tuple[int, list[str]]:
    """Replace all hotspots with the file's rows (name, lat, lon, optional severity/weight). Returns (count, skipped notes)."""
    content = path.read_bytes()
    frame = pd.read_csv(path, dtype=str, keep_default_na=False)
    frame.columns = [column.strip().lower() for column in frame.columns]
    missing = {"name", "lat", "lon"} - set(frame.columns)
    if missing:
        raise ValueError(f"Hotspot file is missing column(s): {', '.join(sorted(missing))}.")
    bounds = fm.NAIROBI_BOUNDS
    hotspots, skipped = [], []
    for position, record in enumerate(frame.to_dict(orient="records"), start=2):
        try:
            lat, lon = parse_number(record["lat"]), parse_number(record["lon"])
        except ValueError:
            skipped.append(f"row {position}: non-numeric coordinates")
            continue
        if not (bounds["lat_min"] <= lat <= bounds["lat_max"] and bounds["lon_min"] <= lon <= bounds["lon_max"]):
            skipped.append(f"row {position}: outside Nairobi bounds")
            continue
        weight = record.get("weight") or None
        hotspots.append(Hotspot(
            name=record["name"].strip()[:160] or f"Hotspot {position}", latitude=lat, longitude=lon,
            severity=(record.get("severity") or "").strip().lower() or None, weight=float(weight) if weight else None,
            source_sha256=hashlib.sha256(content).hexdigest(),
        ))
    Hotspot.query.delete()
    db.session.add_all(hotspots)
    db.session.commit()
    return len(hotspots), skipped


def refresh_hotspot_distances() -> int:
    """Recompute nearby hotspots for every property after the hotspot list changes."""
    reference = ReferenceData.load()
    updated = 0
    for prop in Property.query:
        near, nearest_km = reference.hotspots_near(float(prop.latitude), float(prop.longitude))
        attributes = dict(prop.attributes or {})
        attributes["nearby_hotspots"] = near
        prop.attributes = attributes
        prop.nearest_hotspot_km = nearest_km
        updated += 1
    db.session.commit()
    return updated
