import io

import pytest

from app.extensions import db
from app.models import HazardReferencePoint, Property, ValidationIssue
from app.services import geocoding, llm
from app.services.geocoding import GeocodeResult, GeocodingError
from conftest import FIXTURES

BASE = "/api/v1/portfolios/SYN-PORT-142"
ADDRESS_HEADER = "loc_id,address,housing_class,floor_area_m2,cost_per_m2_kes"


class FakeGeocoder:
    def __init__(self, results=None, error=None):
        self.results = results or {}
        self.error = error
        self.queries = []

    def geocode(self, query):
        self.queries.append(query)
        if self.error:
            raise self.error
        for needle, result in self.results.items():
            if needle in query:
                return result
        return None


@pytest.fixture
def geocoder(monkeypatch):
    fake = FakeGeocoder({
        "Juja Road": GeocodeResult(-1.2590, 36.8560, "Juja Rd, Nairobi, Kenya", "rooftop"),
        "Mathare": GeocodeResult(-1.2600, 36.8590, "Mathare, Nairobi, Kenya", "neighbourhood"),
    })
    monkeypatch.setattr(geocoding, "get_geocoder", lambda: fake)
    return fake


@pytest.fixture
def seeded_hotspots(app, client):
    result = app.test_cli_runner().invoke(args=[
        "seed-reference", "--file", str(FIXTURES / "reference_sample.csv"), "--hotspots", str(FIXTURES / "hotspots_sample.csv"),
    ])
    assert result.exit_code == 0, result.output
    assert "Hotspots: 2 loaded; skipped 1" in result.output
    assert "6 reference point(s) added" in result.output
    return client


def upload(client, content, filename="batch.csv"):
    response = client.post(f"{BASE}/uploads", data={"file": (io.BytesIO(content.encode()), filename), "attestation": "synthetic"}, content_type="multipart/form-data")
    assert response.status_code in (200, 201), response.json
    return response.json


def rows(client, upload_id):
    return client.get(f"/api/v1/uploads/{upload_id}/rows").json["items"]


def codes(item):
    return {entry["code"] for entry in item["issues"]}


def decide(client, row_id, action, fields=None, comment=None):
    body = {"action": action}
    if fields is not None:
        body["fields"] = fields
    if comment is not None:
        body["comment"] = comment
    return client.post(f"/api/v1/upload-rows/{row_id}/decision", json=body)


def test_rooftop_geocode_and_interpolated_hazard(seeded, geocoder):
    body = upload(seeded, f"{ADDRESS_HEADER}\nG-1,12 Juja Road,semi_permanent,40,10000\n")
    item = rows(seeded, body["id"])[0]
    assert item["status"] == "accepted", item["issues"]
    provenance = {entry["field"]: entry for entry in item["provenance"]}
    assert provenance["lat"]["method"] == "geocoded"
    assert provenance["lat"]["quote"] == "Juja Rd, Nairobi, Kenya"
    assert provenance["hazard_score_common"]["method"] == "lookup"
    assert geocoder.queries == ["12 Juja Road, Nairobi, Kenya"]

    prop = db.session.get(Property, "G-1")
    assert prop.geocode_precision == "rooftop"
    assert prop.hazard_source == "interpolated"
    assert prop.review_status == "confirmed"
    assert prop.attributes["hazard_lookup"]["points"][0]["id"] in {"NBO-0002", "NBO-0091"}
    # IDW stays within the range of the neighbouring points
    assert 0.18 <= prop.attributes["hazard_scores"]["common"] <= 0.91


def test_approximate_location_needs_review_then_confirm(seeded, geocoder):
    body = upload(seeded, f"{ADDRESS_HEADER}\nG-2,Mathare,semi_permanent,40,10000\n")
    item = rows(seeded, body["id"])[0]
    assert item["status"] == "needs_review"
    assert "approximate_location" in codes(item)
    assert db.session.get(Property, "G-2") is None

    queue = seeded.get(f"{BASE}/review-queue").json
    assert [entry["id"] for entry in queue["items"]] == [item["id"]]
    assert queue["items"][0]["reason"] == "needs_review"

    confirmed = decide(seeded, item["id"], "confirm", comment="Neighbourhood centroid is fine for the demo")
    assert confirmed.status_code == 200, confirmed.json
    assert confirmed.json["status"] == "accepted_with_warnings"
    prop = db.session.get(Property, "G-2")
    assert prop.review_status == "confirmed"
    assert prop.geocode_precision == "neighbourhood"
    assert ValidationIssue.query.filter_by(code="approximate_location").one().resolution == "confirmed"
    assert seeded.get(f"{BASE}/review-queue").json["total"] == 0
    assert decide(seeded, item["id"], "confirm").status_code == 409


