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
