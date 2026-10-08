import hashlib
import io
import os
import stat

import pandas as pd

from app.extensions import db
from app.models import FieldProvenance, Property, Upload
from app.services import gemini


PORTFOLIO = "SYN-PORT-TEST"
HEADER = "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes,tiv_kes,hazard_score_common,hazard_score_occasional,hazard_score_moderate,hazard_score_severe,hazard_score_extreme"


def row(loc_id="NBO-T-001", lat="-1.2576", lon="36.8962", housing_class="semi_permanent", area="33", cost="10000", tiv="330000", scores="0.45,0.40,0.34,0.24,0.13"):
    return f"{loc_id},{lat},{lon},{housing_class},{area},{cost},{tiv},{scores}"


class FakeLLM:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = []

    def json(self, system, user):
        self.calls.append(user)
        if self.error:
            raise self.error
        return self.response


def post(client, content, filename="exposure.csv", attestation="synthetic", portfolio=PORTFOLIO):
    data = {"file": (io.BytesIO(content if isinstance(content, bytes) else content.encode()), filename)}
    if attestation is not None:
        data["attestation"] = attestation
    return client.post(f"/api/v1/portfolios/{portfolio}/uploads", data=data, content_type="multipart/form-data")


def rows_of(client, upload_id):
    return client.get(f"/api/v1/uploads/{upload_id}/rows").json["items"]


def codes(item):
    return {issue["code"] for issue in item["issues"]}


def test_exact_csv_is_stored_and_promoted(client, app):
    content = "\n".join([HEADER, row(), row(loc_id="NBO-T-002", lat="-1.2600")]) + "\n"
    response = post(client, content)
    assert response.status_code == 201, response.json
    body = response.json
    assert body["status"] == "done"
    assert body["summary"]["byStatus"] == {"accepted": 2}
    assert body["sha256"] == hashlib.sha256(content.encode()).hexdigest()

    stored = os.path.join(app.config["STORAGE_ROOT"], db.session.get(Upload, body["id"]).storage_path)
    assert open(stored, "rb").read() == content.encode()
    assert not os.stat(stored).st_mode & stat.S_IWUSR

    prop = db.session.get(Property, "NBO-T-001")
    assert prop.review_status == "confirmed"
    assert prop.hazard_source == "supplied"
    assert prop.attributes["hazard_scores"]["common"] == 0.45
    assert prop.upload_id == body["id"]

    provenance = client.get("/api/v1/properties/NBO-T-001/provenance").json
    methods = {item["field"]: item["method"] for item in provenance["current"]}
    assert methods["lat"] == "exact"
    assert methods["synthetic"] == "user"

    original = client.get(f"/api/v1/uploads/{body['id']}/original")
    assert original.data == content.encode()


def test_duplicate_upload_returns_existing(client):
    content = "\n".join([HEADER, row()]) + "\n"
    first = post(client, content)
    second = post(client, content)
    assert second.status_code == 200
    assert second.json["duplicate"] is True
    assert second.json["id"] == first.json["id"]
    assert Upload.query.count() == 1


def test_attestation_is_required(client):
    response = post(client, "\n".join([HEADER, row()]), attestation=None)
    assert response.status_code == 400
    assert Upload.query.count() == 0


def test_extension_must_match_content(client):
    response = post(client, b"not a pdf", filename="memo.pdf")
    assert response.status_code == 400
    assert response.json["error"] == "wrong_type"
    assert post(client, b"a,b", filename="data.exe").json["error"] == "wrong_type"


def test_pdf_is_stored_until_extractor_exists(client):
    response = post(client, b"%PDF-1.7\n...", filename="memo.pdf", attestation="redacted")
    assert response.status_code == 201
    assert response.json["status"] == "pending_extractor"


def test_row_level_errors_are_coded(client):
    content = "\n".join([
        HEADER,
        row(loc_id="A", housing_class="wooden_hut"),
        row(loc_id="B", lat="-3.5"),
        row(loc_id="C", area="abc"),
        row(loc_id="D", scores="0.45,0.40,0.34,0.24,1.7"),
        row(loc_id="E"),
        row(loc_id="E"),
        row(loc_id="F", housing_class="RCC high-rise"),
        row(loc_id="G", tiv="900000"),
    ]) + "\n"
    body = post(client, content).json
    items = {item["data"]["loc_id"] + str(item["position"]): item for item in rows_of(client, body["id"])}
    assert "invalid_class" in codes(items["A0"])
    assert "outside_bounds" in codes(items["B1"])
    assert "non_numeric" in codes(items["C2"])
    assert "score_out_of_range" in codes(items["D3"])
    assert items["E4"]["status"] == "accepted"
    assert "duplicate_loc_id" in codes(items["E5"])
    assert items["F6"]["status"] == "needs_review"
    assert "unsupported_construction" in codes(items["F6"])
    assert items["G7"]["status"] == "accepted_with_warnings"
    assert "tiv_mismatch" in codes(items["G7"])

    assert {prop.id for prop in Property.query} == {"E", "G"}
    assert body["summary"]["byStatus"] == {"rejected": 5, "accepted": 1, "needs_review": 1, "accepted_with_warnings": 1}


