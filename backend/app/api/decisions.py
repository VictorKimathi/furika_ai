from flask import request
from flask_restx import Namespace, Resource

from ..services import decisions
from .auth import DUMMY_USER

ns = Namespace("decisions", description="Underwriting decision records (offer or portfolio run)", path="/decisions")


@ns.route("")
class DecisionCollectionResource(Resource):
    def get(self):
        """Decisions on one subject, newest first. subjectRef is required."""
        subject_ref = request.args.get("subjectRef")
        if not subject_ref:
            ns.abort(400, "subjectRef is required.")
        items = [decisions.serialize(item) for item in decisions.history(subject_ref)]
        return {"items": items, "total": len(items)}

    def post(self):
        """Record a decision on an offer. Portfolio runs are decided through /model-runs/{id}/decision, which records one too."""
        body = request.get_json(silent=True) or {}
        if body.get("subjectType") == "model_run":
            ns.abort(400, "Decide on a model run with POST /model-runs/{id}/decision.")
        try:
            entry = decisions.record(subject_type=body.get("subjectType", "offer"), subject_ref=body.get("subjectRef", ""),
                                     subject_label=body.get("subjectLabel", ""), action=body.get("action", ""),
                                     snapshot=body.get("snapshot"), comment=body.get("comment"), portfolio_id=body.get("portfolioId"),
                                     decided_by=DUMMY_USER["name"])
        except decisions.DecisionError as exc:
            ns.abort(exc.status, str(exc))
        return decisions.serialize(entry), 201
