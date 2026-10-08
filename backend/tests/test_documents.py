import io
from pathlib import Path

import pytest
from docx import Document

from app.extensions import db
from app.models import DocumentChunk, DocumentFact, Property, Upload
from app.services import geocoding, llm
from app.services.geocoding import GeocodeResult

BASE = "/api/v1/portfolios/SYN-PORT-142"

MEMO = """BROKER SUBMISSION MEMO - SYNTHETIC TEST COPY
Property: Riverside Towers, Westlands
Construction: RCC frame high-rise with two basements.
Coordinates: -1.2650, 36.8050
Gross floor area 24,500 m2 (all levels).
Basement 1: 4,100 m2. Basement 2: 4,100 m2. Ground to level 10: 20,480 m2.
Rebuild cost KES 44,500 per m2.
\f
Flood cover: 5% deductible or KES 5,000,000 minimum.
Kibra is 2.1 km from the site.
Offer valid until 12/10/2025.
Recommendation: ACCEPT at standard rates.
"""


def cite(quote, page):
    return {"quote": quote, "page": page}


def field(name, value, quote, page, confidence=0.9):
    return {"field": name, "value": value, "quote": quote, "page": page, "confidence": confidence}


def fact(key, value, quote, page, kind="fact", label=""):
    return {"key": key, "label": label, "value": value, "kind": kind, "quote": quote, "page": page, "confidence": 0.9}


MEMO_RESULT = {
    "document_type": "broker submission memo",
    "buildings": [{
        "label": "Riverside Towers",
        "fields": [
            field("name", "Riverside Towers", "Property: Riverside Towers, Westlands", 1),
            field("lat", "-1.2650", "Coordinates: -1.2650, 36.8050", 1),
            field("lon", "36.8050", "Coordinates: -1.2650, 36.8050", 1),
            field("housing_class", "RCC frame high-rise", "Construction: RCC frame high-rise with two basements.", 1),
            field("floor_area_m2", "24500", "Gross floor area 24,500 m2 (all levels).", 1),
            field("cost_per_m2_kes", "44500", "Rebuild cost KES 44,500 per m2.", 1),
            field("region", "Westlands", "this quote is invented", 1),
        ],
    }],
    "facts": [
        fact("gross_floor_area", "24500", "Gross floor area 24,500 m2 (all levels).", 1),
        fact("floor_area_component", "4100", "Basement 1: 4,100 m2.", 1, label="Basement 1"),
        fact("floor_area_component", "4100", "Basement 2: 4,100 m2.", 1, label="Basement 2"),
        fact("floor_area_component", "20480", "Ground to level 10: 20,480 m2.", 1, label="Ground to level 10"),
        fact("flood_deductible", "5% or KES 5,000,000 minimum", "5% deductible or KES 5,000,000 minimum", 1, kind="term"),
        fact("distance_claim", "2.1 km", "Kibra is 2.1 km from the site.", 2, label="Kibra"),
        fact("offer_expiry", "12/10/2025", "Offer valid until 12/10/2025.", 2, kind="term"),
        fact("broker_recommendation", "Accept at standard rates", "Recommendation: ACCEPT at standard rates.", 2, kind="opinion"),
        fact("sum_insured", "1090000000", "Sum insured KES 1.09 bn", 2, kind="term"),
    ],
    "findings": [
        {"code": "ambiguous_term", "message": "The 5% deductible does not say what it is a percentage of.", "citations": [cite("5% deductible or KES 5,000,000 minimum", 2)]},
        {"code": "area_breakdown_mismatch", "message": "Areas do not add up.", "citations": [cite("Gross floor area 24,500 m2", 1)]},
        {"code": "internal_contradiction", "message": "Invented contradiction.", "citations": [cite("fuel tanks in Basement 2", 1)]},
    ],
}


class FakeClaude:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = []

    def extract_document(self, system, instructions, schema, *, pdf_bytes=None, text=None):
        self.calls.append({"pdf": pdf_bytes is not None, "text": text, "instructions": instructions})
        if self.error:
            raise self.error
        return self.result

    def json(self, system, user, schema=None):
        return {"mappings": []}


@pytest.fixture
def claude(monkeypatch):
    def install(result=None, error=None):
        fake = FakeClaude(result, error)
        monkeypatch.setattr(llm, "get_llm", lambda: fake)
        return fake
    return install


