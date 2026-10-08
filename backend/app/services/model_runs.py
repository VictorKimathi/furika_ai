"""Database-backed review workflow over uploaded portfolio exposure."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pandas as pd

from ..extensions import db
from ..models import Approval, HazardResult, LossResult, ModelRun, Portfolio, Property, RunStage, new_id
from . import furika_model as model

STAGES = [
    ("data_validation", "Data validation"),
    ("hazard_modelling", "Hazard modelling"),
    ("vulnerability_mapping", "Vulnerability mapping"),
    ("exposure_join", "Exposure join"),
    ("financial_loss", "Financial loss engine"),
    ("ai_intelligence", "AI intelligence"),
    ("human_review", "Human review gate"),
    ("publish", "Approved model run"),
]


class RunError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _iso(value):
    return value.isoformat() if value else None


def _properties(portfolio_id: str) -> list[Property]:
    props = Property.query.filter_by(portfolio_id=portfolio_id, review_status="confirmed").order_by(Property.id).all()
    return [prop for prop in props if prop.housing_class in model.VALID_CLASSES and prop.insured_value_kes and prop.floor_area_m2 and prop.cost_per_m2_kes and prop.latitude is not None and prop.longitude is not None and all(tier in ((prop.attributes or {}).get("hazard_scores") or {}) for tier in model.TIERS)]


def _calculate(portfolio_id: str):
    props = _properties(portfolio_id)
    if not props:
        raise RunError("No confirmed properties with all five hazard scores are ready for modelling.", 422)
    rows = []
    for prop in props:
        row = {"loc_id": prop.id, "lat": float(prop.latitude), "lon": float(prop.longitude), "housing_class": prop.housing_class,
               "floor_area_m2": float(prop.floor_area_m2), "cost_per_m2_kes": float(prop.cost_per_m2_kes), "tiv_kes": float(prop.insured_value_kes)}
        row.update({f"hazard_score_{tier}": float((prop.attributes or {})["hazard_scores"][tier]) for tier in model.TIERS})
        rows.append(row)
    try:
        return props, model.run_model(pd.DataFrame(rows))
    except (ValueError, TypeError) as exc:
        raise RunError(str(exc), 422) from exc


def serialize(run: ModelRun) -> dict:
    stages = RunStage.query.filter_by(model_run_id=run.id).order_by(RunStage.position).all()
    return {"id": run.id, "portfolioId": run.portfolio_id, "status": run.status, "currentStage": run.current_stage,
            "configuration": run.configuration or {}, "createdAt": _iso(run.started_at or run.created_at),
            "stages": [{"key": stage.stage_key, "title": dict(STAGES)[stage.stage_key], "position": stage.position,
                        "status": stage.status, "output": stage.output} for stage in stages], "dummy": False}


def create(payload: dict) -> dict:
    portfolio_id = payload.get("portfolioId")
    if not portfolio_id or db.session.get(Portfolio, portfolio_id) is None:
        raise RunError("The portfolio was not found.", 404)
    props, result = _calculate(portfolio_id)
    summary = {"propertyCount": len(props), "totalTivKes": result["total_tiv_kes"],
               "tierLosses": result["tier_losses"].to_dict(orient="records"),
               "aalKes": result["aal"]["aal_central"], "assumptions": result["assumptions"],
               "validationIssues": result["validation_issues"], "monotonicViolations": result["monotonic_violations"]}
    summary = json.loads(json.dumps(summary, default=lambda value: value.item() if hasattr(value, "item") else str(value)))
    now = datetime.now(UTC)
    for stale in ModelRun.query.filter_by(portfolio_id=portfolio_id, status="review").all():  # only one run awaits review at a time
        stale.status, stale.current_stage = "superseded", "human_review"
    run = ModelRun(id=f"RUN-{new_id()[:12].upper()}", portfolio_id=portfolio_id, status="review", current_stage="human_review",
                   configuration={"summary": summary}, started_at=now)
    db.session.add(run)
    _write_results(run, props, result)
    for position, (key, _) in enumerate(STAGES, 1):
        status = "review" if key == "human_review" else "waiting" if key == "publish" else "completed"
        output = summary if key == "financial_loss" else {"propertyCount": len(props)} if key in ("data_validation", "exposure_join") else {}
        db.session.add(RunStage(model_run_id=run.id, stage_key=key, position=position, status=status, output=output,
                                started_at=now if status == "completed" else None, completed_at=now if status == "completed" else None))
    db.session.commit()
    return serialize(run)


def _write_results(run: ModelRun, props: list[Property], result: dict) -> None:
    """Per-property hazard and loss for this run. They are drafts until the run is approved (see repository/chat)."""
    losses = result["losses"]
    probabilities = result["flood_probability"].set_index("loc_id")
    for prop in props:
        rows = losses[losses["loc_id"] == prop.id].sort_values("rp")
        curve = model.build_ep_curve(rows[["rp", "loss_kes"]])
        aal = model.compute_aal(curve)["aal_central"]
        severe = rows[rows["tier"] == "severe"].iloc[0]
        probability = float(probabilities.loc[prop.id, "p_flood"]) if prop.id in probabilities.index else None
        db.session.add(HazardResult(property_id=prop.id, model_run_id=run.id, hazard_score=float(severe["hazard_score"]),
                                    hazard_band="proxy", annual_flood_probability=probability,
                                    tiers=json.loads(rows[["tier", "rp", "hazard_score", "depth_m"]].to_json(orient="records")),
                                    drivers={}, provenance=[{"sourceUploadId": prop.upload_id}]))
        db.session.add(LossResult(property_id=prop.id, model_run_id=run.id, aal_kes=aal,
                                  loss_10_kes=model.interpolate_loss(curve, 10), loss_100_kes=model.interpolate_loss(curve, 100),
                                  loss_250_kes=model.interpolate_loss(curve, 250), ep_curve=json.loads(curve.to_json(orient="records")),
                                  assumptions=[result["assumptions"]]))


def latest_open_or_approved(portfolio_id: str) -> ModelRun | None:
    """The run whose results answer questions now: the latest approved one, else the latest awaiting review."""
    run = latest_approved(portfolio_id) or ModelRun.query.filter_by(portfolio_id=portfolio_id, status="review").order_by(ModelRun.created_at.desc()).first()
    if run is not None and run.status == "review" and HazardResult.query.filter_by(model_run_id=run.id).count() == 0:
        try:  # runs created before draft results existed: calculate them now
            props, result = _calculate(run.portfolio_id)
            _write_results(run, props, result)
            db.session.commit()
        except RunError:
            db.session.rollback()
    return run


def get(run_id: str) -> dict | None:
    run = db.session.get(ModelRun, run_id)
    return serialize(run) if run else None


def decide(run_id: str, action: str, comment: str | None) -> dict:
    run = db.session.get(ModelRun, run_id)
    if run is None:
        raise RunError("Model run was not found.", 404)
    if run.status != "review" or action not in ("approve", "return"):
        raise RunError("This run is not awaiting an approve or return decision.", 409)
    now = datetime.now(UTC)
    db.session.add(Approval(model_run_id=run.id, action=action, comment=comment))
    review = RunStage.query.filter_by(model_run_id=run.id, stage_key="human_review").one()
    if action == "approve":
        if HazardResult.query.filter_by(model_run_id=run.id).count() == 0:  # runs created before draft results existed
            props, result = _calculate(run.portfolio_id)
            _write_results(run, props, result)
        run.status, run.current_stage, run.completed_at = "approved", "publish", now
        review.status, review.completed_at = "completed", now
        publish = RunStage.query.filter_by(model_run_id=run.id, stage_key="publish").one()
        publish.status, publish.started_at, publish.completed_at = "completed", now, now
    else:
        run.status, run.current_stage = "revision_requested", "human_review"
        review.status = "failed"
    db.session.commit()
    return {"runId": run.id, "action": action, "comment": comment, "status": run.status, "decidedAt": now.isoformat(), "dummy": False}


def latest_approved(portfolio_id: str) -> ModelRun | None:
    return ModelRun.query.filter_by(portfolio_id=portfolio_id, status="approved").order_by(ModelRun.completed_at.desc()).first()
