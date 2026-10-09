import io


SAMPLE_EXPOSURE = [
    {
        "loc_id": "NBO-TEST-001",
        "lat": -1.2576,
        "lon": 36.8962,
        "housing_class": "semi_permanent",
        "floor_area_m2": 33,
        "cost_per_m2_kes": 10000,
        "tiv_kes": 330000,
        "synthetic": True,
        "hazard_score_common": 0.458406,
        "hazard_score_occasional": 0.407297,
        "hazard_score_moderate": 0.345205,
        "hazard_score_severe": 0.247281,
        "hazard_score_extreme": 0.134603,
    }
]



def test_health(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json["status"] == "ok"


def test_swagger_json(client):
    response = client.get("/api/v1/swagger.json")
    assert response.status_code == 200
    assert response.json["info"]["title"] == "Furika AI Catastrophe Modelling API"


def test_swagger_ui(client):
    response = client.get("/api/v1/docs")
    assert response.status_code == 200
    assert "Furika AI Catastrophe Modelling API" in response.get_data(as_text=True)


def test_property_search(seeded):
    response = seeded.get("/api/v1/portfolios/SYN-PORT-142/properties?q=Mathare")
    assert response.status_code == 200
    assert response.json["total"] == 2


def test_accumulation_regions_can_be_filtered_by_uploaded_dataset(seeded):
    uploads = seeded.get("/api/v1/portfolios/SYN-PORT-142/uploads").json["items"]
    upload_id = uploads[0]["id"]
    properties = seeded.get(f"/api/v1/portfolios/SYN-PORT-142/properties?uploadId={upload_id}&limit=2000")
    clusters = seeded.get(f"/api/v1/portfolios/SYN-PORT-142/clusters?type=neighbourhood&uploadId={upload_id}")
    assert properties.status_code == 200
    assert clusters.status_code == 200
    assert sum(item["propertyCount"] for item in clusters.json["items"]) == properties.json["total"]
    assert all(item["geocodedCount"] <= item["propertyCount"] for item in clusters.json["items"])
    assert all(item["centroidLat"] is not None for item in clusters.json["items"] if item["geocodedCount"])


def test_accumulation_reference_stays_separate_from_new_insured_assets(seeded):
    base = "/api/v1/portfolios/SYN-PORT-142"
    reference = seeded.get("/api/v1/locations/flood-reference")
    assert reference.status_code == 200
    assert reference.json["pointCount"] == 6
    assert reference.json["referenceUploadIds"]
    assert seeded.get(f"{base}/properties?excludeReference=true").json["total"] == 0

    content = ("loc_id,name,region,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes,tiv_kes,synthetic\n"
               "UW-001,Underwriter shop,Mathare,-1.2584,36.8554,semi_permanent,50,10000,500000,TRUE\n"
               "UW-002,Underwriter store,Mathare,-1.2568,36.8581,semi_permanent,70,10000,700000,TRUE\n")
    uploaded = seeded.post(f"{base}/uploads", data={"file": (io.BytesIO(content.encode()), "underwriter-assets.csv"),
                                                    "attestation": "synthetic"}, content_type="multipart/form-data")
    assert uploaded.status_code == 201, uploaded.json
    assert uploaded.json["status"] == "done"
    assets = seeded.get(f"{base}/properties?excludeReference=true&limit=2000").json
    regions = seeded.get(f"{base}/clusters?type=neighbourhood&excludeReference=true").json
    assert assets["total"] == 2
    assert {item["id"] for item in assets["items"]} == {"UW-001", "UW-002"}
    assert all(item["hazardSource"] == "interpolated" for item in assets["items"])
    assert sum(item["propertyCount"] for item in regions["items"]) == 2
    assert seeded.get(f"{base}/properties").json["total"] == 8
    assert seeded.get("/api/v1/locations/flood-reference").json["pointCount"] == 6


def test_accumulation_rejects_upload_outside_portfolio(seeded):
    for path in ("properties", "clusters"):
        response = seeded.get(f"/api/v1/portfolios/SYN-PORT-142/{path}?uploadId=missing-upload")
        assert response.status_code == 404


def test_property_detail(seeded):
    response = seeded.get("/api/v1/properties/NBO-0002")
    assert response.status_code == 200
    assert response.json["identity"]["id"] == "NBO-0002"
    assert response.json["dummy"] is False


def test_model_run_and_decision(seeded):
    api_client = seeded
    run_response = api_client.post("/api/v1/model-runs", json={"portfolioId": "SYN-PORT-142"})
    assert run_response.status_code == 202
    assert run_response.json["dummy"] is False
    assert run_response.json["configuration"]["summary"]["propertyCount"] > 0
    run_id = run_response.json["id"]
    assert api_client.get(f"/api/v1/model-runs/{run_id}/report").status_code == 409
    decision = api_client.post(
        f"/api/v1/model-runs/{run_id}/decision",
        json={"action": "approve", "comment": "Reviewed"},
    )
    assert decision.status_code == 200
    assert decision.json["status"] == "approved"
    assert decision.json["reportDelivery"]["status"] == "not_configured"
    summary = api_client.get("/api/v1/portfolios/SYN-PORT-142/summary")
    assert summary.json["portfolioAalKes"] is not None
    property_response = api_client.get("/api/v1/properties/NBO-0002")
    assert property_response.json["loss"]["loss100Kes"] is not None
    report = api_client.get(f"/api/v1/model-runs/{run_id}/report")
    assert report.status_code == 200
    body = report.json
    assert body["runId"] == run_id
    assert list(body["stages"]) == ["ingestion", "hazard", "vulnerability", "exposure", "financial", "ai", "portfolio", "trust"]
    assert [point["returnPeriodYears"] for point in body["epCurve"]] == [10, 25, 50, 100, 250]
    assert all(point["annualExceedanceProbability"] == 1 / point["returnPeriodYears"] for point in body["epCurve"])
    assert all(point["groundUpKes"] >= point["grossKes"] >= point["netKes"] for point in body["epCurve"])
    assert body["financial"]["aalRangeKes"]["low"] <= body["financial"]["aalRangeKes"]["central"] <= body["financial"]["aalRangeKes"]["high"]
    assert body["financial"]["assumptions"]["tierRp"]
    latest = api_client.get("/api/v1/model-runs?portfolioId=SYN-PORT-142")
    assert latest.json["items"][0]["status"] == "approved"


def test_chat_contract(seeded, monkeypatch):
    from app.services import chat_provider

    uploads = seeded.get("/api/v1/portfolios/SYN-PORT-142/uploads").json["items"]
    source_id = uploads[0]["id"]
    observed = {}
    def fake_answer(prompt):
        observed["prompt"] = prompt
        return "The selected file has synthetic exposure rows.", "claude", "test-model"
    monkeypatch.setattr(chat_provider, "answer", fake_answer)
    response = seeded.post("/api/v1/chat", json={"message": "What is in this dataset?", "mode": "analysis", "context": {"portfolioId": "SYN-PORT-142", "uploadIds": [source_id]}})
    assert response.status_code == 200
    assert response.json["dummy"] is False
    assert response.json["provider"] == "claude"
    assert "reference_sample.csv" in observed["prompt"]
    assert "row" in observed["prompt"]


def test_chat_rejects_source_from_another_portfolio(seeded):
    response = seeded.post("/api/v1/chat", json={"message": "Summarise this file", "context": {"portfolioId": "SYN-PORT-142", "uploadIds": ["not-an-upload"]}})
    assert response.status_code == 404


def test_chat_tries_claude_then_gemini(monkeypatch):
    from app.services import chat_provider

    calls = []
    def claude_down(_prompt):
        calls.append("claude")
        raise chat_provider.ChatProviderError("Claude request failed: credit balance is too low")
    def gemini_up(_prompt):
        calls.append("gemini")
        return "Grounded answer", "gemini-3.8-flash"
    monkeypatch.setattr(chat_provider, "_claude", claude_down)
    monkeypatch.setattr(chat_provider, "_gemini", gemini_up)
    assert chat_provider.answer("question") == ("Grounded answer", "gemini", "gemini-3.8-flash")
    assert calls == ["claude", "gemini"]


def test_chat_uses_gpt_luna_after_claude_and_gemini_fail(monkeypatch):
    from app.services import chat_provider

    calls = []
    def unavailable(provider):
        def call(_prompt):
            calls.append(provider)
            raise chat_provider.ChatProviderError(f"{provider} unavailable")
        return call
    def openai_up(_prompt):
        calls.append("openai")
        return "Grounded answer", "gpt-5.6-luna"
    monkeypatch.setattr(chat_provider, "_claude", unavailable("claude"))
    monkeypatch.setattr(chat_provider, "_gemini", unavailable("gemini"))
    monkeypatch.setattr(chat_provider, "_openai", openai_up)
    assert chat_provider.answer("question") == ("Grounded answer", "openai", "gpt-5.6-luna")
    assert calls == ["claude", "gemini", "openai"]


def test_gpt_luna_responses_request_is_private_and_reads_message_text(monkeypatch):
    import io
    import json
    from app.services import chat_provider

    observed = {}
    def fake_urlopen(request, timeout):
        observed["url"] = request.full_url
        observed["key"] = request.get_header("Authorization")
        observed["body"] = json.loads(request.data)
        observed["timeout"] = timeout
        return io.BytesIO(json.dumps({"status": "completed", "output": [
            {"type": "reasoning", "summary": []},
            {"type": "message", "content": [{"type": "output_text", "text": "Grounded answer"}]},
        ]}).encode())
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.delenv("RISK_ATLAS_OPENAI_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.setattr(chat_provider.urllib.request, "urlopen", fake_urlopen)
    assert chat_provider._openai("Portfolio evidence") == ("Grounded answer", "gpt-5.6-luna")
    assert observed["url"] == "https://api.openai.com/v1/responses"
    assert observed["key"] == "Bearer test-openai-key"
    assert observed["body"]["model"] == "gpt-5.6-luna"
    assert observed["body"]["input"] == "Portfolio evidence"
    assert observed["body"]["instructions"] == chat_provider.SYSTEM
    assert observed["body"]["store"] is False


def test_gpt_luna_uses_risk_atlas_model_setting(monkeypatch):
    import io
    import json
    from app.services import chat_provider

    observed = {}
    def fake_urlopen(request, timeout):
        observed["body"] = json.loads(request.data)
        return io.BytesIO(json.dumps({"status": "completed", "output": [
            {"type": "message", "content": [{"type": "output_text", "text": "Grounded answer"}]},
        ]}).encode())

    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-5.6-luna")
    monkeypatch.setenv("RISK_ATLAS_OPENAI_MODEL", "gpt-6-luna")
    monkeypatch.setattr(chat_provider.urllib.request, "urlopen", fake_urlopen)

    assert chat_provider._openai("Portfolio evidence") == ("Grounded answer", "gpt-6-luna")
    assert observed["body"]["model"] == "gpt-6-luna"
    assert observed["body"]["reasoning"] == {"effort": "low"}


def test_claude_code_key_is_accepted_for_chat(monkeypatch):
    from types import SimpleNamespace
    from app.services import chat_provider

    from app.services import llm

    observed = {}
    class FakeClaude:
        def __init__(self, api_key, timeout):
            observed["key"] = api_key
            self.beta = self.messages = self
        def create(self, **kwargs):
            observed["model"] = kwargs["model"]
            return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="Grounded answer")])

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("CLAUDE_CODE", "test-api-key")
    monkeypatch.setattr(llm.anthropic, "Anthropic", FakeClaude)
    assert chat_provider.answer("question") == ("Grounded answer", "claude", llm.MODEL)
    assert observed["key"] == "test-api-key"
    assert observed["model"] == llm.MODEL