def make_pdf(pages: list[str]) -> bytes:
    """A minimal multi-page PDF with a Helvetica text layer (enough for pypdf to extract)."""
    def escape(line):
        return line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    count = len(pages)
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{' '.join(f'{4 + 2 * index} 0 R' for index in range(count))}] /Count {count} >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for index, text in enumerate(pages):
        lines = [line for line in text.split("\n") if line]
        stream = "BT /F1 11 Tf 50 750 Td 14 TL " + " ".join(f"({escape(line)}) '" for line in lines) + " ET"
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * index} 0 R >>")
        objects.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
    out, offsets = "%PDF-1.4\n", []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out.encode("latin-1")))
        out += f"{number} 0 obj\n{body}\nendobj\n"
    xref = len(out.encode("latin-1"))
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n" + "".join(f"{offset:010d} 00000 n \n" for offset in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return out.encode("latin-1")


def upload(client, content: bytes, filename: str, attestation="redacted"):
    response = client.post(f"{BASE}/uploads", data={"file": (io.BytesIO(content), filename), "attestation": attestation}, content_type="multipart/form-data")
    assert response.status_code in (200, 201), response.json
    return response.json


def issues_of(client, upload_id):
    return client.get(f"/api/v1/uploads/{upload_id}/issues").json["items"]


def test_memo_extraction_checks_quotes_and_runs_document_checks(seeded, claude, monkeypatch):
    monkeypatch.setattr(geocoding, "get_geocoder", lambda: type("G", (), {"geocode": lambda self, q: GeocodeResult(-1.3120, 36.7850, "Kibra, Nairobi", "neighbourhood")})())
    fake = claude(MEMO_RESULT)
    body = upload(seeded, MEMO.encode(), "memo.txt")
    assert body["status"] == "done", body
    assert "=== Page 2 ===" in fake.calls[0]["text"]
    summary = body["summary"]
    assert summary["pages"] == 2
    assert summary["documentType"] == "broker submission memo"
    assert summary["droppedQuotes"] == 3  # invented region quote, invented sum-insured quote, invented contradiction

    issues = issues_of(seeded, body["id"])
    codes = {item["code"] for item in issues}
    assert {"ambiguous_term", "area_breakdown_mismatch", "offer_expiring", "distance_claim_mismatch", "ai_quote_not_found"} <= codes
    assert "internal_contradiction" not in codes
    area = next(item for item in issues if item["code"] == "area_breakdown_mismatch")
    assert area["evidence"]["source"] == "check"  # the deterministic check replaced the AI finding
    assert area["evidence"]["componentsSum"] == 28680
    ambiguous = next(item for item in issues if item["code"] == "ambiguous_term")
    assert ambiguous["evidence"]["citations"][0]["page"] == 2  # cited page corrected from 1 to where the quote is
    distance = next(item for item in issues if item["code"] == "distance_claim_mismatch")
    assert distance["evidence"]["computedKm"] > 4

    facts = seeded.get(f"/api/v1/uploads/{body['id']}/facts").json["items"]
    assert {item["key"] for item in facts} >= {"broker_recommendation", "flood_deductible", "gross_floor_area"}
    assert next(item for item in facts if item["key"] == "broker_recommendation")["kind"] == "opinion"
    assert all(item["verified"] for item in facts)

    row = seeded.get(f"/api/v1/uploads/{body['id']}/rows").json["items"][0]
    assert row["status"] == "needs_review"
    assert {"class_mapped", "basement_not_modelled"} <= {item["code"] for item in row["issues"]}
    assert row["data"]["housing_class"] == "concrete_rcc"  # "RCC frame high-rise" is modelled as RCC, with a basement warning
    provenance = {item["field"]: item for item in row["provenance"]}
    assert provenance["floor_area_m2"]["method"] == "ai_extracted"
    assert provenance["floor_area_m2"]["page"] == 1
    assert provenance["floor_area_m2"]["quote"].startswith("Gross floor area")
    assert "region" not in provenance

    hits = seeded.get(f"{BASE}/documents/search?q=deductible").json["items"]
    assert hits and hits[0]["page"] == 2 and "deductible" in hits[0]["snippet"]