def test_geocoding_unavailable_then_edit_coordinates(seeded, monkeypatch):
    monkeypatch.setattr(geocoding, "get_geocoder", lambda: None)
    body = upload(seeded, f"{ADDRESS_HEADER}\nG-3,Somewhere,semi_permanent,40,10000\n")
    item = rows(seeded, body["id"])[0]
    assert codes(item) == {"geocode_failed"}
    assert decide(seeded, item["id"], "confirm").status_code == 409

    edited = decide(seeded, item["id"], "edit", {"lat": -1.2585, "lon": 36.8556})
    assert edited.status_code == 200, edited.json
    assert edited.json["status"] == "accepted"
    assert {entry["field"]: entry["method"] for entry in edited.json["provenance"]}["lat"] == "user"
    assert "geocode_failed" not in codes(edited.json)
    assert db.session.get(Property, "G-3").review_status == "confirmed"
    assert ValidationIssue.query.filter_by(code="geocode_failed").one().resolution == "superseded"


def test_geocoder_error_is_review_not_crash(seeded, monkeypatch):
    monkeypatch.setattr(geocoding, "get_geocoder", lambda: FakeGeocoder(error=GeocodingError("OVER_QUERY_LIMIT")))
    item = rows(seeded, upload(seeded, f"{ADDRESS_HEADER}\nG-4,Juja Road,semi_permanent,40,10000\n")["id"])[0]
    assert item["status"] == "needs_review"
    assert "OVER_QUERY_LIMIT" in item["issues"][0]["message"]


def test_no_coordinates_and_no_address_is_error(seeded, geocoder):
    item = rows(seeded, upload(seeded, "loc_id,housing_class,floor_area_m2,cost_per_m2_kes\nG-5,semi_permanent,40,10000\n")["id"])[0]
    assert item["status"] == "rejected"
    assert "missing_required_field" in codes(item)


def test_far_from_grid_needs_review(seeded):
    item = rows(seeded, upload(seeded, "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes\nFAR-1,-1.45,36.95,semi_permanent,40,10000\n")["id"])[0]
    assert codes(item) == {"hazard_far_from_grid"}
    assert decide(seeded, item["id"], "confirm").status_code == 200
    assert db.session.get(Property, "FAR-1").hazard_source == "interpolated"


def test_non_monotonic_scores_and_duplicate_location(seeded):
    header = "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes,hazard_score_common,hazard_score_occasional,hazard_score_moderate,hazard_score_severe,hazard_score_extreme"
    content = f"{header}\nM-1,-1.2700,36.8300,semi_permanent,40,10000,0.10,0.20,0.30,0.40,0.50\nM-2,-1.2700,36.8300,semi_permanent,40,10000,0.5,0.4,0.3,0.2,0.1\n"
    first, second = rows(seeded, upload(seeded, content)["id"])
    assert "hazard_non_monotonic" in codes(first)
    assert codes(second) == {"duplicate_location"}
    assert second["status"] == "accepted_with_warnings"


def test_cost_outlier_uses_reference_costs(seeded):
    for index in range(5):
        db.session.add(HazardReferencePoint(id=f"REF-{index}", latitude=-1.40, longitude=36.95 + index / 1000, scores={"common": 0.1, "occasional": 0.1, "moderate": 0.1, "severe": 0.1, "extreme": 0.1}, housing_class="semi_permanent", cost_per_m2_kes=10000))
    db.session.commit()
    content = "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes\nC-1,-1.2585,36.8556,semi_permanent,40,90000\n"
    item = rows(seeded, upload(seeded, content)["id"])[0]
    assert "cost_outlier" in codes(item)


def test_hotspots_are_attached_and_filterable(seeded_hotspots):
    client = seeded_hotspots
    near = client.get(f"{BASE}/properties?nearHotspotKm=1").json
    assert {item["id"] for item in near["items"]} == {"NBO-0002", "NBO-0091", "NBO-0218"}
    detail = client.get("/api/v1/properties/NBO-0002").json
    assert detail["hazard"]["nearestHotspot"]["name"] == "Mathare River crossing"
    assert detail["hazard"]["nearestHotspotKm"] < 0.3


