"""Upload pipeline: store → extract → map → validate → promote.

Processing runs inside the request. `Upload.status` records progress so the work can
move to a background worker later without changing the API.
"""

from __future__ import annotations

import logging
import re
import shutil
from collections import Counter
from pathlib import Path

from flask import current_app

from ...extensions import db
from ...models import FieldProvenance, Portfolio, Property, Upload, UploadRow, ValidationIssue, new_id
from .. import gemini, geocoding
from .enrichment import ReferenceData, RowContext, evaluate_row
from .extract import cell, column_samples, read_table
from .mapping import map_columns
from .storage import StorageError, detect_extractor, save_stream
from .validation import CANONICAL_FIELDS, HAZARD_FIELDS, PROMOTABLE_STATUSES, issue, row_status

logger = logging.getLogger(__name__)

ATTESTATIONS = ("synthetic", "redacted")
TABLE_EXTRACTORS = ("csv", "excel")
CONFIRMED_METHODS = {"exact", "user", "derived", "geocoded", "lookup"}
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")


class IngestionError(ValueError):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def storage_root() -> Path:
    return Path(current_app.config["STORAGE_ROOT"])


def receive_upload(portfolio_id: str, file_storage, attestation: str) -> tuple[Upload, bool]:
    """Store the original and process it. Returns (upload, created); created is False for a duplicate."""
    if not SAFE_ID.match(portfolio_id or ""):
        raise IngestionError("invalid_portfolio", "Portfolio IDs may contain letters, digits, '.', '_' and '-' only.")
    if attestation not in ATTESTATIONS:
        raise IngestionError("attestation_required", "Confirm the file contains only synthetic or redacted data.")
    filename = Path(file_storage.filename or "").name[:255]
    if not filename:
        raise IngestionError("missing_file", "A file is required.")

    root = storage_root()
    try:
        tmp_path, sha256, size, head = save_stream(file_storage.stream, root / "tmp", current_app.config["UPLOAD_MAX_BYTES"])
    except StorageError as exc:
        raise IngestionError(exc.code, exc.message, 413 if exc.code == "too_large" else 400) from exc

    try:
        if size == 0:
            raise IngestionError("empty_file", "The file is empty.")
        try:
            extractor = detect_extractor(filename, head)
        except StorageError as exc:
            raise IngestionError(exc.code, exc.message) from exc

        existing = Upload.query.filter_by(portfolio_id=portfolio_id, sha256=sha256).first()
        if existing is not None:
            return existing, False

        if db.session.get(Portfolio, portfolio_id) is None:
            db.session.add(Portfolio(id=portfolio_id, name=portfolio_id, status="draft", metadata_json={}))

        upload = Upload(
            id=new_id(), portfolio_id=portfolio_id, filename=filename, media_type=file_storage.mimetype,
            size_bytes=size, sha256=sha256, attestation=attestation, extractor=extractor, status="received", summary={},
        )
        destination = root / "portfolios" / portfolio_id / "uploads" / upload.id / f"original{Path(filename).suffix.lower()}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(tmp_path, destination)
        destination.chmod(0o444)
        upload.storage_path = str(destination.relative_to(root))
        db.session.add(upload)
        db.session.commit()
    finally:
        tmp_path.unlink(missing_ok=True)

    process_upload(upload)
    return upload, True


def process_upload(upload: Upload) -> None:
    try:
        _process(upload)
        db.session.commit()
    except Exception as exc:
        logger.exception("Processing upload %s failed", upload.id)
        db.session.rollback()
        upload.status = "failed"
        upload.error = str(exc)[:2000]
        db.session.commit()


def _file_issue(upload: Upload, item: dict) -> None:
    db.session.add(ValidationIssue(upload_id=upload.id, **item))