def test_pdf_buildings_are_unconfirmed_until_reviewed(seeded, claude):
    pdf = make_pdf(["Schedule of locations", "Site: Juja shop\nLatitude -1.2590 Longitude 36.8560\nSemi-permanent structure\nFloor area 40 m2 at KES 10,000 per m2"])
    fake = claude({"document_type": "schedule", "facts": [], "findings": [], "buildings": [{"label": "Juja shop", "fields": [
        field("name", "Juja shop", "Site: Juja shop", 1),
        field("lat", "-1.2590", "Latitude -1.2590", 1),
        field("lon", "36.8560", "Longitude 36.8560", 2),
        field("housing_class", "semi_permanent", "Semi-permanent structure", 2),
        field("floor_area_m2", "40", "Floor area 40 m2", 2),
        field("cost_per_m2_kes", "10000", "KES 10,000 per m2", 2),
    ]}]})
    body = upload(seeded, pdf, "schedule.pdf")
    assert fake.calls[0]["pdf"] is True
    row = seeded.get(f"/api/v1/uploads/{body['id']}/rows").json["items"][0]
    assert row["status"] == "accepted", row["issues"]
    assert {item["field"]: item["page"] for item in row["provenance"]}["name"] == 2
    prop_id = row["propertyId"]
    assert db.session.get(Property, prop_id).review_status == "unconfirmed"
    assert [item["id"] for item in seeded.get(f"{BASE}/review-queue").json["items"]] == [row["id"]]
    assert seeded.post(f"/api/v1/upload-rows/{row['id']}/decision", json={"action": "confirm"}).status_code == 200
    assert db.session.get(Property, prop_id).review_status == "confirmed"


def test_docx_tables_are_read(seeded, claude):
    document = Document()
    document.add_paragraph("Survey report for the Embakasi warehouse.")
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text, table.cell(0, 1).text = "Floor area", "750 m²"
    table.cell(1, 0).text, table.cell(1, 1).text = "Cost per m²", "KES 140,000"
    buffer = io.BytesIO()
    document.save(buffer)
    fake = claude({"document_type": "survey", "facts": [], "findings": [], "buildings": [{"label": "Embakasi warehouse", "fields": [
        field("floor_area_m2", "750", "Floor area | 750 m²", 1),
        field("cost_per_m2_kes", "140000", "Cost per m² | KES 140,000", 1),
        field("tiv_kes", "200000000", "Cost per m² | KES 140,000", 1),
    ]}]})
    body = upload(seeded, buffer.getvalue(), "survey.docx")
    assert "Floor area | 750 m²" in fake.calls[0]["text"]
    row = seeded.get(f"/api/v1/uploads/{body['id']}/rows").json["items"][0]
    codes = {item["code"] for item in row["issues"]}
    assert "value_not_in_quote" in codes  # TIV isn't in its quote
    assert "missing_required_field" in codes  # no housing class, no location
    assert row["data"]["floor_area_m2"] == 750


def test_without_api_key_documents_are_indexed_only(seeded):
    body = upload(seeded, MEMO.encode(), "memo.txt")
    assert body["status"] == "done"
    assert "ai_unavailable" in {item["code"] for item in issues_of(seeded, body["id"])}
    assert DocumentChunk.query.filter_by(upload_id=body["id"]).count() >= 2
    assert seeded.get(f"{BASE}/documents/search?q=Kibra").json["total"] == 1


def test_extraction_failure_is_reported(seeded, claude):
    claude(error=llm.LLMError("Claude API error 529: overloaded"))
    body = upload(seeded, MEMO.encode(), "memo.txt")
    assert body["status"] == "extraction_failed"
    assert "overloaded" in next(item for item in issues_of(seeded, body["id"]) if item["code"] == "extraction_failed")["message"]


def test_scanned_pdf_values_need_review(seeded, claude):
    claude({"document_type": "scan", "facts": [], "findings": [], "buildings": [{"label": "Scanned site", "fields": [
        field("lat", "-1.2590", "Latitude -1.2590", 1), field("lon", "36.8560", "Longitude 36.8560", 1),
        field("housing_class", "semi_permanent", "Semi-permanent", 1), field("floor_area_m2", "40", "40 m2", 1),
        field("cost_per_m2_kes", "10000", "KES 10,000", 1),
    ]}]})
    body = upload(seeded, make_pdf([""]), "scan.pdf")
    assert "no_text_layer" in {item["code"] for item in issues_of(seeded, body["id"])}
    row = seeded.get(f"/api/v1/uploads/{body['id']}/rows").json["items"][0]
    assert row["status"] == "needs_review"
    assert "quote_unverified" in {item["code"] for item in row["issues"]}


