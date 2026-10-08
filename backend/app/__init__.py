import logging
import time
from pathlib import Path

import click
from flask import Flask, g, request
from flask_cors import CORS

from .config import Config
from .extensions import api as rest_api
from .extensions import db, migrate


def _configure_logging(app: Flask) -> None:
    """One readable line per event for everything under app.* (model runs, chat, ingestion)."""
    logger = logging.getLogger("app")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s"))
        logger.addHandler(handler)
    logger.setLevel(app.config.get("LOG_LEVEL", "INFO"))
    logger.propagate = False


def _log_requests(app: Flask) -> None:
    """Log each API call with its request ID (from the browser's X-Request-ID) and echo the ID back."""
    from .services.run_trace import request_id

    log = logging.getLogger("app.http")

    @app.before_request
    def start_timer():
        g.request_started = time.perf_counter()
        request_id()

    @app.after_request
    def log_request(response):
        if request.path.startswith("/api/") and request.method != "OPTIONS":
            ms = round((time.perf_counter() - g.get("request_started", time.perf_counter())) * 1000, 1)
            level = logging.WARNING if response.status_code >= 400 else logging.INFO
            log.log(level, "%s %s -> %s %sms request=%s", request.method, request.full_path.rstrip("?"), response.status_code, ms, request_id())
            response.headers["X-Request-ID"] = request_id()
        return response


def create_app(config_object=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)
    app.url_map.strict_slashes = False
    _configure_logging(app)

    db.init_app(app)
    migrate.init_app(app, db)
    CORS(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
        supports_credentials=True,
        expose_headers=["X-Request-ID"],
    )

    rest_api.init_app(app)
    _log_requests(app)

    from .api import register_namespaces

    register_namespaces(rest_api)

    from . import models  # noqa: F401

    @app.cli.command("init-db")
    def init_db() -> None:
        """Create PostgreSQL tables for local development."""
        db.create_all()
        print("Furika database tables created.")

    @app.cli.command("seed-reference")
    @click.option("--file", "file_path", type=click.Path(path_type=Path), default=Path("data/reference/exposure_nairobi_with_hazard.csv"), show_default=True)
    @click.option("--hotspots", "hotspots_path", type=click.Path(path_type=Path), default=None, help="Hotspot CSV (name, lat, lon, optional severity/weight). Defaults to data/reference/hotspots.csv when present.")
    @click.option("--portfolio", "portfolio_id", default="SYN-PORT-142", show_default=True)
    @click.option("--name", "portfolio_name", default="Nairobi Synthetic Flood Portfolio", show_default=True)
    def seed_reference(file_path: Path, hotspots_path: Path | None, portfolio_id: str, portfolio_name: str) -> None:
        """Load hotspots, then the synthetic reference exposure (through the upload pipeline) and its hazard grid."""
        from werkzeug.datastructures import FileStorage

        from .models import Portfolio
        from .services import reference
        from .services.ingestion import IngestionError, receive_upload

        if not file_path.is_file():
            raise click.ClickException(f"{file_path} not found. Copy the reference exposure CSV there or pass --file.")
        default_hotspots = Path("data/reference/hotspots.csv")
        if hotspots_path is None and default_hotspots.is_file():
            hotspots_path = default_hotspots
        if hotspots_path is not None:
            if not hotspots_path.is_file():
                raise click.ClickException(f"{hotspots_path} not found.")
            try:
                count, skipped = reference.load_hotspots(hotspots_path)
            except ValueError as exc:
                raise click.ClickException(str(exc)) from exc
            click.echo(f"Hotspots: {count} loaded" + (f"; skipped {len(skipped)}: {'; '.join(skipped)}" if skipped else ""))
        else:
            click.echo("Hotspots: none loaded (no data/reference/hotspots.csv and no --hotspots).")

        try:
            with file_path.open("rb") as handle:
                upload, created = receive_upload(portfolio_id, FileStorage(stream=handle, filename=file_path.name, content_type="text/csv"), "synthetic")
        except IngestionError as exc:
            raise click.ClickException(exc.message) from exc
        portfolio = db.session.get(Portfolio, portfolio_id)
        if portfolio.name == portfolio_id:
            portfolio.name = portfolio_name
            db.session.commit()
        if created:
            click.echo(f"Upload {upload.id}: status={upload.status} rows={upload.summary.get('rows')} by status={upload.summary.get('byStatus')}")
        else:
            click.echo(f"Exposure already loaded as upload {upload.id}.")
        if upload.status != "done":
            raise click.ClickException(upload.error or f"The reference file was not processed; see /api/v1/uploads/{upload.id}/issues.")
        click.echo(f"Hazard grid: {reference.load_reference_points(upload)} reference point(s) added.")
        if hotspots_path is not None:
            click.echo(f"Hotspot distances refreshed for {reference.refresh_hotspot_distances()} properties.")

    return app
