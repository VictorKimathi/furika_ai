from collections import Counter, defaultdict

from flask import current_app, request, send_file
from flask_restx import Namespace, Resource, fields, reqparse
from sqlalchemy import or_
from werkzeug.datastructures import FileStorage

from ..extensions import db
from ..models import DocumentFact, FieldProvenance, Upload, UploadRow, ValidationIssue
from ..services.ingestion import IngestionError, receive_upload
from ..services.ingestion.pipeline import storage_root
from ..services.ingestion.pipeline import reprocess_upload
from ..services.ingestion.review import ReviewError, decide, delete_upload, queue_reason, reset_for_reprocess, review_queue_query
from .swagger_models import error_model


ns = Namespace("uploads", description="Uploaded files, staged rows, validation issues, and provenance", path="/uploads")
rows_ns = Namespace("upload-rows", description="Reviewer decisions on staged rows", path="/upload-rows")

decision_request = rows_ns.model("RowDecisionRequest", {
    "action": fields.String(required=True, enum=["confirm", "reject", "edit"]),
    "fields": fields.Raw(description="For edit: canonical field → new value, e.g. {\"lat\": -1.29, \"lon\": 36.82}", example={"housing_class": "permanent_masonry"}),
    "comment": fields.String,
})

upload_parser = reqparse.RequestParser()
upload_parser.add_argument("file", type=FileStorage, location="files", required=True, help="CSV, XLSX, PDF, TXT, or MD file")
upload_parser.add_argument(
    "attestation", type=str, location="form", required=True, choices=("synthetic", "redacted"),
    help="Confirms the file holds only synthetic or redacted data",
)

rows_parser = reqparse.RequestParser()
rows_parser.add_argument("status", type=str, location="args", help="accepted | accepted_with_warnings | needs_review | rejected")
rows_parser.add_argument("limit", type=int, location="args", default=100)
rows_parser.add_argument("offset", type=int, location="args", default=0)


def iso(value):
    return value.isoformat() if value else None


def issue_dict(item: ValidationIssue) -> dict:
    return {
        "id": item.id, "rowId": item.upload_row_id, "code": item.code, "severity": item.severity,
        "field": item.field, "message": item.message, "evidence": item.evidence,
        "resolution": item.resolution, "resolvedAt": iso(item.resolved_at),
    }


def provenance_dict(item: FieldProvenance) -> dict:
    return {
        "field": item.field, "value": item.value, "rawValue": item.raw_value, "method": item.method,
        "confidence": item.confidence, "sourceUploadId": item.source_upload_id, "sourceColumn": item.source_column,
        "page": item.page, "quote": item.quote, "kind": item.kind,
        "confirmedBy": item.confirmed_by, "confirmedAt": iso(item.confirmed_at),
    }


def upload_dict(upload: Upload) -> dict:
    severities = Counter(severity for (severity,) in ValidationIssue.query.with_entities(ValidationIssue.severity).filter_by(upload_id=upload.id))
    return {
        "id": upload.id, "portfolioId": upload.portfolio_id, "filename": upload.filename, "mediaType": upload.media_type,
        "sizeBytes": upload.size_bytes, "sha256": upload.sha256, "status": upload.status, "attestation": upload.attestation,
        "extractor": upload.extractor, "summary": upload.summary, "error": upload.error,
        "issueCounts": dict(severities), "factCount": DocumentFact.query.filter_by(upload_id=upload.id).count(),
        "createdAt": iso(upload.created_at),
    }


def row_provenance(row_ids: list[str]) -> dict[str, list[dict]]:
    grouped = defaultdict(list)
    if row_ids:
        for item in FieldProvenance.query.filter(FieldProvenance.subject_type == "upload_row", FieldProvenance.subject_id.in_(row_ids), FieldProvenance.superseded_by.is_(None)):
            grouped[item.subject_id].append(provenance_dict(item))
    return grouped


def rows_payload(rows: list[UploadRow]) -> list[dict]:
    """Rows with their current (non-superseded) issues and provenance."""
    row_ids = [row.id for row in rows]
    issues = defaultdict(list)
    if row_ids:
        current = or_(ValidationIssue.resolution.is_(None), ValidationIssue.resolution != "superseded")
        for item in ValidationIssue.query.filter(ValidationIssue.upload_row_id.in_(row_ids), current).order_by(ValidationIssue.created_at):
            issues[item.upload_row_id].append(issue_dict(item))
    provenance = row_provenance(row_ids)
    return [{
        "id": row.id, "uploadId": row.upload_id, "rowRef": row.row_ref, "position": row.position, "status": row.status,
        "propertyId": row.property_id, "data": row.data, "issues": issues[row.id], "provenance": provenance[row.id],
        "reviewedAt": iso(row.reviewed_at), "reviewComment": row.review_comment,
    } for row in rows]


def portfolio_review_queue(portfolio_id: str, limit: int, offset: int) -> dict:
    query = review_queue_query(portfolio_id)
    total = query.count()
    rows = query.offset(max(offset, 0)).limit(min(max(limit, 1), 500)).all()
    items = [item | {"reason": queue_reason(row)} for item, row in zip(rows_payload(rows), rows)]
    return {"items": items, "total": total}


def create_portfolio_upload(portfolio_id: str):
    args = upload_parser.parse_args()
    try:
        upload, created = receive_upload(portfolio_id, args["file"], args["attestation"])
    except IngestionError as exc:
        return {"error": exc.code, "message": exc.message}, exc.status
    return upload_dict(upload) | {"duplicate": not created}, 201 if created else 200