def test_document_findings_show_on_properties(seeded, claude):
    claude({"document_type": "memo", "buildings": [{"label": "Juja shop", "fields": [
        field("loc_id", "JUJA-1", "Ref JUJA-1", 1), field("lat", "-1.2590", "Latitude -1.2590", 1), field("lon", "36.8560", "Longitude 36.8560", 1),
        field("housing_class", "semi_permanent", "semi_permanent", 1), field("floor_area_m2", "40", "Floor area 40", 1), field("cost_per_m2_kes", "10000", "Rate 10000", 1),
    ]}], "facts": [], "findings": [{"code": "unsigned_declaration", "message": "The declaration is unsigned.", "citations": [cite("Signed: ________", 1)]}]})
    text = "Ref JUJA-1\nLatitude -1.2590\nLongitude 36.8560\nsemi_permanent\nFloor area 40\nRate 10000\nSigned: ________\n"
    upload(seeded, text.encode(), "memo.txt")
    detail = seeded.get("/api/v1/properties/JUJA-1").json
    warnings = {item["code"]: item for item in detail["explainability"]["warnings"]}
    assert warnings["unsigned_declaration"]["scope"] == "document"


def test_delete_upload_reverts_properties_and_removes_file(seeded, claude, app):
    content = "loc_id,lat,lon,housing_class,floor_area_m2,cost_per_m2_kes\nDEL-1,-1.2585,36.8556,semi_permanent,40,10000\nNBO-0002,-1.2584,36.8554,informal_iron_sheet,500,146031.75\n"
    body = upload(seeded, content.encode(), "batch.csv", attestation="synthetic")
    stored = Path(app.config["STORAGE_ROOT"]) / db.session.get(Upload, body["id"]).storage_path
    assert stored.is_file()
    assert float(db.session.get(Property, "NBO-0002").floor_area_m2) == 500

    assert seeded.delete(f"/api/v1/uploads/{body['id']}").status_code == 204
    assert db.session.get(Property, "DEL-1") is None
    assert float(db.session.get(Property, "NBO-0002").floor_area_m2) == 126
    assert not stored.exists()
    assert seeded.get(f"/api/v1/uploads/{body['id']}").status_code == 404
    assert DocumentFact.query.count() == 0


def test_short_text_is_not_treated_as_empty(seeded):
    body = upload(seeded, b"Flood cover: 5% deductible.", "note.txt")
    assert body["status"] == "done"
    assert "empty_file" not in {item["code"] for item in issues_of(seeded, body["id"])}


TABLE_HEADER = "loc_id lat lon housing_classfloor_area_m2cost_per_m2_kestiv_kes synthetic source hazard_score_commonhazard_score_occasionalhazard_score_moderatehazard_score_severehazard_score_extreme"
TABLE_ROWS = [
    "NBO-T1 -1.2576 36.8962 semi_permanent 33 10000 330000 TRUE generated for tests, not a real portfolio0.458406 0.407297 0.345205 0.247281 0.134603",
    "NBO-T2 -1.2023 36.93068 informal_iron_sheet16 9800 156800 TRUE generated for tests, not a real portfolio0.669771 0.638609 0.600749 0.541041 0.472337",
    "NBO-T3 -1.29874 36.87177 concrete_rcc 904 77900 7.04E+07 TRUE generated for tests, not a real portfolio0 0 0 0 0",
    "NBO-T4 -1.3149 36.93588 semi_permanent 38 13600 516800 TRUE generated for tests, not a real portfolio0.023286 0 0 0 0",
]
TABLE_LAYOUT = {"is_table": True, "header_line": TABLE_HEADER, "columns": [
    {"name": "loc_id", "type": "id"}, {"name": "lat", "type": "number"}, {"name": "lon", "type": "number"},
    {"name": "housing_class", "type": "word"}, {"name": "floor_area_m2", "type": "number"}, {"name": "cost_per_m2_kes", "type": "number"},
    {"name": "tiv_kes", "type": "number"}, {"name": "synthetic", "type": "boolean"}, {"name": "source", "type": "text"},
    *[{"name": f"hazard_score_{tier}", "type": "number"} for tier in ("common", "occasional", "moderate", "severe", "extreme")],
]}


class LayoutClaude(FakeClaude):
    def __init__(self, layout):
        super().__init__({"document_type": "x", "buildings": [], "facts": [], "findings": []})
        self.layout = layout

    def json(self, system, user, schema=None):
        if schema and "is_table" in schema["properties"]:
            return self.layout
        return {"mappings": []}


