from datetime import date
from pathlib import Path

from app.services import chat_provider, offer
from app.extensions import db
from app.models import DocumentChunk, Upload

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
    assert analysis["accumulation"]["radiusKm"] == 1.0
    checks = offer.stage_report(analysis)
    assert [stage["key"] for stage in checks["stages"]] == [
        "data_extraction", "hazard_intensity", "vulnerability", "financial_loss",
        "accumulation", "underwriting_checks", "human_review",
    ]
    assert {stage["key"]: stage["status"] for stage in checks["stages"]}["hazard_intensity"] == "complete"
    assert any("damage ratio" in detail for stage in checks["stages"] if stage["key"] == "vulnerability" for detail in stage["details"])
    assert any("1-in-100" in detail for stage in checks["stages"] if stage["key"] == "financial_loss" for detail in stage["details"])


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


def test_offer_briefing_without_ai(seeded, monkeypatch):
    def fail(prompt):
        raise chat_provider.ChatProviderError("Claude request failed")
    monkeypatch.setattr(chat_provider, "answer", fail)
    response = seeded.post(f"{BASE}/chat", json={"message": OFFER, "context": {"portfolioId": "SYN-PORT-142"}})
    assert response.status_code == 200
    assert response.json["provider"] == "none"
    assert "## Flood model view" in response.json["answer"] and "Basement exposure not modelled" in response.json["answer"]
