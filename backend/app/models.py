import uuid
from datetime import UTC, datetime

from sqlalchemy.dialects.postgresql import JSONB

from .extensions import db


JSONType = db.JSON().with_variant(JSONB, "postgresql")


def new_id() -> str:
    return str(uuid.uuid4())


class TimestampMixin:
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )


class User(TimestampMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    name = db.Column(db.String(160), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(50), nullable=False, default="underwriter")


class Portfolio(TimestampMixin, db.Model):
    __tablename__ = "portfolios"

    id = db.Column(db.String(64), primary_key=True)
    name = db.Column(db.String(180), nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.String(30), nullable=False, default="draft")
    metadata_json = db.Column(JSONType, nullable=False, default=dict)


class Property(TimestampMixin, db.Model):
    __tablename__ = "properties"

    id = db.Column(db.String(64), primary_key=True)
    portfolio_id = db.Column(db.String(64), db.ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False, index=True)
    name = db.Column(db.String(180), nullable=False)
    region = db.Column(db.String(120))
    latitude = db.Column(db.Numeric(10, 7), nullable=False)
    longitude = db.Column(db.Numeric(10, 7), nullable=False)
    housing_class = db.Column(db.String(80))
    floor_area_m2 = db.Column(db.Numeric(14, 2))
    cost_per_m2_kes = db.Column(db.Numeric(16, 2))
    insured_value_kes = db.Column(db.Numeric(18, 2))
    source_tag = db.Column(db.String(30), nullable=False, default="synthetic")
    attributes = db.Column(JSONType, nullable=False, default=dict)
    upload_id = db.Column(db.String(36), db.ForeignKey("uploads.id", ondelete="SET NULL"), nullable=True, index=True)
    review_status = db.Column(db.String(20), nullable=False, default="confirmed")
    geocode_precision = db.Column(db.String(20), nullable=False, default="supplied")
    hazard_source = db.Column(db.String(20), nullable=False, default="supplied")
    nearest_hotspot_km = db.Column(db.Float, index=True)

    portfolio = db.relationship("Portfolio", backref=db.backref("properties", lazy="dynamic"))


class HazardResult(TimestampMixin, db.Model):
    __tablename__ = "hazard_results"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    property_id = db.Column(db.String(64), db.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True)
    model_run_id = db.Column(db.String(64), db.ForeignKey("model_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    hazard_score = db.Column(db.Numeric(7, 6))
    hazard_band = db.Column(db.String(30))
    annual_flood_probability = db.Column(db.Numeric(8, 7))
    tiers = db.Column(JSONType, nullable=False, default=list)
    drivers = db.Column(JSONType, nullable=False, default=dict)
    provenance = db.Column(JSONType, nullable=False, default=list)


class LossResult(TimestampMixin, db.Model):
    __tablename__ = "loss_results"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    property_id = db.Column(db.String(64), db.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True)
    model_run_id = db.Column(db.String(64), db.ForeignKey("model_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    aal_kes = db.Column(db.Numeric(18, 2))
    loss_10_kes = db.Column(db.Numeric(18, 2))
    loss_100_kes = db.Column(db.Numeric(18, 2))
    loss_250_kes = db.Column(db.Numeric(18, 2))
    ep_curve = db.Column(JSONType, nullable=False, default=list)
    assumptions = db.Column(JSONType, nullable=False, default=list)


class Cluster(TimestampMixin, db.Model):
    __tablename__ = "clusters"

    id = db.Column(db.String(64), primary_key=True)
    portfolio_id = db.Column(db.String(64), db.ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False, index=True)
    name = db.Column(db.String(160), nullable=False)
    cluster_type = db.Column(db.String(50), nullable=False)
    metrics = db.Column(JSONType, nullable=False, default=dict)
    geometry = db.Column(JSONType, nullable=False, default=dict)


class ModelRun(TimestampMixin, db.Model):
    __tablename__ = "model_runs"

    id = db.Column(db.String(64), primary_key=True)
    portfolio_id = db.Column(db.String(64), db.ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True)
    status = db.Column(db.String(40), nullable=False, default="queued")
    current_stage = db.Column(db.String(80))
    configuration = db.Column(JSONType, nullable=False, default=dict)
    started_at = db.Column(db.DateTime(timezone=True))
    completed_at = db.Column(db.DateTime(timezone=True))


class RunStage(TimestampMixin, db.Model):
    __tablename__ = "run_stages"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    model_run_id = db.Column(db.String(64), db.ForeignKey("model_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    stage_key = db.Column(db.String(80), nullable=False)
    position = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(40), nullable=False, default="waiting")
    output = db.Column(JSONType, nullable=False, default=dict)
    started_at = db.Column(db.DateTime(timezone=True))
    completed_at = db.Column(db.DateTime(timezone=True))


class Approval(TimestampMixin, db.Model):
    __tablename__ = "approvals"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    model_run_id = db.Column(db.String(64), db.ForeignKey("model_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    reviewer_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True)
    action = db.Column(db.String(30), nullable=False)
    comment = db.Column(db.Text)


class Chat(TimestampMixin, db.Model):
    __tablename__ = "chats"

    id = db.Column(db.String(64), primary_key=True)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True, index=True)
    title = db.Column(db.String(180), nullable=False)
    context = db.Column(JSONType, nullable=False, default=dict)


class Message(TimestampMixin, db.Model):
    __tablename__ = "messages"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    chat_id = db.Column(db.String(64), db.ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True)
    role = db.Column(db.String(30), nullable=False)
    content = db.Column(db.Text, nullable=False)
    citations = db.Column(JSONType, nullable=False, default=list)
    metadata_json = db.Column(JSONType, nullable=False, default=dict)


class Upload(TimestampMixin, db.Model):
    __tablename__ = "uploads"
    __table_args__ = (db.UniqueConstraint("portfolio_id", "sha256", name="uq_uploads_portfolio_sha256"),)

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    portfolio_id = db.Column(db.String(64), db.ForeignKey("portfolios.id", ondelete="CASCADE"), nullable=False, index=True)
    uploaded_by = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True)
    filename = db.Column(db.String(255), nullable=False)
    media_type = db.Column(db.String(120))
    size_bytes = db.Column(db.Integer, nullable=False)
    sha256 = db.Column(db.String(64), nullable=False)
    storage_path = db.Column(db.String(512), nullable=False)
    status = db.Column(db.String(30), nullable=False, default="received")
    attestation = db.Column(db.String(30), nullable=False)
    extractor = db.Column(db.String(30), nullable=False)
    summary = db.Column(JSONType, nullable=False, default=dict)
    error = db.Column(db.Text)


class UploadRow(TimestampMixin, db.Model):
    __tablename__ = "upload_rows"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    upload_id = db.Column(db.String(36), db.ForeignKey("uploads.id", ondelete="CASCADE"), nullable=False, index=True)
    row_ref = db.Column(db.String(160), nullable=False)
    position = db.Column(db.Integer, nullable=False)
    data = db.Column(JSONType, nullable=False, default=dict)
    status = db.Column(db.String(30), nullable=False)
    property_id = db.Column(db.String(64), db.ForeignKey("properties.id", ondelete="SET NULL"), nullable=True, index=True)
    reviewed_by = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True)
    reviewed_at = db.Column(db.DateTime(timezone=True))
    review_comment = db.Column(db.Text)


class FieldProvenance(TimestampMixin, db.Model):
    __tablename__ = "field_provenance"
    __table_args__ = (db.Index("ix_field_provenance_subject", "subject_type", "subject_id"),)

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    subject_type = db.Column(db.String(30), nullable=False)
    subject_id = db.Column(db.String(64), nullable=False)
    field = db.Column(db.String(80), nullable=False)
    value = db.Column(JSONType)
    raw_value = db.Column(db.Text)
    method = db.Column(db.String(30), nullable=False)
    source_upload_id = db.Column(db.String(36), db.ForeignKey("uploads.id", ondelete="CASCADE"), nullable=True, index=True)
    source_column = db.Column(db.String(255))
    page = db.Column(db.Integer)
    quote = db.Column(db.Text)
    confidence = db.Column(db.Float)
    kind = db.Column(db.String(20), nullable=False, default="fact")
    confirmed_by = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True)
    confirmed_at = db.Column(db.DateTime(timezone=True))
    superseded_by = db.Column(db.String(36))


class ValidationIssue(TimestampMixin, db.Model):
    __tablename__ = "validation_issues"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    upload_id = db.Column(db.String(36), db.ForeignKey("uploads.id", ondelete="CASCADE"), nullable=False, index=True)
    upload_row_id = db.Column(db.String(36), db.ForeignKey("upload_rows.id", ondelete="CASCADE"), nullable=True, index=True)
    code = db.Column(db.String(60), nullable=False)
    severity = db.Column(db.String(20), nullable=False)
    field = db.Column(db.String(80))
    message = db.Column(db.Text, nullable=False)
    evidence = db.Column(JSONType, nullable=False, default=dict)
    resolved_by = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=True)
    resolution = db.Column(db.String(30))
    resolved_at = db.Column(db.DateTime(timezone=True))


class HazardReferencePoint(TimestampMixin, db.Model):
    """Scored locations used to interpolate hazard for buildings without supplied scores."""

    __tablename__ = "hazard_reference_points"

    id = db.Column(db.String(64), primary_key=True)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    scores = db.Column(JSONType, nullable=False)
    housing_class = db.Column(db.String(80))
    cost_per_m2_kes = db.Column(db.Float)
    source_upload_id = db.Column(db.String(36), db.ForeignKey("uploads.id", ondelete="SET NULL"), nullable=True)


class Hotspot(TimestampMixin, db.Model):
    __tablename__ = "hotspots"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    name = db.Column(db.String(160), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    severity = db.Column(db.String(20))
    weight = db.Column(db.Float)
    source_sha256 = db.Column(db.String(64))
