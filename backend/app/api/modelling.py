import json

import pandas as pd
from flask import request
from flask_restx import Namespace, Resource

from ..services import furika_model as model
from .swagger_models import (
    calculation_response,
    damage_ratio_request,
    ep_curve_request,
    exposure_rows_request,
    hotspot_uplift_request,
    model_run_calculation_request,
    validation_response,
)


ns = Namespace(
    "modelling",
    description="Deterministic hazard, vulnerability, financial-loss, EP, AAL, and sensitivity calculations",
    path="/modelling",
)


def _records(frame: pd.DataFrame) -> list[dict]:
    return json.loads(frame.to_json(orient="records"))


def _exposure(payload: dict) -> pd.DataFrame:
    rows = payload.get("exposure")
    if not isinstance(rows, list) or not rows:
        ns.abort(400, "exposure must be a non-empty array of canonical property rows.")
    return pd.DataFrame(rows)


@ns.route("/validate-exposure")
class ValidateExposureResource(Resource):
    @ns.expect(exposure_rows_request, validate=True)
    @ns.marshal_with(validation_response)
    def post(self):
        """Validate schema, values, coordinates, classes, TIV reconciliation, and score ranges."""
        frame = _exposure(request.get_json())
        _, issues = model.validate_exposure(frame)
        return {
            "valid": not issues,
            "rowCount": len(frame),
            "issues": issues,
            "requiredColumns": model.REQUIRED_EXPOSURE_COLUMNS,
        }


@ns.route("/damage-ratio")
class DamageRatioResource(Resource):
    @ns.expect(damage_ratio_request, validate=True)
    def post(self):
        """Evaluate the normalized sigmoid vulnerability curve by housing class."""
        payload = request.get_json()
        params = payload.get("parameters") or model.DEFAULT_VULN
        issues = model.validate_vuln_params(params)
        if issues:
            ns.abort(400, " ".join(issues))
        try:
            ratios = model.damage_ratio(payload["depthM"], payload["housingClass"], params)
        except (KeyError, TypeError, ValueError) as exc:
            ns.abort(400, str(exc))
        return {"damageRatio": ratios.tolist(), "parameters": params, "formula": "normalized_sigmoid", "dummy": False}


@ns.route("/calculate")
class CalculateModelResource(Resource):
    @ns.expect(model_run_calculation_request, validate=True)
    @ns.marshal_with(calculation_response)
    def post(self):
        """Run the full score → depth → damage → loss → EP → AAL calculation chain."""
        payload = request.get_json()
        exposure = _exposure(payload)
        hotspots = pd.DataFrame(payload["hotspots"]) if payload.get("hotspots") else None
        configuration = payload.get("configuration") or {}
        try:
            result = model.run_model(
                exposure,
                tier_rp=configuration.get("tierRp", model.DEFAULT_TIER_RP),
                d_max=float(configuration.get("dMaxM", model.DEFAULT_D_MAX)),
                wet_threshold=float(configuration.get("wetThresholdM", model.DEFAULT_WET_THRESHOLD)),
                hotspots=hotspots,
                apply_uplift=bool(configuration.get("applyUplift", False)),
                uplift_radius_km=float(configuration.get("upliftRadiusKm", 1.0)),
            )
        except ValueError as exc:
            ns.abort(400, str(exc))
        return {
            "validationIssues": result["validation_issues"],
            "monotonicViolations": result["monotonic_violations"],
            "totalTivKes": result["total_tiv_kes"],
            "tierLosses": _records(result["tier_losses"]),
            "lossByClass": _records(result["loss_by_class"]),
            "epCurve": _records(result["ep_curve"]),
            "aal": result["aal"],
            "aalPercentTiv": result["aal_percent_tiv"],
            "floodProbability": _records(result["flood_probability"]),
            "localAccumulation": _records(result["local_accumulation"]),
            "hotspotValidation": result["hotspot_validation"],
            "assumptions": result["assumptions"],
        }


@ns.route("/ep-curve")
class EpCurveResource(Resource):
    @ns.expect(ep_curve_request, validate=True)
    def post(self):
        """Build the log-RP EP curve and calculate the anchor-sensitive AAL range."""
        points = request.get_json()["points"]
        frame = pd.DataFrame([{"rp": point["rp"], "loss_kes": point.get("lossKes", point.get("loss_kes"))} for point in points])
        try:
            curve = model.build_ep_curve(frame)
            aal = model.compute_aal(curve)
        except (AttributeError, KeyError, TypeError, ValueError) as exc:
            ns.abort(400, str(exc))
        return {"curve": _records(curve), "aal": aal, "returnPeriodLosses": {str(rp): model.interpolate_loss(curve, rp) for rp in (10, 100, 250)}, "tailTreatment": "held flat beyond the last tier"}


@ns.route("/hotspot-uplift")
class HotspotUpliftResource(Resource):
    @ns.expect(hotspot_uplift_request, validate=True)
    def post(self):
        """Calculate the distance-decayed report-based hazard uplift."""
        payload = request.get_json()
        exposure = pd.DataFrame(payload["exposure"])
        hotspots = pd.DataFrame(payload["hotspots"])
        try:
            uplift = model.hotspot_uplift(exposure, hotspots, float(payload.get("radiusKm", 1.0)), float(payload.get("minimum", 0.01)))
        except (KeyError, TypeError, ValueError) as exc:
            ns.abort(400, str(exc))
        return {"uplift": uplift.tolist(), "radiusKm": payload.get("radiusKm", 1.0), "minimum": payload.get("minimum", 0.01), "provenance": "AI-extracted hotspot cues; deterministic distance decay"}


@ns.route("/sensitivity")
class SensitivityResource(Resource):
    @ns.expect(model_run_calculation_request, validate=True)
    def post(self):
        """Run one-at-a-time D_max scenarios for L(100) and AAL."""
        payload = request.get_json()
        exposure = _exposure(payload)
        hotspots = pd.DataFrame(payload["hotspots"]) if payload.get("hotspots") else None
        try:
            output = model.sensitivity_runs(exposure, hotspots)
        except ValueError as exc:
            ns.abort(400, str(exc))
        return {"items": _records(output), "baseCaseDMaxM": 4.0, "dummy": False}
