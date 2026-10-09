from datetime import date
from pathlib import Path

from app.services import chat_provider, offer
from app.extensions import db
from app.models import DocumentChunk, HazardReferencePoint, ModelRun, Upload

BASE = "/api/v1"
OFFER = (Path(__file__).parent / "fixtures" / "placement_offer.txt").read_text()


def test_recognises_offers_but_not_ordinary_questions():
    assert offer.is_offer(OFFER)
    assert not offer.is_offer("What is the AAL for NBO-0002 and the broker's premium?")


def test_extracts_risk_facts_with_quotes():
    facts = offer.parse(OFFER)
    assert facts["coordinates"]["value"] == {"lat": -1.2847, "lon": 36.8247}
    assert facts["coordinates"]["ambiguous"]  # "-1.2847°S" uses a minus sign and S
    assert facts["tivKes"]["value"] == 1_090_000_000
    assert facts["housingClass"]["value"] == "concrete_rcc"
    assert facts["floorsAbove"]["value"] == 18 and facts["basements"]["value"] == 2
    assert facts["floodLimit"]["value"] == "Flood limit can be set at full TIV (KES 1,090,000,000) with confidence."
    assert any("chiller" in item for item in facts["basementPlant"])
    assert facts["expiry"]["value"] == "2026-10-12"


def test_redacts_people_but_keeps_companies():
    text, count = offer.redact(OFFER)
    for secret in ("James Kipchoge", "Rajesh Patel", "Jane Mwangi", "@eastside-brokers.co.ke", "555-0147", "r.patel@"):
        assert secret not in text
    assert "Eastside Insurance Brokers Ltd" in text and "Landmark Realty Investment Limited" in text
    assert count >= 8


def test_scores_the_site_and_flags_conflicts(seeded):
    analysis = offer.analyse(OFFER, "SYN-PORT-142", today=date(2026, 10, 8))
    assert analysis["inNairobi"] and analysis["hazard"]["scores"]
    titles = {flag["title"] for flag in analysis["flags"]}
    assert {"Basement exposure not modelled", "Elevation claim is implausible", "High-rise outside the calibrated range", "Short deadline"} <= titles
    if analysis["model"]["annualFloodProbability"] >= 0.01:
        assert "Broker's flood view conflicts with the model" in titles
    assert "accumulation" not in analysis  # one offer does not automatically use portfolio CSV exposures
    checks = offer.stage_report(analysis)
    assert [stage["key"] for stage in checks["stages"]] == [
        "data_extraction", "hazard_intensity", "vulnerability", "financial_loss",
        "accumulation", "underwriting_checks", "human_review",
    ]
    assert {stage["key"]: stage["status"] for stage in checks["stages"]}["hazard_intensity"] == "complete"
    assert {stage["key"]: stage["status"] for stage in checks["stages"]}["accumulation"] == "blocked"
    assert any("damage ratio" in detail for stage in checks["stages"] if stage["key"] == "vulnerability" for detail in stage["details"])
    assert any("1-in-100" in detail for stage in checks["stages"] if stage["key"] == "financial_loss" for detail in stage["details"])
    visuals = {stage["key"]: stage["visual"] for stage in checks["stages"]}
    assert visuals["hazard_intensity"]["type"] == "bars"
    assert visuals["hazard_intensity"]["rows"][0]["value"] == analysis["model"]["tiers"][0]["score"]
    assert visuals["vulnerability"]["rows"][0]["value"] == analysis["model"]["tiers"][0]["damageRatio"]
    assert visuals["financial_loss"]["rows"][0]["value"] == analysis["model"]["tiers"][0]["lossKes"]
    assert visuals["underwriting_checks"]["type"] == "findings"


def test_missing_coordinates_block_hazard_and_vulnerability(seeded):
    analysis = offer.analyse(OFFER.replace("GPS COORDINATES: -1.2847°S, 36.8247°E", "GPS COORDINATES: unavailable"), "SYN-PORT-142")
    statuses = {stage["key"]: stage["status"] for stage in offer.stage_report(analysis)["stages"]}
    assert statuses["hazard_intensity"] == "blocked"
    assert statuses["vulnerability"] == "blocked"
    assert statuses["financial_loss"] == "blocked"


def test_chat_answers_a_pasted_offer_without_leaking_contacts(seeded, monkeypatch):
    seen = {}
    monkeypatch.setattr(chat_provider, "answer", lambda prompt: (seen.setdefault("prompt", prompt) and "Briefing", "claude", "claude-opus-5-5"))
    response = seeded.post(f"{BASE}/chat", json={"message": OFFER, "context": {"portfolioId": "SYN-PORT-142"}})
    assert response.status_code == 200, response.json
    assert "## Hazard intensity" in response.json["answer"]
    assert "## Vulnerability" in response.json["answer"]
    assert "## Financial loss" in response.json["answer"]
    assert "## Additional AI interpretation\nBriefing" in response.json["answer"]
    assert response.json["asset"]["kind"] == "offer" and response.json["asset"]["lat"] == -1.2847
    assert response.json["workflow"] is None  # an offer does not start a portfolio model run
    assert response.json["offerChecks"]["status"] == "review"
    prompt = seen["prompt"]
    assert "Furika flood model for this building" in prompt and "Checks (severity: finding)" in prompt
    assert "Jane Mwangi" not in prompt and "jmwangi@" not in prompt
    assert "Highest insured values" not in prompt and "Portfolio context:" not in prompt
    assert "reference_sample.csv" not in prompt