def test_reject_restores_previous_version_or_removes(seeded):
    update = "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes\nNBO-0002,-1.2584,36.8554,informal_iron_sheet,200,146031.75\n"
    row = rows(seeded, upload(seeded, update)["id"])[0]
    assert float(db.session.get(Property, "NBO-0002").floor_area_m2) == 200
    assert decide(seeded, row["id"], "reject").status_code == 200
    restored = db.session.get(Property, "NBO-0002")
    assert float(restored.floor_area_m2) == 126
    assert restored.hazard_source == "supplied"

    new = rows(seeded, upload(seeded, "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes\nNEW-1,-1.2585,36.8556,semi_permanent,40,10000\n")["id"])[0]
    assert db.session.get(Property, "NEW-1") is not None
    decide(seeded, new["id"], "reject")
    assert db.session.get(Property, "NEW-1") is None
    assert decide(seeded, new["id"], "reject").status_code == 409


def test_unsupported_construction_requires_edit(seeded):
    content = "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes\nRCC-1,-1.2585,36.8556,Steel frame,2400,90000\n"
    item = rows(seeded, upload(seeded, content)["id"])[0]
    response = decide(seeded, item["id"], "confirm")
    assert response.status_code == 409
    assert "unsupported_construction" in response.json["message"]
    edited = decide(seeded, item["id"], "edit", {"housing_class": "permanent_masonry"})
    assert edited.json["status"] == "accepted"
    assert db.session.get(Property, "RCC-1").housing_class == "permanent_masonry"


def test_edit_can_fix_or_break_a_row(seeded):
    item = rows(seeded, upload(seeded, "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes\nE-1,-1.2585,36.8556,semi_permanent,abc,10000\n")["id"])[0]
    assert item["status"] == "rejected"
    assert decide(seeded, item["id"], "confirm").status_code == 409
    fixed = decide(seeded, item["id"], "edit", {"floor_area_m2": "40"})
    assert fixed.json["status"] == "accepted"
    assert db.session.get(Property, "E-1") is not None

    broken = decide(seeded, item["id"], "edit", {"housing_class": "wooden_hut"})
    assert broken.json["status"] == "rejected"
    assert db.session.get(Property, "E-1") is None  # the only version came from this row
    assert decide(seeded, item["id"], "edit", {"loc_id": "E-2"}).status_code == 200  # not live any more, so the ID can change
    assert decide(seeded, item["id"], "edit", {"synthetic": "false"}).status_code == 400


def test_loc_id_is_locked_once_live(seeded):
    item = rows(seeded, upload(seeded, "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes\nL-1,-1.2585,36.8556,semi_permanent,40,10000\n")["id"])[0]
    assert decide(seeded, item["id"], "edit", {"loc_id": "L-2"}).status_code == 400


def test_low_confidence_mapping_is_queued_and_confirmable(seeded, monkeypatch):
    class LowConfidence:
        def json(self, system, user, schema=None):
            pairs = [("loc_id", "Site"), ("lat", "Y"), ("lon", "X"), ("housing_class", "Type"), ("floor_area_m2", "Area"), ("cost_per_m2_kes", "Rate")]
            return {"mappings": [{"field": field, "column": column, "confidence": 0.6} for field, column in pairs]}

    monkeypatch.setattr(llm, "get_llm", lambda: LowConfidence())
    item = rows(seeded, upload(seeded, "Site,Y,X,Type,Area,Rate\nLC-1,-1.2585,36.8556,semi_permanent,40,10000\n")["id"])[0]
    queue = seeded.get(f"{BASE}/review-queue").json["items"]
    assert [(entry["id"], entry["reason"]) for entry in queue] == [(item["id"], "unconfirmed")]
    assert decide(seeded, item["id"], "confirm").status_code == 200
    assert db.session.get(Property, "LC-1").review_status == "confirmed"
    assert seeded.get(f"{BASE}/review-queue").json["total"] == 0


def test_geocode_route(client, monkeypatch, geocoder):
    found = client.get("/api/v1/locations/geocode?q=Juja Road")
    assert found.status_code == 200
    assert found.json["precision"] == "rooftop"
    assert client.get("/api/v1/locations/geocode?q=Atlantis").status_code == 404
    monkeypatch.setattr(geocoding, "get_geocoder", lambda: None)
    assert client.get("/api/v1/locations/geocode?q=Juja Road").status_code == 503


def test_manual_property_can_be_geocoded(seeded, geocoder):
    created = seeded.post(f"{BASE}/properties", json={"name": "Juja shop", "address": "Juja Road", "housingClass": "semi_permanent", "floorAreaM2": 40, "costPerM2Kes": 10000})
    assert created.status_code == 201, created.json
    assert created.json["latitude"] == -1.2590
    assert created.json["geocodePrecision"] == "rooftop"
