"""Decision records: who took or declined which risk, when, and on what evidence. Kept on the server, not in the browser chat."""

from __future__ import annotations

from ..extensions import db
from ..models import DecisionRecord

ACTIONS = ("approve", "send_back")
SUBJECT_TYPES = ("offer", "model_run")


class DecisionError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def serialize(record: DecisionRecord) -> dict:
    return {"id": record.id, "portfolioId": record.portfolio_id, "subjectType": record.subject_type, "subjectRef": record.subject_ref,
            "subjectLabel": record.subject_label, "action": record.action, "snapshot": record.snapshot, "comment": record.comment,
            "decidedBy": record.decided_by, "decidedAt": record.created_at.isoformat()}


def record(*, subject_type: str, subject_ref: str, subject_label: str, action: str, decided_by: str,
           snapshot: dict | None = None, comment: str | None = None, portfolio_id: str | None = None, commit: bool = True) -> DecisionRecord:
    if subject_type not in SUBJECT_TYPES:
        raise DecisionError(f"subjectType must be one of {', '.join(SUBJECT_TYPES)}.")
    if action not in ACTIONS:
        raise DecisionError(f"action must be one of {', '.join(ACTIONS)}.")
    if not subject_ref or not subject_label:
        raise DecisionError("subjectRef and subjectLabel are required.")
    entry = DecisionRecord(subject_type=subject_type, subject_ref=subject_ref[:80], subject_label=subject_label[:255], action=action,
                           snapshot=snapshot or {}, comment=comment, decided_by=decided_by[:160], portfolio_id=portfolio_id)
    db.session.add(entry)
    if commit:
        db.session.commit()
    return entry


def history(subject_ref: str) -> list[DecisionRecord]:
    return DecisionRecord.query.filter_by(subject_ref=subject_ref).order_by(DecisionRecord.created_at.desc()).all()