def test_offer_follow_up_stays_on_one_pasted_offer_without_starting_portfolio_run(seeded, monkeypatch):
    seen = {}
    monkeypatch.setattr(chat_provider, "answer", lambda prompt: (seen.setdefault("prompt", prompt) and "Offer-specific answer", "openai", "gpt-6-luna"))
    response = seeded.post(f"{BASE}/chat", json={
        "message": "What is the vulnerability of this one building?",
        "context": {"portfolioId": "SYN-PORT-142", "offerText": OFFER, "uploadIds": []},
    })
    assert response.status_code == 200, response.json
    assert response.json["workflow"] is None
    assert response.json["offerChecks"]["type"] == "placement_offer"
    assert "Underwriter's follow-up question about this offer: What is the vulnerability" in seen["prompt"]
    assert "reference_sample.csv" not in seen["prompt"]
    assert "Highest insured values" not in seen["prompt"]
    assert "Portfolio accumulation within" not in seen["prompt"]
    assert ModelRun.query.count() == 0


def test_missing_or_mixed_offer_context_never_falls_back_to_portfolio(seeded, monkeypatch):
    monkeypatch.setattr(chat_provider, "answer", lambda _prompt: (_ for _ in ()).throw(AssertionError("Portfolio AI must not run")))
    for context in (
        {"offerText": ""},
        {"offerUploadId": ""},
        {"offerText": OFFER, "uploadIds": ["reference_sample.csv"]},
    ):
        response = seeded.post(f"{BASE}/chat", json={
            "message": "What is the flood risk for this one offer?",
            "context": {"portfolioId": "SYN-PORT-142", **context},
        })
        assert response.status_code == 400, response.json
    assert ModelRun.query.count() == 0


def test_portfolio_accumulation_is_only_added_when_explicitly_requested(seeded, monkeypatch):
    seen = {}
    monkeypatch.setattr(chat_provider, "answer", lambda prompt: (seen.setdefault("prompt", prompt) and "Offer answer", "openai", "gpt-6-luna"))
    offer_only = seeded.post(f"{BASE}/chat", json={
        "message": "Explain the accumulation check for this one offer.",
        "context": {"portfolioId": "SYN-PORT-142", "offerText": OFFER},
    })
    assert offer_only.status_code == 200, offer_only.json
    assert "Portfolio accumulation within" not in seen["prompt"]
    assert {stage["key"]: stage["status"] for stage in offer_only.json["offerChecks"]["stages"]}["accumulation"] == "blocked"
    seen.clear()
    response = seeded.post(f"{BASE}/chat", json={
        "message": "Compare this offer's accumulation with nearby insured properties.",
        "context": {"portfolioId": "SYN-PORT-142", "offerText": OFFER},
    })
    assert response.status_code == 200, response.json
    assert "Portfolio accumulation within" in seen["prompt"] or "No portfolio properties within" in seen["prompt"]
    stages = {stage["key"]: stage for stage in response.json["offerChecks"]["stages"]}
    assert stages["accumulation"]["status"] == "complete"


def test_uploaded_placement_document_runs_all_offer_checks(seeded, monkeypatch):
    monkeypatch.setattr(chat_provider, "answer", lambda _prompt: ("Interpretation", "claude", "test-model"))
    with seeded.application.app_context():
        source = Upload(id="placement-source", portfolio_id="SYN-PORT-142", filename="placement.txt", size_bytes=len(OFFER),
                        sha256="f" * 64, storage_path="test/placement.txt", status="done", attestation="synthetic", extractor="text", summary={})
        db.session.add(source)
        db.session.flush()
        db.session.add(DocumentChunk(upload_id=source.id, portfolio_id=source.portfolio_id, page=1, chunk_index=0, text=OFFER))
        db.session.commit()
    response = seeded.post(f"{BASE}/chat", json={"message": "Run the vulnerability and flood checks", "context": {"portfolioId": "SYN-PORT-142", "uploadIds": ["placement-source"]}})
    assert response.status_code == 200, response.json
    assert response.json["workflow"] is None
    assert response.json["source"].startswith("placement.txt")
    assert response.json["offerChecks"]["stages"][1]["key"] == "hazard_intensity"
    assert response.json["offerChecks"]["stages"][2]["key"] == "vulnerability"
    assert response.json["offerChecks"]["stages"][3]["key"] == "financial_loss"
    follow_up = seeded.post(f"{BASE}/chat", json={"message": "What should the deductible be for this offer?", "context": {"portfolioId": "SYN-PORT-142", "offerUploadId": "placement-source"}})
    assert follow_up.status_code == 200, follow_up.json
    assert follow_up.json["workflow"] is None
    assert follow_up.json["source"].startswith("placement.txt")
    assert follow_up.json["offerChecks"]["type"] == "placement_offer"


def test_offer_does_not_use_portfolio_properties_as_missing_hazard_reference(seeded):
    HazardReferencePoint.query.delete()
    db.session.commit()
    analysis = offer.analyse(OFFER, "SYN-PORT-142")
    assert "model" not in analysis
    assert {stage["key"]: stage["status"] for stage in offer.stage_report(analysis)["stages"]}["hazard_intensity"] == "blocked"


def test_offer_briefing_without_ai(seeded, monkeypatch):
    def fail(prompt):
        raise chat_provider.ChatProviderError("Claude request failed")
    monkeypatch.setattr(chat_provider, "answer", fail)
    response = seeded.post(f"{BASE}/chat", json={"message": OFFER, "context": {"portfolioId": "SYN-PORT-142"}})
    assert response.status_code == 200
    assert response.json["provider"] == "none"
    assert "## Flood model view" in response.json["answer"] and "Basement exposure not modelled" in response.json["answer"]