def _process(upload: Upload) -> None:
    if upload.extractor not in TABLE_EXTRACTORS:
        upload.status = "pending_extractor"
        upload.summary = {"note": "The original is stored. Extraction for this file type is not available yet."}
        return

    upload.status = "extracting"
    try:
        frame, sheet = read_table(storage_root() / upload.storage_path, upload.extractor)
    except Exception as exc:
        _file_issue(upload, issue("unreadable", "error", f"The file could not be read as a table: {exc}"))
        upload.status = "rejected"
        return
    if frame.empty or not len(frame.columns):
        _file_issue(upload, issue("empty_file", "error", "The file has no data rows."))
        upload.status = "rejected"
        return

    frame.columns = [str(column) for column in frame.columns]
    columns = list(frame.columns)
    mapping, notes = map_columns(columns, column_samples(frame), gemini.get_llm())
    for note in notes:
        _file_issue(upload, note)
    mapped_columns = {entry["column"] for entry in mapping.values()}
    extra_columns = [column for column in columns if column not in mapped_columns]

    upload.status = "validating"
    records = [{column: cell(value) for column, value in row.items()} for row in frame.to_dict(orient="records")]
    loc_ids = {record[mapping["loc_id"]["column"]] for record in records} - {None} if "loc_id" in mapping else set()
    existing = {item.id: item for item in Property.query.filter(Property.id.in_(loc_ids))} if loc_ids else {}
    ctx = row_context()

    seen: set[str] = set()
    seen_locations: dict[tuple, str] = {}
    counts: Counter = Counter()
    for position, record in enumerate(records):
        raw = {name: record[entry["column"]] for name, entry in mapping.items()}
        sources = {
            name: {"method": entry["method"], "source_column": entry["column"], "confidence": entry["confidence"]}
            for name, entry in mapping.items() if raw[name] is not None
        }
        row_ref = f"{sheet} row {position + 2}" if sheet else f"row {position + 2}"
        row = UploadRow(id=new_id(), upload_id=upload.id, row_ref=row_ref, position=position, data={}, status="received")
        db.session.add(row)
        extra = {column: record[column] for column in extra_columns if record[column] is not None}
        data, issues = evaluate_and_record(upload, row, raw, sources, extra, ctx, existing, seen)

        if row.status != "rejected" and data["lat"] is not None and data["lon"] is not None:
            location = (round(data["lat"], 6), round(data["lon"], 6))
            if location in seen_locations:
                duplicate = issue("duplicate_location", "warning", f"Same coordinates as {seen_locations[location]} in this file.", "lat", {"otherLocId": seen_locations[location]})
                db.session.add(ValidationIssue(upload_id=upload.id, upload_row_id=row.id, **duplicate))
                if row.status == "accepted":
                    row.status = "accepted_with_warnings"
            elif data["loc_id"]:
                seen_locations[location] = data["loc_id"]

        if row.status in PROMOTABLE_STATUSES:
            promote(upload, row, data, is_confirmed(data), existing.get(data["loc_id"]))
        counts[row.status] += 1

    upload.summary = {
        "rows": len(records),
        "byStatus": dict(counts),
        "promoted": counts["accepted"] + counts["accepted_with_warnings"],
        "sheet": sheet,
        "mapping": mapping,
        "unmappedColumns": extra_columns,
        "unmappedFields": [name for name in CANONICAL_FIELDS if name not in mapping],
    }
    upload.status = "done"


def row_context() -> RowContext:
    return RowContext(reference=ReferenceData.load(), geocoder=geocoding.get_geocoder())


def evaluate_and_record(upload, row, raw, sources, extra, ctx, existing, seen) -> tuple[dict, list[dict]]:
    """Evaluate one row, then write its data, status, issues and provenance. `seen` tracks loc_ids in this batch."""
    data, issues, filled = evaluate_row(raw, ctx)
    data.update(raw=raw, sources=sources, extra=extra)

    loc_id = data["loc_id"]
    current = existing.get(loc_id)
    if loc_id in seen:
        issues.append(issue("duplicate_loc_id", "error", f"loc_id {loc_id} appears more than once in this file.", "loc_id"))
    elif current is not None and current.portfolio_id != upload.portfolio_id:
        issues.append(issue("loc_id_conflict", "error", f"loc_id {loc_id} already belongs to portfolio {current.portfolio_id}.", "loc_id"))
    elif current is not None:
        issues.append(issue("updates_existing", "info", f"This row updates existing property {loc_id}.", "loc_id"))
    if loc_id:
        seen.add(loc_id)

    data["provenanceMethods"] = {
        name: {"method": entry["method"], "confidence": entry.get("confidence", 1.0)}
        for name, entry in {**filled, **sources}.items()
    }
    row.data = data
    row.status = row_status(issues)
    for item in issues:
        db.session.add(ValidationIssue(upload_id=upload.id, upload_row_id=row.id, **item))
    db.session.add_all(build_provenance(upload, row, data, sources, filled))
    return data, issues


