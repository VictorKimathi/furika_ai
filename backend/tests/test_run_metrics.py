import pytest
from app.services import run_metrics

BASE = "/api/v1"
EXPECTED = {"ingestion": 13, "hazard": 10, "vulnerability": 8, "exposure": 10, "financial": 21, "ai": 14, "portfolio": 7, "trust": 8}


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
    # Ground-up -> gross -> net is reported per tier and only ever shrinks.
    for tier in financial["FIN-18"]["data"]["tiers"]:
        assert tier["netKes"] <= tier["grossKes"] <= tier["groundUpKes"] + 1e-6
        assert abs(tier["grossKes"] + tier["ownerKeepsKes"] + tier["aboveLimitKes"] - tier["groundUpKes"]) < 1
    example = financial["FIN-19"]["data"]
    assert example and all(step["groundUpKes"] == pytest.approx(step["damageRatio"] * example["tivKes"], rel=1e-4) for step in example["steps"])
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


def test_rcc_is_modelled_and_run_summary_has_breakdowns(seeded):
    import io
    content = "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes,hazard_score_common,hazard_score_occasional,hazard_score_moderate,hazard_score_severe,hazard_score_extreme\nRCC-9,-1.2585,36.8556,concrete_rcc,900,78000,0.6,0.5,0.4,0.3,0.2\nRCC-10,-1.2700,36.8300,Reinforced concrete office,400,80000,0.5,0.4,0.3,0.2,0.1\n"
    seeded.post(f"{BASE}/portfolios/SYN-PORT-142/uploads", data={"file": (io.BytesIO(content.encode()), "rcc.csv"), "attestation": "synthetic"}, content_type="multipart/form-data")
    run = seeded.post(f"{BASE}/model-runs", json={"portfolioId": "SYN-PORT-142"}).json
    summary = run["configuration"]["summary"]
    assert summary["propertyCount"] == 8  # 6 seeded + 2 RCC
    classes = {row["housingClass"]: row for row in summary["classBreakdown"]}
    assert classes["concrete_rcc"]["properties"] == 2 and classes["concrete_rcc"]["aalKes"] > 0
    assert len(summary["topRisks"]) == 8 and summary["topRisks"][0]["aalKes"] >= summary["topRisks"][-1]["aalKes"]
    assert summary["topRisks"][0]["largestScenario"] == "common"  # the rarest (1 in 250) tier
    losses = [tier["loss_kes"] for tier in sorted(summary["tierLosses"], key=lambda tier: tier["rp"])]
    assert losses == sorted(losses)  # losses still rise with rarity
