import logging

from app.models import HazardResult, ModelRun
from app.services import model_runs

import pytest

BASE = "/api/v1"


@pytest.fixture
def logs(caplog):
    """The app logger writes its own lines and does not propagate, so attach pytest's handler to it directly."""
    logger = logging.getLogger("app")
    logger.addHandler(caplog.handler)
    caplog.set_level(logging.INFO, logger="app")
    yield caplog
    logger.removeHandler(caplog.handler)


def start(client, headers=None):
    return client.post(f"{BASE}/model-runs", json={"portfolioId": "SYN-PORT-142"}, headers=headers or {})


def test_successful_run_returns_and_logs_each_step(seeded, logs):
    response = start(seeded, {"X-Request-ID": "ui-abc123"})
    assert response.status_code == 202, response.json
    trace = response.json["trace"]
    assert trace["traceId"] == "ui-abc123" and response.headers["X-Request-ID"] == "ui-abc123"
    steps = [step["step"] for step in trace["steps"]]
    assert steps == ["check_portfolio", "load_properties", "run_model", "summarise", "supersede_previous", "insert_run", "write_results", "write_stages", "commit"]
    assert all(step["status"] == "ok" and step["ms"] is not None for step in trace["steps"])
    assert trace["steps"][1]["detail"]["modellable"] > 0
    assert "model_run.create step=write_results ok trace=ui-abc123" in logs.text
    assert "POST /api/v1/model-runs -> 202" in logs.text


def test_refusal_names_the_step(seeded):
    response = seeded.post(f"{BASE}/model-runs", json={"portfolioId": "NOPE"})
    assert response.status_code == 404
    assert response.json["error"] == "run_rejected" and response.json["step"] == "check_portfolio"
    assert response.json["trace"]["steps"][-1]["status"] == "rejected"


def test_crash_names_the_step_and_rolls_back(seeded, monkeypatch, logs):
    def broken(*args, **kwargs):
        raise RuntimeError("disk full")
    monkeypatch.setattr(model_runs, "_write_results", broken)
    response = start(seeded)
    assert response.status_code == 500
    body = response.json
    assert body["error"] == "run_failed" and body["step"] == "write_results"
    assert "RuntimeError: disk full" in body["message"]
    assert [step["status"] for step in body["trace"]["steps"]][-2:] == ["ok", "failed"]
    assert "step=write_results FAILED" in logs.text
    assert ModelRun.query.count() == 0 and HazardResult.query.count() == 0  # nothing half-written


def test_approval_is_traced(seeded):
    run = start(seeded).json
    response = seeded.post(f"{BASE}/model-runs/{run['id']}/decision", json={"action": "approve"})
    assert response.status_code == 200
    assert [step["step"] for step in response.json["trace"]["steps"]] == ["load_run", "record_decision", "publish", "commit"]