def build_provenance(upload, row, data, sources, filled) -> list[FieldProvenance]:
    records = []
    for name in CANONICAL_FIELDS:
        if name in sources:
            entry = sources[name]
            records.append(FieldProvenance(
                subject_type="upload_row", subject_id=row.id, field=name, value=data.get(name), raw_value=data["raw"].get(name),
                method=entry["method"], confidence=entry.get("confidence", 1.0), source_upload_id=upload.id, source_column=entry.get("source_column"),
            ))
        elif name in filled:
            entry = filled[name]
            records.append(FieldProvenance(
                subject_type="upload_row", subject_id=row.id, field=name, value=data.get(name), raw_value=entry.get("raw_value"),
                method=entry["method"], confidence=entry.get("confidence", 1.0), source_upload_id=upload.id,
                quote=entry.get("quote") or (f"upload attestation: {upload.attestation}" if name == "synthetic" else None),
            ))
    return records


def is_confirmed(data: dict) -> bool:
    threshold = current_app.config["AI_MAPPING_AUTO_CONFIRM"]
    return all(
        entry["method"] in CONFIRMED_METHODS or (entry["method"] == "ai_mapped" and entry["confidence"] >= threshold)
        for entry in data.get("provenanceMethods", {}).values()
    )


def promote(upload: Upload, row: UploadRow, data: dict, confirmed: bool, current: Property | None) -> Property:
    prop = current or Property(id=data["loc_id"], portfolio_id=upload.portfolio_id)
    apply_row_data(prop, data)
    prop.source_tag = upload.attestation
    prop.upload_id = upload.id
    prop.review_status = "confirmed" if confirmed else "unconfirmed"
    if current is None:
        db.session.add(prop)
    row.property_id = prop.id
    return prop


def apply_row_data(prop: Property, data: dict) -> None:
    """Copy evaluated row data onto a property (exposure, location, hazard, hotspots)."""
    hazard_scores = {name.removeprefix("hazard_score_"): data[name] for name in HAZARD_FIELDS if data[name] is not None}
    has_hazard = len(hazard_scores) == len(HAZARD_FIELDS)
    attributes = dict(prop.attributes or {})
    attributes.pop("hazard_scores", None)
    if has_hazard:
        attributes["hazard_scores"] = hazard_scores
    attributes["hazard_lookup"] = data["hazard"] if data["hazard"].get("source") == "interpolated" else None
    attributes["nearby_hotspots"] = data.get("hotspots", [])
    attributes["geocode"] = data.get("geocode")
    attributes["address"] = data.get("address")
    attributes["extra"] = data.get("extra", {})

    prop.name = (data["name"] or data["loc_id"])[:180]
    prop.region = data["region"][:120] if data["region"] else None
    prop.latitude = data["lat"]
    prop.longitude = data["lon"]
    prop.housing_class = data["housing_class"]
    prop.floor_area_m2 = data["floor_area_m2"]
    prop.cost_per_m2_kes = data["cost_per_m2_kes"]
    prop.insured_value_kes = data["tiv_kes"]
    prop.attributes = attributes
    prop.geocode_precision = (data.get("geocode") or {}).get("precision", "supplied")
    prop.hazard_source = data["hazard"]["source"] if has_hazard else "missing"
    prop.nearest_hotspot_km = data.get("nearestHotspotKm")
