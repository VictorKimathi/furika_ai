from flask_migrate import Migrate
from flask_restx import Api
from flask_sqlalchemy import SQLAlchemy


db = SQLAlchemy()
migrate = Migrate()

api = Api(
    version="1.0.0",
    title="Furika AI Catastrophe Modelling API",
    description=(
        "Backend contract for portfolio search, property flood-risk detail, "
        "agentic model runs, human approval, reports, and Furika AI chat. "
        "Responses currently contain documented dummy data."
    ),
    doc="/api/v1/docs",
    prefix="/api/v1",
    authorizations={
        "Bearer": {
            "type": "apiKey",
            "in": "header",
            "name": "Authorization",
            "description": "Use: Bearer <access token>",
        }
    },
    security="Bearer",
)
