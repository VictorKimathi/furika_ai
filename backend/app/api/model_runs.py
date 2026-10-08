import json

from flask import Response, request, stream_with_context
from flask_restx import Namespace, Resource

from ..services import model_runs, run_metrics
from ..extensions import db
from ..models import ModelRun
from .swagger_models import (
    decision_request,
    decision_response,
    error_model,
    run_create_request,
    run_model,
)


ns = Namespace("model-runs", description="Agentic catastrophe-model workflow and human review", path="/model-runs")


@ns.route("")
class ModelRunCollectionResource(Resource):
    def get(self):
        """Return the latest stored run for a portfolio, for resuming review."""
        portfolio_id = request.args.get("portfolioId")
        if not portfolio_id:
            ns.abort(400, "portfolioId is required.")
        run = ModelRun.query.filter_by(portfolio_id=portfolio_id).order_by(ModelRun.created_at.desc()).first()
        return {"items": [model_runs.serialize(run)] if run else [], "total": 1 if run else 0}

    @ns.expect(run_create_request, validate=True)
    @ns.marshal_with(run_model, code=202)
    def post(self):
        """Start a model run. A real worker queue can replace the dummy service later."""
        try:
            return model_runs.create(request.get_json() or {}), 202
        except model_runs.RunError as exc:
            ns.abort(exc.status, str(exc))


@ns.route("/<string:run_id>")
class ModelRunResource(Resource):
    @ns.marshal_with(run_model)
    @ns.response(404, "Run not found", error_model)
    def get(self, run_id):
        """Return current stage, status, outputs, and review state."""
        result = model_runs.get(run_id)
        if result is None:
            ns.abort(404, f"Model run {run_id} was not found.")
        return result


@ns.route("/<string:run_id>/events")
class ModelRunEventsResource(Resource):
    @ns.produces(["text/event-stream"])
    @ns.response(200, "Server-Sent Events stream")
    @ns.response(404, "Run not found", error_model)
    def get(self, run_id):
        """Stream stage.started, stage.completed, review.required, and run.completed events."""
        result = model_runs.get(run_id)
        if result is None:
            ns.abort(404, f"Model run {run_id} was not found.")

        def event_stream():
            for stage in result["stages"]:
                yield f"event: stage.{stage['status']}\ndata: {json.dumps({'runId': run_id, 'stageId': stage['key'], 'output': stage['output'], 'dummy': False})}\n\n"

        return Response(stream_with_context(event_stream()), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@ns.route("/<string:run_id>/metrics")
class ModelRunMetricsResource(Resource):
    @ns.doc(params={"stage": "ingestion | hazard | vulnerability | exposure | financial | ai | portfolio | trust (omit for all)"})
    @ns.response(404, "Run not found", error_model)
    @ns.response(422, "Metrics unavailable", error_model)
    def get(self, run_id):
        """Metrics catalogue by stage (ING, HAZ, VUL, EXP, FIN, AI, PORT, TRU) with chart data, tags and priorities."""
        run = db.session.get(ModelRun, run_id)
        if run is None:
            ns.abort(404, f"Model run {run_id} was not found.")
        try:
            payload = run_metrics.compute(run)
        except run_metrics.MetricsError as exc:
            ns.abort(422, str(exc))
        stage = request.args.get("stage")
        if stage:
            if stage not in payload["stages"]:
                ns.abort(400, f"Unknown stage {stage}.")
            return {**payload, "stages": {stage: payload["stages"][stage]}}
        return payload


@ns.route("/<string:run_id>/decision")
class ModelRunDecisionResource(Resource):
    @ns.expect(decision_request, validate=True)
    @ns.marshal_with(decision_response)
    @ns.response(404, "Run not found", error_model)
    def post(self, run_id):
        """Approve the human-review gate or return the run for revision."""
        payload = request.get_json()
        try:
            return model_runs.decide(run_id, payload["action"], payload.get("comment"))
        except model_runs.RunError as exc:
            ns.abort(exc.status, str(exc))


@ns.route("/<string:run_id>/cancel")
class ModelRunCancelResource(Resource):
    @ns.response(404, "Run not found", error_model)
    def post(self, run_id):
        """Cancel an active workflow run."""
        ns.abort(409, "Only runs awaiting review are stored. Return the run for revision instead.")


@ns.route("/<string:run_id>/stages/<string:stage_id>/output")
class ModelRunStageOutputResource(Resource):
    @ns.response(404, "Run or stage not found", error_model)
    def get(self, run_id, stage_id):
        """Return an auditable output payload for one workflow stage."""
        result = model_runs.get(run_id)
        stage = next((stage for stage in result["stages"] if stage["key"] == stage_id), None) if result else None
        if stage is None:
            ns.abort(404, f"Stage {stage_id} was not found for run {run_id}.")
        return {"runId": run_id, "stageId": stage_id, "status": stage["status"], "output": stage["output"], "provenance": ["portfolio database"], "dummy": False}


@ns.route("/<string:run_id>/report")
class ModelRunReportResource(Resource):
    @ns.doc(params={"format": "json | pdf"})
    def get(self, run_id):
        """Return or export the approved underwriter report."""
        result = model_runs.get(run_id)
        if result is None:
            ns.abort(404, f"Model run {run_id} was not found.")
        if result["status"] != "approved":
            ns.abort(409, "The report is available only after approval.")
        if request.args.get("format", "json") != "json":
            ns.abort(400, "Only JSON report export is implemented.")
        return {"runId": run_id, "status": "approved", "summary": result["configuration"].get("summary", {}), "dummy": False}
