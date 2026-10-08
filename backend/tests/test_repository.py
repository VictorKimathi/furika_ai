import io

from conftest import FIXTURES

BASE = "/api/v1/portfolios/SYN-PORT-142"


def test_summary_counts_from_database(seeded):
    body = seeded.get(f"{BASE}/summary").json
    assert body["propertyCount"] == 6
    assert body["confirmedCount"] == 6
    assert body["totalInsuredValueKes"] == 18_400_000 + 72_000_000 + 48_500_000 + 12_800_000 + 24_600_000 + 94_500_000
    assert body["name"] == "Nairobi Synthetic Flood Portfolio"
    assert body["portfolioAalKes"] is None


def test_unknown_portfolio_is_404(client):
    assert client.get("/api/v1/portfolios/NOPE/summary").status_code == 404
    assert client.get("/api/v1/portfolios/NOPE/properties").status_code == 404
    assert client.get("/api/v1/properties/NOPE").status_code == 404


def test_list_filters_sort_and_pagination(seeded):
    items = seeded.get(f"{BASE}/properties?sort=tiv:desc&limit=2").json
    assert [item["id"] for item in items["items"]] == ["NBO-0594", "NBO-0091"]
    assert items["total"] == 6
    assert items["nextCursor"] == "2"
    following = seeded.get(f"{BASE}/properties?sort=tiv:desc&limit=2&cursor=2").json
    assert [item["id"] for item in following["items"]] == ["NBO-0218", "NBO-0572"]

    masonry = seeded.get(f"{BASE}/properties?housingClass=permanent_masonry&minTiv=50000000").json
    assert {item["id"] for item in masonry["items"]} == {"NBO-0091", "NBO-0594"}

    bbox = seeded.get(f"{BASE}/properties?bbox=36.85,-1.26,36.86,-1.25").json
    assert {item["id"] for item in bbox["items"]} == {"NBO-0002", "NBO-0091"}

    item = seeded.get(f"{BASE}/properties?q=NBO-0002").json["items"][0]
    assert item["hazardScores"]["common"] == 0.91
    assert item["hazardBand"] == "pending"
    assert item["reviewStatus"] == "confirmed"


def test_filters_needing_model_results_return_nothing(seeded):
    assert seeded.get(f"{BASE}/properties?hazardBand=severe").json["total"] == 0
    assert seeded.get(f"{BASE}/properties?aiFlagged=true").json["total"] == 0
    assert seeded.get(f"{BASE}/properties?nearHotspotKm=1").status_code == 400


def test_issue_count_reflects_latest_upload(seeded):
    content = (
        "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes,tiv_kes\n"
        "NBO-0002,-1.2584,36.8554,informal_iron_sheet,126,146031.75,99000000\n"
    )
    seeded.post(f"{BASE}/uploads", data={"file": (io.BytesIO(content.encode()), "update.csv"), "attestation": "synthetic"}, content_type="multipart/form-data")
    item = seeded.get(f"{BASE}/properties?q=NBO-0002").json["items"][0]
    assert item["issueCount"] == 1  # tiv_mismatch; hazard comes from the grid point at the same location
    assert item["hazardSource"] == "interpolated"
    assert item["hazardScores"]["common"] == 0.91
    detail = seeded.get("/api/v1/properties/NBO-0002").json
    assert {warning["code"] for warning in detail["explainability"]["warnings"]} == {"tiv_mismatch"}


def test_detail_has_proxy_tiers_and_context(seeded):
    detail = seeded.get("/api/v1/properties/NBO-0002").json
    tiers = detail["hazard"]["tiers"]
    assert [tier["returnPeriodYears"] for tier in tiers] == sorted(tier["returnPeriodYears"] for tier in tiers)
    assert all(tier["returnPeriodSource"] == "assumed" for tier in tiers)
    common = next(tier for tier in tiers if tier["name"] == "common")
    assert common["depthM"] == round(0.91 * 4.0, 3)
    assert detail["loss"]["aalKes"] is None
    assert detail["portfolioContext"]["propertiesWithin500m"] == 1  # NBO-0091 is ~350 m away
    assert {"method": "exact", "fields": 15} in detail["explainability"]["provenance"]


def test_clusters_group_exposure(seeded):
    clusters = seeded.get(f"{BASE}/clusters?type=neighbourhood").json["items"]
    mathare = next(item for item in clusters if item["name"] == "Mathare")
    assert mathare["propertyCount"] == 2
    assert mathare["insuredValueKes"] == 90_400_000
    assert mathare["classMix"] == {"informal": 0.5, "masonry": 0.5}
    assert seeded.get(f"{BASE}/clusters?type=bogus").status_code == 400


def test_create_property_validates_and_persists(seeded):
    created = seeded.post(f"{BASE}/properties", json={"name": "New warehouse", "latitude": -1.3071, "longitude": 36.8912, "housingClass": "permanent_masonry", "floorAreaM2": 750, "costPerM2Kes": 140000})
    assert created.status_code == 201, created.json
    assert created.json["insuredValueKes"] == 105_000_000
    assert created.json["hazardSource"] == "interpolated"
    assert created.json["reviewStatus"] == "unconfirmed"  # 1.08 km from the nearest grid point
    assert seeded.get(f"{BASE}/summary").json["propertyCount"] == 7

    bad = seeded.post(f"{BASE}/properties", json={"name": "Concrete tower", "latitude": -1.3071, "longitude": 36.8912, "housingClass": "RCC high-rise", "floorAreaM2": 750, "costPerM2Kes": 140000})
    assert bad.status_code == 422
    duplicate = seeded.post(f"{BASE}/properties", json={"id": "NBO-0002", "name": "Dup", "latitude": -1.3071, "longitude": 36.8912, "housingClass": "permanent_masonry", "floorAreaM2": 1, "costPerM2Kes": 1})
    assert duplicate.status_code == 409


def test_seed_is_idempotent(seeded, app):
    result = app.test_cli_runner().invoke(args=["seed-reference", "--file", str(FIXTURES / "reference_sample.csv")])
    assert result.exit_code == 0
    assert "already loaded" in result.output
    assert "0 reference point(s) added" in result.output


def test_seed_reports_missing_file(app):
    result = app.test_cli_runner().invoke(args=["seed-reference", "--file", "nope.csv"])
    assert result.exit_code != 0
    assert "not found" in result.output
