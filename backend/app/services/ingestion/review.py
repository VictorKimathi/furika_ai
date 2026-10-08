"""Review queue and reviewer decisions on staged upload rows.

- confirm: accept review items that can be accepted as-is (approximate location, far from
  the hazard grid) or confirm a promoted-but-unconfirmed property (low-confidence AI mapping).
- reject: drop the row; if it was the live version of a property, restore the previous
  upload's version or remove the property.
- edit: overlay user values (method=user), re-run the full evaluation, and promote as
  confirmed if the row now passes.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import and_, or_

from ...extensions import db
from ...models import FieldProvenance, Property, Upload, UploadRow, ValidationIssue, new_id
from .pipeline import evaluate_and_record, is_confirmed, promote, row_context
from .validation import CANONICAL_FIELDS, CONFIRMABLE_CODES, PROMOTABLE_STATUSES

EDITABLE_FIELDS = set(CANONICAL_FIELDS) - {"synthetic"}


class ReviewError(ValueError):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.message = message
        self.status = status


def review_queue_query(portfolio_id: str):
    """Rows needing a decision: needs_review rows and rows whose live property is unconfirmed."""
    return (
        UploadRow.query.join(Upload, Upload.id == UploadRow.upload_id)
        .outerjoin(Property, Property.id == UploadRow.property_id)
        .filter(Upload.portfolio_id == portfolio_id)
        .filter(or_(
            UploadRow.status == "needs_review",
            and_(Property.review_status == "unconfirmed", Property.upload_id == UploadRow.upload_id),
        ))
        .order_by(UploadRow.created_at, UploadRow.position)
    )


def queue_reason(row: UploadRow) -> str:
    return "needs_review" if row.status == "needs_review" else "unconfirmed"


def _open_issues(row: UploadRow) -> list[ValidationIssue]:
    return ValidationIssue.query.filter_by(upload_row_id=row.id, resolution=None).all()


def _resolve(issues, resolution: str, now: datetime) -> None:
    for item in issues:
        item.resolution = resolution
        item.resolved_at = now


def _live_property(row: UploadRow) -> Property | None:
    prop = db.session.get(Property, row.property_id) if row.property_id else None
    return prop if prop is not None and prop.upload_id == row.upload_id else None


def _revert_property(prop: Property, row: UploadRow) -> None:
    """Restore the property from its previous accepted row, or delete it if this row created it."""
    previous = (
        UploadRow.query.filter(UploadRow.property_id == prop.id, UploadRow.id != row.id, UploadRow.status.in_(PROMOTABLE_STATUSES))
        .order_by(UploadRow.created_at.desc())
        .first()
    )
    row.property_id = None
    if previous is None:
        db.session.delete(prop)
        return
    promote(db.session.get(Upload, previous.upload_id), previous, previous.data, is_confirmed(previous.data) or previous.reviewed_at is not None, prop)


def decide(row_id: str, action: str, fields: dict | None = None, comment: str | None = None) -> UploadRow:
    row = db.session.get(UploadRow, row_id)
    if row is None:
        raise ReviewError(f"Upload row {row_id} was not found.", 404)
    upload = db.session.get(Upload, row.upload_id)
    now = datetime.now(UTC)

    if action == "confirm":
        _confirm(row, upload, now)
    elif action == "reject":
        _reject(row, now)
    elif action == "edit":
        _edit(row, upload, fields or {}, now)
    else:
        raise ReviewError("action must be confirm, reject, or edit.", 400)

    row.reviewed_at = now
    row.review_comment = comment
    db.session.commit()
    return row


def _confirm(row: UploadRow, upload: Upload, now: datetime) -> None:
    if row.status == "rejected":
        raise ReviewError("Rejected rows must be edited to fix their errors before they can be confirmed.")
    issues = _open_issues(row)
    blocking = sorted({item.code for item in issues if item.severity == "review" and item.code not in CONFIRMABLE_CODES})
    if blocking:
        raise ReviewError(f"Edit the row to resolve: {', '.join(blocking)}.")

    if row.status == "needs_review":
        current = db.session.get(Property, row.data["loc_id"])
        if current is not None and current.portfolio_id != upload.portfolio_id:
            raise ReviewError(f"loc_id {row.data['loc_id']} already belongs to portfolio {current.portfolio_id}.")
        _resolve([item for item in issues if item.severity == "review"], "confirmed", now)
        row.status = "accepted_with_warnings"
        promote(upload, row, row.data, True, current)
    else:
        prop = _live_property(row)
        if prop is None or prop.review_status == "confirmed":
            raise ReviewError("Nothing to confirm: the row is not awaiting review.")
        prop.review_status = "confirmed"

    for record in FieldProvenance.query.filter_by(subject_type="upload_row", subject_id=row.id, superseded_by=None):
        record.confirmed_at = now


def _reject(row: UploadRow, now: datetime) -> None:
    if row.status == "rejected" and row.reviewed_at is not None:
        raise ReviewError("The row has already been rejected.")
    _resolve(_open_issues(row), "rejected", now)
    row.status = "rejected"
    prop = _live_property(row)
    if prop is not None:
        _revert_property(prop, row)


def _edit(row: UploadRow, upload: Upload, fields: dict, now: datetime) -> None:
    if not fields:
        raise ReviewError("fields must contain at least one value to change.", 400)
    unknown = sorted(set(fields) - EDITABLE_FIELDS)
    if unknown:
        raise ReviewError(f"Unknown or read-only field(s): {', '.join(unknown)}.", 400)
    live = _live_property(row)
    if "loc_id" in fields and live is not None and str(fields["loc_id"]).strip() != row.data.get("loc_id"):
        raise ReviewError("loc_id cannot change once the row is a property; reject it and upload a corrected row.", 400)

    raw = dict(row.data.get("raw", {}))
    sources = dict(row.data.get("sources", {}))
    for name, value in fields.items():
        text = None if value is None else str(value).strip() or None
        raw[name] = text
        if text is None:
            sources.pop(name, None)
        else:
            sources[name] = {"method": "user", "confidence": 1.0}

    revision = new_id()
    _resolve(_open_issues(row), "superseded", now)
    for record in FieldProvenance.query.filter_by(subject_type="upload_row", subject_id=row.id, superseded_by=None):
        record.superseded_by = revision

    loc_id = raw.get("loc_id")
    current = db.session.get(Property, loc_id) if loc_id else None
    existing = {loc_id: current} if current is not None else {}
    seen = {
        other.data.get("loc_id")
        for other in UploadRow.query.filter(UploadRow.upload_id == upload.id, UploadRow.id != row.id, UploadRow.status != "rejected")
    } - {None}
    data, _ = evaluate_and_record(upload, row, raw, sources, row.data.get("extra", {}), row_context(), existing, seen)

    if row.status in PROMOTABLE_STATUSES:
        promote(upload, row, data, True, existing.get(data["loc_id"]))
    elif live is not None:
        _revert_property(live, row)
