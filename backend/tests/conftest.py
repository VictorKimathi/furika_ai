from pathlib import Path

import pytest

from app import create_app
from app.config import TestingConfig
from app.extensions import db
from app.services import gemini

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def app(tmp_path, monkeypatch):
    class Config(TestingConfig):
        STORAGE_ROOT = str(tmp_path / "storage")

    monkeypatch.setattr(gemini, "get_llm", lambda: None)
    application = create_app(Config)
    with application.app_context():
        db.create_all()
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def seeded(app, client):
    """The SYN-PORT-142 portfolio loaded from the reference sample through the seed command."""
    result = app.test_cli_runner().invoke(args=["seed-reference", "--file", str(FIXTURES / "reference_sample.csv")])
    assert result.exit_code == 0, result.output
    return client
