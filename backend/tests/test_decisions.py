from datetime import date

from app.services import offer

BASE = "/api/v1"
OFFER = """PLACEMENT MEMORANDUM
REFERENCE: TEST-001
BROKER: Example Brokers
CLIENT: Example Holdings Ltd
STREET ADDRESS: Example Plaza, Upper Hill
GPS: -1.2921, 36.8219
TIV: KES 2.5 billion
Annual premium: KES 3,000,000
CONSTRUCTION TYPE: reinforced concrete frame
14 floors above ground + 2 basement levels
Basement levels: 1,200 m2 each
Basement 2: main switchboard, transformers and standby generators
Flood risk is minimal due to natural elevation.
Coverage includes flood. A flood deductible applies to each loss.
EXPIRY: 30 October 2026
"""


def test_offer_decision_has_numbers_at_most_five_checks_with_sources(app):
    with app.app_context():
        analysis = offer.analyse(OFFER, "SYN-PORT-142", today=date(2026, 10, 9))
        summary = offer.decision_summary(analysis, "Pasted placement offer", "offer:abc")
    assert summary["name"] == "Example Plaza, Upper Hill"
    assert summary["expiry"] == "2026-10-30"
    assert len(summary["checks"]) <= 5
    order = {"high": 0, "medium": 1, "low": 2}
    assert [order[c["severity"]] for c in summary["checks"]] == sorted(order[c["severity"]] for c in summary["checks"])
    basement = next(c for c in summary["checks"] if c["title"] == "Basement exposure not modelled")
    assert "transformers" in basement["source"]["quote"]
    # Basement flooding changes what the number means, so confidence cannot be more than low.
    assert summary["confidence"]["level"] == "low"
    assert any("proxy" in reason for reason in summary["confidence"]["reasons"])


def test_offer_decision_is_recorded_on_the_server(client):
    body = {"subjectType": "offer", "subjectRef": "offer:abc", "subjectLabel": "Example Plaza", "action": "send_back",
            "snapshot": {"loss100Kes": 1.0}, "comment": "Ask for a survey"}
    created = client.post(f"{BASE}/decisions", json=body)
    assert created.status_code == 201
    assert created.json["decidedBy"] and created.json["action"] == "send_back"
    history = client.get(f"{BASE}/decisions?subjectRef=offer:abc").json
    assert history["total"] == 1 and history["items"][0]["snapshot"] == {"loss100Kes": 1.0}
    assert client.post(f"{BASE}/decisions", json={**body, "action": "maybe"}).status_code == 400


def test_run_decision_also_writes_a_decision_record(seeded):
    run = seeded.post(f"{BASE}/model-runs", json={"portfolioId": "SYN-PORT-142"}).json
    assert seeded.post(f"{BASE}/model-runs/{run['id']}/decision", json={"action": "approve"}).status_code == 200
    history = seeded.get(f"{BASE}/decisions?subjectRef=run:{run['id']}").json
    assert history["total"] == 1 and history["items"][0]["action"] == "approve"
    assert "aalKes" in history["items"][0]["snapshot"]
