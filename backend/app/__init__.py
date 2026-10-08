from flask import Flask
from flask_cors import CORS

from .config import Config
from .extensions import api as rest_api
from .extensions import db, migrate


def create_app(config_object=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)
    app.url_map.strict_slashes = False

    db.init_app(app)
    migrate.init_app(app, db)
    CORS(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
        supports_credentials=True,
    )

    rest_api.init_app(app)

    from .api import register_namespaces

    register_namespaces(rest_api)

    from . import models  # noqa: F401

    @app.cli.command("init-db")
    def init_db() -> None:
        """Create PostgreSQL tables for local development."""
        db.create_all()
        print("Furika database tables created.")

    return app
