import json

from flask import Response, request, stream_with_context
from flask_restx import Namespace, Resource

from ..services import dummy
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
    @ns.expect(run_create_request, validate=True)
    @ns.marshal_with(run_model, code=202)
    def post(self):
        """Start a model run. A real worker queue can replace the dummy service later."""
        return dummy.create_model_run(request.get_json()), 202


@ns.route("/<string:run_id>")
class ModelRunResource(Resource):
    @ns.marshal_with(run_model)
    @ns.response(404, "Run not found", error_model)
    def get(self, run_id):
        """Return current stage, status, outputs, and review state."""
        result = dummy.get_model_run(run_id)
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
        result = dummy.get_model_run(run_id)
        if result is None:
            ns.abort(404, f"Model run {run_id} was not found.")

        def event_stream():
            for key, title in dummy.STAGES[:-2]:
                yield f"event: stage.started\ndata: {json.dumps({'runId': run_id, 'stageId': key, 'title': title, 'dummy': True})}\n\n"
                yield f"event: stage.completed\ndata: {json.dumps({'runId': run_id, 'stageId': key, 'output': {'status': 'dummy output ready'}, 'dummy': True})}\n\n"
            yield f"event: review.required\ndata: {json.dumps({'runId': run_id, 'stageId': 'human_review', 'dummy': True})}\n\n"

        return Response(stream_with_context(event_stream()), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@ns.route("/<string:run_id>/decision")
class ModelRunDecisionResource(Resource):
    @ns.expect(decision_request, validate=True)
    @ns.marshal_with(decision_response)
    @ns.response(404, "Run not found", error_model)
    def post(self, run_id):
        """Approve the human-review gate or return the run for revision."""
        payload = request.get_json()
        result = dummy.decide_model_run(run_id, payload["action"], payload.get("comment"))
        if result is None:
            ns.abort(404, f"Model run {run_id} was not found.")
        return result


@ns.route("/<string:run_id>/cancel")
class ModelRunCancelResource(Resource):
    @ns.response(404, "Run not found", error_model)
    def post(self, run_id):
        """Cancel an active workflow run."""
        result = dummy.cancel_model_run(run_id)
        if result is None:
            ns.abort(404, f"Model run {run_id} was not found.")
        return result


@ns.route("/<string:run_id>/stages/<string:stage_id>/output")
class ModelRunStageOutputResource(Resource):
    @ns.response(404, "Run or stage not found", error_model)
    def get(self, run_id, stage_id):
        """Return an auditable output payload for one workflow stage."""
        result = dummy.get_model_run(run_id)
        if result is None or stage_id not in {stage[0] for stage in dummy.STAGES}:
            ns.abort(404, f"Stage {stage_id} was not found for run {run_id}.")
        return {"runId": run_id, "stageId": stage_id, "status": "completed", "output": {"message": "Dummy stage output"}, "provenance": ["dummy backend"], "dummy": True}


@ns.route("/<string:run_id>/report")
class ModelRunReportResource(Resource):
    @ns.doc(params={"format": "json | pdf"})
    def get(self, run_id):
        """Return or export the approved underwriter report."""
        report = dummy.model_report(run_id)
        report["format"] = request.args.get("format", "json")
        return report

