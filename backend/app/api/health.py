from datetime import UTC, datetime

from flask import current_app
from flask_restx import Namespace, Resource

from ..services import llm


ns = Namespace("health", description="Service health and deployment checks", path="/health")


@ns.route("")
class HealthResource(Resource):
    @ns.doc(security=[])
    @ns.response(200, "Service is running")
    def get(self):
        """Return liveness without requiring a database connection."""
        return {
            "status": "ok",
            "service": "furika-ai-backend",
            "version": "1.0.0",
            "database": "postgresql-configured",
            "aiProvider": current_app.config["AI_PROVIDER"],
            "aiModel": current_app.config["GEMINI_MODEL"],
            "modelStatus": "dummy",
            "timestamp": datetime.now(UTC).isoformat(),
        }


@ns.route("/readiness")
class ReadinessResource(Resource):
    @ns.doc(security=[])
    @ns.response(200, "Prototype dependencies are configured")
    def get(self):
        """Return prototype readiness; database queries are intentionally deferred."""
        return {
            "ready": True,
            "checks": {"api": "ready", "database": "configured", "claude": "configured" if llm.get_llm() else "missing ANTHROPIC_API_KEY"},
            "timestamp": datetime.now(UTC).isoformat(),
        }