def test_exposure_validation_and_calculation_contract(client):
    api_client = client
    validation = api_client.post("/api/v1/modelling/validate-exposure", json={"exposure": SAMPLE_EXPOSURE})
    assert validation.status_code == 200
    assert validation.json["valid"] is True

    calculation = api_client.post("/api/v1/modelling/calculate", json={"exposure": SAMPLE_EXPOSURE})
    assert calculation.status_code == 200
    assert calculation.json["totalTivKes"] == 330000
    assert len(calculation.json["tierLosses"]) == 5
    assert calculation.json["aal"]["aal_low"] <= calculation.json["aal"]["aal_central"]
    assert calculation.json["aal"]["aal_central"] <= calculation.json["aal"]["aal_high"]


def test_calculation_rejects_invalid_coordinates(client):
    bad_exposure = [{**SAMPLE_EXPOSURE[0], "lat": 8.0}]
    response = client.post("/api/v1/modelling/calculate", json={"exposure": bad_exposure})
    assert response.status_code == 400
    assert "outside the configured Nairobi bounds" in response.json["message"]


def test_ep_curve_and_vulnerability_contracts(client):
    api_client = client
    ratio = api_client.post(
        "/api/v1/modelling/damage-ratio",
        json={"depthM": [0, 1], "housingClass": ["semi_permanent", "semi_permanent"]},
    )
    assert ratio.status_code == 200
    assert ratio.json["damageRatio"][0] == 0
    assert ratio.json["damageRatio"][1] > 0

    ep = api_client.post(
        "/api/v1/modelling/ep-curve",
        json={"points": [{"rp": 10, "lossKes": 100000}, {"rp": 100, "lossKes": 500000}]},
    )
    assert ep.status_code == 200
    assert ep.json["curve"][0] == {"rp": 1.0, "loss_kes": 0, "probability": 1.0}
    assert ep.json["returnPeriodLosses"]["250"] == 500000
