from app.services import run_metrics

BASE = "/api/v1"
EXPECTED = {"ingestion": 13, "hazard": 10, "vulnerability": 8, "exposure": 10, "financial": 17, "ai": 14, "portfolio": 7, "trust": 8}


def test_every_catalogue_metric_is_returned(seeded):
    run = seeded.post(f"{BASE}/model-runs", json={"portfolioId": "SYN-PORT-142"}).json
    body = seeded.get(f"{BASE}/model-runs/{run['id']}/metrics").json
    assert {key: len(stage["metrics"]) for key, stage in body["stages"].items()} == EXPECTED
    for stage in body["stages"].values():
        for item in stage["metrics"]:
            assert item["tag"] and item["priority"] in ("P1", "P2", "P3") and item["display"]
            if item["value"] is None and item["chart"] is None and item["table"] is None:
                assert item["note"], item["id"]  # nothing is left blank without a reason
    financial = {item["id"]: item for item in body["stages"]["financial"]["metrics"]}
    assert financial["FIN-17"]["status"] == "pass"
    assert financial["FIN-04"]["chart"]["logX"] is True
    ep = financial["FIN-04"]["chart"]["series"][0]["values"]
    assert ep == sorted(ep)  # the EP curve rises with return period


def test_single_stage_and_chat_context(seeded, monkeypatch):
    from app.services import chat_provider
    run = seeded.post(f"{BASE}/model-runs", json={"portfolioId": "SYN-PORT-142"}).json
    body = seeded.get(f"{BASE}/model-runs/{run['id']}/metrics?stage=hazard").json
    assert list(body["stages"]) == ["hazard"]
    assert seeded.get(f"{BASE}/model-runs/{run['id']}/metrics?stage=nope").status_code == 400
    seen = {}
    monkeypatch.setattr(chat_provider, "answer", lambda prompt: (seen.setdefault("prompt", prompt) and "ok", "gemini", "m"))
    seeded.post(f"{BASE}/chat", json={"message": "Explain the footprint", "context": {"portfolioId": "SYN-PORT-142", "uploadIds": [], "runId": run["id"], "stage": "hazard"}})
    assert seen["prompt"].index("HAZ-02 Footprint share per tier") < seen["prompt"].index("By housing class")


def test_formatting_helpers():
    assert run_metrics.kes(1_234_000_000) == "KES 1.23 bn"
    assert run_metrics.kes(340_000_000) == "KES 340 m"
    assert run_metrics.permille(0.00911) == "9.11‰"