def test_tiv_derived_and_hazard_optional(client):
    content = "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes\nNBO-T-9,-1.2576,36.8962,permanent masonry,\"1,200\",KES 10000\n"
    body = post(client, content).json
    item = rows_of(client, body["id"])[0]
    assert item["status"] == "accepted_with_warnings"
    assert codes(item) == {"hazard_missing"}
    assert item["data"]["tiv_kes"] == 12_000_000
    assert item["data"]["housing_class"] == "permanent_masonry"
    tiv = next(entry for entry in item["provenance"] if entry["field"] == "tiv_kes")
    assert tiv["method"] == "derived"
    prop = db.session.get(Property, "NBO-T-9")
    assert prop.hazard_source == "missing"
    assert prop.review_status == "confirmed"


def test_partial_hazard_scores_rejected(client):
    content = "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes,hazard_score_common\nX,-1.2576,36.8962,semi_permanent,33,10000,0.4\n"
    item = rows_of(client, post(client, content).json["id"])[0]
    assert item["status"] == "rejected"
    assert "missing_required_field" in codes(item)


RENAMED = "Site ID,Latitude,Longitude,Construction,Area (sqm),Rate KES/m2,Sum Insured,Notes\nR-1,-1.2576,36.8962,semi_permanent,33,10000,330000,near river\n"


def renamed_mapping(confidence):
    pairs = [("loc_id", "Site ID"), ("lat", "Latitude"), ("lon", "Longitude"), ("housing_class", "Construction"),
             ("floor_area_m2", "Area (sqm)"), ("cost_per_m2_kes", "Rate KES/m2"), ("tiv_kes", "Sum Insured")]
    return {"mappings": [{"field": field, "column": column, "confidence": confidence} for field, column in pairs]}


def test_high_confidence_ai_mapping_is_confirmed(client, monkeypatch):
    llm = FakeLLM(renamed_mapping(0.95))
    monkeypatch.setattr(gemini, "get_llm", lambda: llm)
    body = post(client, RENAMED).json
    assert body["summary"]["mapping"]["lat"]["method"] == "ai_mapped"
    assert body["summary"]["unmappedColumns"] == ["Notes"]
    prop = db.session.get(Property, "R-1")
    assert prop.review_status == "confirmed"
    assert prop.attributes["extra"] == {"Notes": "near river"}
    assert FieldProvenance.query.filter_by(method="ai_mapped", source_column="Latitude").count() == 1


def test_low_confidence_ai_mapping_is_unconfirmed(client, monkeypatch):
    monkeypatch.setattr(gemini, "get_llm", lambda: FakeLLM(renamed_mapping(0.6)))
    post(client, RENAMED)
    assert db.session.get(Property, "R-1").review_status == "unconfirmed"


def test_invented_ai_columns_are_ignored(client, monkeypatch):
    response = renamed_mapping(0.95)
    response["mappings"][0]["column"] = "Building Reference"  # not a real header
    monkeypatch.setattr(gemini, "get_llm", lambda: FakeLLM(response))
    body = post(client, RENAMED).json
    assert "loc_id" in body["summary"]["unmappedFields"]
    assert body["summary"]["byStatus"] == {"rejected": 1}


def test_ai_failure_falls_back_to_exact(client, monkeypatch):
    monkeypatch.setattr(gemini, "get_llm", lambda: FakeLLM(error=TimeoutError("timed out")))
    body = post(client, RENAMED).json
    assert body["status"] == "done"
    issues = client.get(f"/api/v1/uploads/{body['id']}/issues").json["items"]
    assert "ai_mapping_unavailable" in {item["code"] for item in issues}


def test_reupload_updates_existing_property(client):
    post(client, "\n".join([HEADER, row()]) + "\n")
    body = post(client, "\n".join([HEADER, row(area="40", tiv="400000")]) + "\n").json
    item = rows_of(client, body["id"])[0]
    assert "updates_existing" in codes(item)
    assert float(db.session.get(Property, "NBO-T-001").floor_area_m2) == 40
    history = client.get("/api/v1/properties/NBO-T-001/provenance").json["history"]
    assert len(history) == 2


def test_loc_id_in_other_portfolio_conflicts(client):
    post(client, "\n".join([HEADER, row()]) + "\n")
    body = post(client, "\n".join([HEADER, row()]) + "\n", portfolio="OTHER").json
    assert "loc_id_conflict" in codes(rows_of(client, body["id"])[0])


def test_excel_picks_matching_sheet(client):
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        pd.DataFrame({"note": ["cover sheet"]}).to_excel(writer, sheet_name="Cover", index=False)
        frame = pd.read_csv(io.StringIO("\n".join([HEADER, row()])))
        frame.to_excel(writer, sheet_name="Exposure", index=False)
    body = post(client, buffer.getvalue(), filename="book.xlsx").json
    assert body["summary"]["sheet"] == "Exposure"
    assert body["summary"]["byStatus"] == {"accepted": 1}
    assert rows_of(client, body["id"])[0]["rowRef"] == "Exposure row 2"
