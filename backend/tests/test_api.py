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


def test_property_detail(seeded):
    response = seeded.get("/api/v1/properties/NBO-0002")
    assert response.status_code == 200
    assert response.json["identity"]["id"] == "NBO-0002"
    assert response.json["dummy"] is False


def test_model_run_and_decision(client):
    api_client = client
    run_response = api_client.post("/api/v1/model-runs", json={"portfolioId": "SYN-PORT-142"})
    assert run_response.status_code == 202
    run_id = run_response.json["id"]
    decision = api_client.post(
        f"/api/v1/model-runs/{run_id}/decision",
        json={"action": "approve", "comment": "Reviewed"},
    )
    assert decision.status_code == 200
    assert decision.json["status"] == "approved"


def test_chat_contract(client):
    response = client.post("/api/v1/chat", json={"message": "Explain NBO-0002", "mode": "analysis"})
    assert response.status_code == 200
    assert response.json["dummy"] is True
    assert response.json["provider"] == "gemini"


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