def test_pdf_table_is_parsed_row_by_row(seeded, monkeypatch):
    fake = LayoutClaude(TABLE_LAYOUT)
    monkeypatch.setattr(llm, "get_llm", lambda: fake)
    pdf = make_pdf(["\n".join([TABLE_HEADER, *TABLE_ROWS[:2]]), "\n".join(TABLE_ROWS[2:] + ["Page 2 of 2"])])
    body = upload(seeded, pdf, "exposure.pdf", attestation="synthetic")
    assert body["status"] == "done", body
    assert fake.calls == []  # the per-value document extraction was not needed
    assert body["summary"]["rows"] == 4 and body["summary"]["documentType"] == "data table"
    rows = {row["data"]["loc_id"]: row for row in seeded.get(f"/api/v1/uploads/{body['id']}/rows").json["items"]}
    assert rows["NBO-T2"]["data"]["housing_class"] == "informal_iron_sheet"
    assert rows["NBO-T2"]["data"]["floor_area_m2"] == 16
    assert rows["NBO-T1"]["data"]["hazard_score_common"] == 0.458406
    assert rows["NBO-T1"]["data"]["extra"]["source"] == "generated for tests, not a real portfolio"
    assert rows["NBO-T3"]["status"] == "accepted" and rows["NBO-T3"]["data"]["housing_class"] == "concrete_rcc"
    assert db.session.get(Property, "NBO-T1").review_status == "confirmed"
    codes = [item["code"] for item in issues_of(seeded, body["id"])]
    assert "table_detected" in codes and "unparsed_line" not in codes  # the "Page 2 of 2" footer isn't a record


def test_table_layout_that_does_not_fit_falls_back_to_document(seeded, monkeypatch):
    header = TABLE_HEADER.replace("loc_id", "Site").replace("housing_class", "Construction")  # non-standard: Claude reads the layout
    bad = {**TABLE_LAYOUT, "header_line": header, "columns": [{"name": "Site", "type": "id"}, *TABLE_LAYOUT["columns"][1:3]]}
    fake = LayoutClaude(bad)
    monkeypatch.setattr(llm, "get_llm", lambda: fake)
    body = upload(seeded, make_pdf(["\n".join([header, *TABLE_ROWS])]), "exposure.pdf", attestation="synthetic")
    assert "table_not_parsed" in {item["code"] for item in issues_of(seeded, body["id"])}
    assert len(fake.calls) == 1  # fell back to document extraction


def test_standard_header_tables_parse_without_claude(seeded):
    body = upload(seeded, make_pdf(["\n".join([TABLE_HEADER, *TABLE_ROWS])]), "exposure.pdf", attestation="synthetic")
    assert body["summary"]["rows"] == 4
    detected = next(item for item in issues_of(seeded, body["id"]) if item["code"] == "table_detected")
    assert "standard header names" in detected["message"]
    source = next(column for column in detected["evidence"]["columns"] if column["name"] == "source")
    assert source["type"] == "text"


def test_reprocess_rebuilds_rows(seeded, monkeypatch):
    header = TABLE_HEADER.replace("loc_id", "Site").replace("housing_class", "Construction")  # non-standard: needs Claude
    body = upload(seeded, make_pdf(["\n".join([header, *TABLE_ROWS])]), "exposure.pdf", attestation="synthetic")
    assert "ai_unavailable" in {item["code"] for item in issues_of(seeded, body["id"])}
    layout = {**TABLE_LAYOUT, "header_line": header, "columns": [{"name": "Site", "type": "id"}, *TABLE_LAYOUT["columns"][1:3], {"name": "Construction", "type": "word"}, *TABLE_LAYOUT["columns"][4:]]}
    class Mapper(LayoutClaude):
        def json(self, system, user, schema=None):
            if schema and "is_table" in schema["properties"]:
                return self.layout
            return {"mappings": [{"field": "loc_id", "column": "Site", "confidence": 0.95}, {"field": "housing_class", "column": "Construction", "confidence": 0.95}]}
    monkeypatch.setattr(llm, "get_llm", lambda: Mapper(layout))
    again = seeded.post(f"/api/v1/uploads/{body['id']}/reprocess")
    assert again.status_code == 202 and again.json["status"] == "done"
    assert again.json["summary"]["rows"] == 4
    assert "ai_unavailable" not in {item["code"] for item in issues_of(seeded, body["id"])}


def test_header_splitting_keeps_ordinary_words():
    from app.services.ingestion.pdf_tables import _split_header_token
    assert _split_header_token("hazard_score_extremehazard_severity") == ["hazard_score_extreme", "hazard_severity"]
    assert _split_header_token("latitude") == ["latitude"]
    assert _split_header_token("tiv_kes") == ["tiv_kes"]