def list_portfolio_uploads(portfolio_id: str) -> dict:
    uploads = Upload.query.filter_by(portfolio_id=portfolio_id).order_by(Upload.created_at.desc()).all()
    return {"items": [upload_dict(upload) for upload in uploads], "total": len(uploads)}


def get_upload_or_404(upload_id: str) -> Upload:
    upload = db.session.get(Upload, upload_id)
    if upload is None:
        ns.abort(404, f"Upload {upload_id} was not found.")
    return upload


@ns.route("/<string:upload_id>")
class UploadResource(Resource):
    @ns.response(404, "Upload not found", error_model)
    def get(self, upload_id):
        """Return the upload manifest, status, mapping summary, and issue counts."""
        return upload_dict(get_upload_or_404(upload_id))

    @ns.response(204, "Upload deleted")
    @ns.response(404, "Upload not found", error_model)
    @ns.response(409, "Upload is still processing", error_model)
    def delete(self, upload_id):
        """Delete an upload, its rows, issues, facts and stored file. Properties it last wrote revert to their previous version or are removed."""
        upload = get_upload_or_404(upload_id)
        if upload.status in ("queued", "extracting", "validating"):
            return {"error": "processing", "message": "The upload is still being processed; try again when it finishes."}, 409
        try:
            delete_upload(upload_id, storage_root())
        except ReviewError as exc:
            return {"error": "delete_failed", "message": exc.message}, exc.status
        return "", 204


@ns.route("/<string:upload_id>/reprocess")
class UploadReprocessResource(Resource):
    @ns.response(202, "Reprocessing started")
    @ns.response(404, "Upload not found", error_model)
    @ns.response(409, "Upload is still processing", error_model)
    def post(self, upload_id):
        """Parse the stored original again (for example after the Claude key was added). Derived rows, issues and facts are rebuilt."""
        upload = get_upload_or_404(upload_id)
        if upload.status in ("queued", "extracting", "validating"):
            return {"error": "processing", "message": "The upload is already being processed."}, 409
        upload = reset_for_reprocess(upload_id)
        return upload_dict(reprocess_upload(upload)), 202


@ns.route("/<string:upload_id>/facts")
class UploadFactsResource(Resource):
    @ns.response(404, "Upload not found", error_model)
    def get(self, upload_id):
        """Document-level facts, terms, claims and opinions extracted from a document, each with its quote and page."""
        get_upload_or_404(upload_id)
        facts = DocumentFact.query.filter_by(upload_id=upload_id).order_by(DocumentFact.page, DocumentFact.key).all()
        return {"items": [{
            "id": fact.id, "key": fact.key, "label": fact.label, "value": fact.value, "kind": fact.kind,
            "page": fact.page, "quote": fact.quote, "confidence": fact.confidence, "verified": fact.verified,
        } for fact in facts], "total": len(facts)}


@ns.route("/<string:upload_id>/rows")
class UploadRowsResource(Resource):
    @ns.expect(rows_parser)
    @ns.response(404, "Upload not found", error_model)
    def get(self, upload_id):
        """Return staged rows with their issues and field-by-field provenance."""
        get_upload_or_404(upload_id)
        args = rows_parser.parse_args()
        query = UploadRow.query.filter_by(upload_id=upload_id)
        if args["status"]:
            query = query.filter_by(status=args["status"])
        total = query.count()
        rows = query.order_by(UploadRow.position).offset(max(args["offset"], 0)).limit(min(max(args["limit"], 1), 500)).all()
        return {"items": rows_payload(rows), "total": total}


@ns.route("/<string:upload_id>/issues")
class UploadIssuesResource(Resource):
    @ns.response(404, "Upload not found", error_model)
    def get(self, upload_id):
        """Return every validation issue for the upload, including file-level issues."""
        get_upload_or_404(upload_id)
        items = ValidationIssue.query.filter_by(upload_id=upload_id).order_by(ValidationIssue.created_at).all()
        return {"items": [issue_dict(item) for item in items], "total": len(items)}


@ns.route("/<string:upload_id>/original")
class UploadOriginalResource(Resource):
    @ns.response(404, "Upload not found", error_model)
    def get(self, upload_id):
        """Download the untouched original file."""
        upload = get_upload_or_404(upload_id)
        path = storage_root() / upload.storage_path
        if not path.is_file():
            current_app.logger.error("Stored original missing for upload %s at %s", upload.id, path)
            ns.abort(404, "The stored original file is missing.")
        return send_file(path, mimetype=upload.media_type, as_attachment=True, download_name=upload.filename)


@rows_ns.route("/<string:row_id>/decision")
class RowDecisionResource(Resource):
    @rows_ns.expect(decision_request, validate=True)
    @rows_ns.response(404, "Row not found", error_model)
    @rows_ns.response(409, "Decision not allowed in the row's current state", error_model)
    def post(self, row_id):
        """Confirm, reject, or edit a staged row. Edits re-run validation and enrichment."""
        payload = request.get_json()
        if payload.get("fields") is not None and not isinstance(payload["fields"], dict):
            return {"error": "invalid_fields", "message": "fields must be an object."}, 400
        try:
            row = decide(row_id, payload["action"], payload.get("fields"), payload.get("comment"))
        except ReviewError as exc:
            return {"error": "review_error", "message": exc.message}, exc.status
        return rows_payload([row])[0]
