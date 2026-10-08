"""Document ingestion (PDF, DOCX, TXT/MD): text index, Claude extraction, quote checks, document checks.

Every AI-extracted value must carry a verbatim quote that is found on the cited page of the
document's own text layer. Values whose quote can't be found are dropped. Buildings found in
the document go through the same row evaluation as spreadsheet rows; they stay unconfirmed
until a reviewer confirms them because `ai_extracted` is never auto-confirmed.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from ...extensions import db
from ...models import DocumentChunk, DocumentFact, Upload, ValidationIssue
from .. import furika_model as fm
from .. import geocoding
from .. import llm as llm_service
from . import pdf_tables
from .mapping import FIELD_DESCRIPTIONS
from .validation import CANONICAL_FIELDS, issue, parse_number

CHUNK_CHARS = 1500
MAX_TEXT_CHARS = 600_000
MAX_PDF_PAGES = 600
MIN_TEXT_LAYER_CHARS = 50
QUOTE_MIN_CHARS = 4
AREA_TOLERANCE = 0.02
EXPIRY_WARNING_DAYS = 14
DISTANCE_TOLERANCE_KM = 0.5
DISTANCE_TOLERANCE_RATIO = 0.3

EXTRACTABLE_FIELDS = [name for name in CANONICAL_FIELDS if name != "synthetic"]
FACT_KEYS = [
    "gross_floor_area", "floor_area_component", "sum_insured", "valuation_basis", "flood_deductible", "policy_limit",
    "offer_expiry", "declaration_signed", "loss_event", "broker_recommendation", "construction_type", "storeys",
    "basement_levels", "critical_equipment_location", "distance_claim", "elevation_claim", "water_consumption", "other",
]
FINDING_CODES = [
    "internal_contradiction", "unit_inconsistency", "missing_valuation_basis", "ambiguous_term",
    "unsigned_declaration", "loss_history_gap", "elevation_claim_implausible", "area_breakdown_mismatch",
]
FACT_KINDS = ["fact", "term", "claim", "opinion"]


def _object(properties: dict) -> dict:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


CITED = {"quote": {"type": "string"}, "page": {"type": "integer"}}
EXTRACTION_SCHEMA = _object({
    "document_type": {"type": "string"},
    "buildings": {"type": "array", "items": _object({
        "label": {"type": "string"},
        "fields": {"type": "array", "items": _object({
            "field": {"type": "string", "enum": EXTRACTABLE_FIELDS},
            "value": {"type": "string"},
            **CITED,
            "confidence": {"type": "number"},
        })},
    })},
    "facts": {"type": "array", "items": _object({
        "key": {"type": "string", "enum": FACT_KEYS},
        "label": {"type": "string"},
        "value": {"type": "string"},
        "kind": {"type": "string", "enum": FACT_KINDS},
        **CITED,
        "confidence": {"type": "number"},
    })},
    "findings": {"type": "array", "items": _object({
        "code": {"type": "string", "enum": FINDING_CODES},
        "message": {"type": "string"},
        "citations": {"type": "array", "items": _object(CITED)},
    })},
})

SYSTEM = (
    "You extract property exposure data from insurance documents (broker memos, survey reports, schedules) "
    "for a flood catastrophe model in Nairobi. Every value you return must be supported by a quote copied "
    "verbatim from the document. Never infer or invent values."
)

INSTRUCTIONS = """Extract the following from the document above.

Page numbers: {page_note}

buildings: one entry per insured building or site. For each field the document states, give:
- value: the value as a plain string; numbers without thousands separators or currency symbols, in the field's unit only if the document states it in that unit.
- quote: an exact, contiguous excerpt (under 200 characters) copied from the document that contains the value.
- page and confidence (0-1).
Omit fields the document does not state. Field meanings:
{fields}
For housing_class, use the document's own construction description (for example "RCC frame high-rise") unless it clearly is one of: informal_iron_sheet, semi_permanent, permanent_masonry.

facts: document-level statements that are not per-building fields. kind is one of:
- fact: a descriptive or physical statement;
- term: a policy or contract term (deductibles, limits, expiry dates);
- claim: an assertion that draws a conclusion, for example about risk or protection;
- opinion: a recommendation or judgement, for example a broker's acceptance recommendation.
Use floor_area_component once per part of the building (label = the part, value = area in m²). Use distance_claim once per distance the document states to a named place (label = the place, value such as "2.1 km"). Use loss_event once per incident (value includes the date). Use other with a descriptive label for anything else material to flood risk.

findings: problems a careful underwriter would raise, only when quotes support them: contradictions between statements, inconsistent units, values with no stated basis (for example a sum insured without a valuation basis), ambiguous terms (for example a percentage deductible that does not say what it is a percentage of), unsigned declarations, incidents mentioned in the text but missing from the stated loss history, and physically implausible claims. Cite every quote involved.

If the document has nothing about property exposure, return empty lists."""


def normalise(text: str) -> str:
    """Lower-case, NFKC, punctuation as spaces (decimal points kept) so quotes survive text-layer quirks."""
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"(?<!\d)\.|\.(?!\d)", " ", text)
    return " ".join(re.sub(r"[^\w.]+", " ", text).split())


def read_pages(path: Path, extractor: str) -> list[str]:
    if extractor == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(path)
        if len(reader.pages) > MAX_PDF_PAGES:
            raise ValueError(f"The PDF has {len(reader.pages)} pages; the limit is {MAX_PDF_PAGES}.")
        return [page.extract_text() or "" for page in reader.pages]
    if extractor == "docx":
        from docx import Document
        from docx.table import Table
        from docx.text.paragraph import Paragraph

        document = Document(path)
        lines = []
        for child in document.element.body.iterchildren():
            tag = child.tag.rsplit("}", 1)[-1]
            if tag == "p":
                lines.append(Paragraph(child, document).text)
            elif tag == "tbl":
                for table_row in Table(child, document).rows:
                    lines.append(" | ".join(cell.text.strip() for cell in table_row.cells))
        return ["\n".join(lines)]
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    return text.split("\f")


def chunk_pages(pages: list[str]) -> list[tuple[int, str]]:
    """Split each page into ~CHUNK_CHARS chunks on paragraph boundaries. Returns (page, text)."""
    chunks = []
    for number, page in enumerate(pages, start=1):
        buffer = ""
        for paragraph in re.split(r"\n\s*\n|\n", page):
            paragraph = paragraph.strip()
            if not paragraph:
                continue
            if buffer and len(buffer) + len(paragraph) > CHUNK_CHARS:
                chunks.append((number, buffer))
                buffer = ""
            buffer = f"{buffer}\n{paragraph}".strip()
        if buffer:
            chunks.append((number, buffer))
    return chunks


class QuoteIndex:
    def __init__(self, pages: list[str], min_chars: int = 1):
        self.pages = [normalise(page) for page in pages]
        self.has_text = sum(len(page) for page in self.pages) >= min_chars

    def locate(self, quote: str, page: int | None) -> int | None:
        """Return the 1-based page where the quote appears (cited page first), or None."""
        needle = normalise(quote or "")
        if len(needle) < QUOTE_MIN_CHARS:
            return None
        order = list(range(len(self.pages)))
        if page and 1 <= page <= len(self.pages):
            order.remove(page - 1)
            order.insert(0, page - 1)
        for index in order:
            if needle in self.pages[index]:
                return index + 1
        for index in range(len(self.pages) - 1):  # quotes that run across a page break
            if needle in f"{self.pages[index]} {self.pages[index + 1]}":
                return index + 1
        return None


def _numbers(text: str) -> list[float]:
    found = []
    for match in re.findall(r"\d[\d,]*(?:\.\d+)?", text or ""):
        try:
            found.append(float(match.replace(",", "")))
        except ValueError:
            continue
    return found


def _first_number(text: str) -> float | None:
    numbers = _numbers(text)
    return numbers[0] if numbers else None


def _value_in_quote(value: str, quote: str) -> bool:
    try:
        number = parse_number(value)
    except ValueError:
        return normalise(value) in normalise(quote)
    # Signs are compared loosely: a quote's "-" may be a hyphen or dash rather than a minus.
    return any(abs(candidate - abs(number)) <= max(1e-6, abs(number) * 1e-6) for candidate in _numbers(quote))


def _page_note(extractor: str) -> str:
    if extractor == "pdf":
        return "use the 1-based page number of the PDF page the quote is on."
    if extractor == "docx":
        return "this is a Word document without page numbers; use page 1 for every quote."
    return "pages are marked '=== Page N ==='; use that N."


def process_document(upload: Upload, path: Path, evaluate_building, process_table=None) -> None:
    """Index, extract, verify and check one document.

    `evaluate_building(raw, sources, extra_issues, label)` stages one extracted building;
    `process_table(frame)` takes over when the document is a data table (e.g. a CSV printed to PDF).
    """
    def file_issue(item: dict) -> None:
        db.session.add(ValidationIssue(upload_id=upload.id, **item))

    upload.status = "extracting"
    try:
        pages = read_pages(path, upload.extractor)
    except Exception as exc:
        file_issue(issue("unreadable", "error", f"The document could not be read: {exc}"))
        upload.status = "rejected"
        return

    total_chars = sum(len(page) for page in pages)
    if total_chars > MAX_TEXT_CHARS:
        file_issue(issue("document_too_large", "error", f"The document has {total_chars:,} characters of text; the limit for one extraction is {MAX_TEXT_CHARS:,}. Split it and upload the parts."))
        upload.status = "rejected"
        return
    chunks = chunk_pages(pages)
    for index, (page, text) in enumerate(chunks):
        db.session.add(DocumentChunk(upload_id=upload.id, portfolio_id=upload.portfolio_id, page=page, chunk_index=index, text=text))
    chunk_count = len(chunks)
    quotes = QuoteIndex(pages, MIN_TEXT_LAYER_CHARS if upload.extractor == "pdf" else 1)
    summary = {"documentType": None, "pages": len(pages), "chunks": chunk_count, "buildings": 0, "facts": 0, "findings": 0, "droppedQuotes": 0, "byStatus": {}}

    if not quotes.has_text:
        if upload.extractor != "pdf":
            file_issue(issue("empty_file", "error", "The document has no text."))
            upload.status = "rejected"
            upload.summary = summary
            return
        file_issue(issue("no_text_layer", "warning", "The PDF has no text layer (it may be scanned). Extracted values can't be checked against the text, so every one needs review."))

    llm = llm_service.get_llm()
    if process_table is not None and quotes.has_text and pdf_tables.looks_tabular(pages):
        try:
            frame, report = pdf_tables.parse_table(pages, llm)
        except (pdf_tables.TableLayoutError, llm_service.LLMError) as exc:
            file_issue(issue("table_not_parsed", "info", f"The document looks like a table but could not be parsed as one ({exc}); reading it as a document instead."))
        else:
            how = "the standard header names" if report["method"] == "header names" else "Claude reading the first lines"
            file_issue(issue("table_detected", "info", f"Read as a data table: {report['rows']} rows, {len(report['columns'])} columns. Column layout from {how}; every value is parsed directly from the document text.", None, {"header": report["header"], "columns": report["columns"]}))
            for item in report["unmatched"][:20]:
                file_issue(issue("unparsed_line", "warning", f"Page {item['page']}: this line did not match the table layout and was skipped.", None, item))
            if len(report["unmatched"]) > 20:
                file_issue(issue("unparsed_line", "warning", f"{len(report['unmatched']) - 20} more lines did not match the table layout.", None, {"count": len(report["unmatched"]) - 20}))
            process_table(frame)
            upload.summary = {**(upload.summary or {}), "documentType": "data table", "pages": len(pages), "chunks": chunk_count, "unparsedLines": len(report["unmatched"])}
            return

    if llm is None:
        file_issue(issue("ai_unavailable", "warning", "Stored and indexed for search. Set ANTHROPIC_API_KEY on the server to extract fields from documents."))
        upload.summary = summary
        upload.status = "done"
        return

    try:
        if upload.extractor == "pdf":
            result = llm.extract_document(SYSTEM, INSTRUCTIONS.format(page_note=_page_note("pdf"), fields=_field_list()), EXTRACTION_SCHEMA, pdf_bytes=path.read_bytes())
        else:
            marked = "\n\n".join(f"=== Page {number} ===\n{text}" for number, text in enumerate(pages, start=1))
            result = llm.extract_document(SYSTEM, INSTRUCTIONS.format(page_note=_page_note(upload.extractor), fields=_field_list()), EXTRACTION_SCHEMA, text=marked)
    except llm_service.LLMError as exc:
        file_issue(issue("extraction_failed", "error", f"Extraction failed: {exc}. The document is stored and indexed for search; retry by deleting and re-uploading."))
        upload.summary = summary
        upload.status = "extraction_failed"
        return

    upload.status = "validating"
    summary["documentType"] = result.get("document_type") or None
    dropped = 0

    def verify(quote: str, page: int | None) -> tuple[bool, int | None]:
        if not quotes.has_text:
            return False, page
        found = quotes.locate(quote, page)
        return found is not None, found

    # Facts
    facts = []
    for item in result.get("facts", []):
        ok, page = verify(item["quote"], item["page"])
        if not ok and quotes.has_text:
            dropped += 1
            file_issue(issue("ai_quote_not_found", "info", f"Dropped {item['key']} ({item['value']!r}): its quote was not found in the document.", None, {"key": item["key"], "value": item["value"], "quote": item["quote"], "page": item["page"]}))
            continue
        fact = DocumentFact(
            upload_id=upload.id, key=item["key"], label=(item.get("label") or None), value=item["value"], kind=item["kind"],
            page=page, quote=item["quote"], confidence=_clamp(item.get("confidence")), verified=ok,
        )
        db.session.add(fact)
        facts.append(fact)
    summary["facts"] = len(facts)

    # Buildings
    located = []
    for position, building in enumerate(result.get("buildings", []), start=1):
        raw, sources, extra = {}, {}, []
        for entry in building.get("fields", []):
            name = entry["field"]
            if name in raw:
                continue
            ok, page = verify(entry["quote"], entry["page"])
            if not ok and quotes.has_text:
                dropped += 1
                file_issue(issue("ai_quote_not_found", "info", f"Dropped {name} ({entry['value']!r}) for {building['label']}: its quote was not found in the document.", name, {"value": entry["value"], "quote": entry["quote"], "page": entry["page"]}))
                continue
            raw[name] = (entry["value"] or "").strip() or None
            sources[name] = {"method": "ai_extracted", "confidence": _clamp(entry.get("confidence")), "quote": entry["quote"], "page": page}
            if not ok:
                extra.append(issue("quote_unverified", "review", f"{name} could not be checked against the document text; confirm it against page {page}.", name, {"quote": entry["quote"], "page": page}))
            elif raw[name] and name not in ("housing_class", "name", "region", "address", "loc_id") and not _value_in_quote(raw[name], entry["quote"]):
                extra.append(issue("value_not_in_quote", "warning", f"{name} = {raw[name]} does not appear as written in its quote; check the conversion.", name, {"value": raw[name], "quote": entry["quote"]}))
        if not raw:
            continue
        if not raw.get("loc_id"):
            raw["loc_id"] = f"DOC-{upload.id[:8].upper()}-{position}"
            sources["loc_id"] = {"method": "derived", "confidence": 1.0, "quote": "Generated: the document gives no location ID"}
        data = evaluate_building(raw, sources, extra, building.get("label") or f"building {position}")
        summary["byStatus"][data["_status"]] = summary["byStatus"].get(data["_status"], 0) + 1
        if data.get("lat") is not None and data.get("lon") is not None:
            located.append(data)
    summary["buildings"] = sum(summary["byStatus"].values())

    # Findings (AI-flagged, quote-backed) and deterministic document checks
    deterministic = document_checks(facts, located)
    deterministic_codes = {item["code"] for item in deterministic}
    findings = 0
    for item in result.get("findings", []):
        if item["code"] in deterministic_codes:
            continue
        citations = []
        for citation in item.get("citations", []):
            ok, page = verify(citation["quote"], citation["page"])
            if ok or not quotes.has_text:
                citations.append({"quote": citation["quote"], "page": page, "verified": ok})
        if not citations:
            dropped += 1
            file_issue(issue("ai_quote_not_found", "info", f"Dropped finding {item['code']}: none of its quotes were found in the document.", None, {"message": item["message"]}))
            continue
        file_issue(issue(item["code"], "warning", item["message"], None, {"source": "ai", "citations": citations}))
        findings += 1
    for item in deterministic:
        file_issue(item)
    summary["findings"] = findings + len(deterministic)
    summary["droppedQuotes"] = dropped
    upload.summary = summary
    upload.status = "done"


def _clamp(value) -> float | None:
    try:
        return min(max(float(value), 0.0), 1.0)
    except (TypeError, ValueError):
        return None


def _field_list() -> str:
    return "\n".join(f"- {name}: {FIELD_DESCRIPTIONS[name]}" for name in EXTRACTABLE_FIELDS)


def document_checks(facts: list[DocumentFact], buildings: list[dict], today: datetime | None = None) -> list[dict]:
    """Deterministic checks over extracted facts: area arithmetic, offer expiry, stated distances."""
    results = []
    today = today or datetime.now(UTC)
    by_key: dict[str, list[DocumentFact]] = {}
    for fact in facts:
        by_key.setdefault(fact.key, []).append(fact)

    gross = next((value for value in (_first_number(fact.value) for fact in by_key.get("gross_floor_area", [])) if value), None)
    components = [(fact.label or "part", _first_number(fact.value), fact) for fact in by_key.get("floor_area_component", [])]
    components = [(label, value, fact) for label, value, fact in components if value]
    if gross and len(components) >= 2:
        total = sum(value for _, value, _ in components)
        if abs(total - gross) / gross > AREA_TOLERANCE:
            results.append(issue(
                "area_breakdown_mismatch", "warning",
                f"The stated gross floor area is {gross:,.0f} m², but the listed parts add up to {total:,.0f} m².",
                "floor_area_m2", {"source": "check", "stated": gross, "componentsSum": total,
                                  "components": [{"label": label, "areaM2": value, "page": fact.page} for label, value, fact in components]},
            ))

    for fact in by_key.get("offer_expiry", []):
        expiry = pd.to_datetime(fact.value, dayfirst=True, errors="coerce")
        if pd.isna(expiry):
            continue
        expiry = expiry.tz_localize(UTC) if expiry.tzinfo is None else expiry
        days = (expiry - pd.Timestamp(today)).days
        if days <= EXPIRY_WARNING_DAYS:
            results.append(issue(
                "offer_expiring", "warning",
                f"The offer {'expired' if days < 0 else 'expires'} on {expiry.date().isoformat()}" + ("." if days < 0 else f", in {days} day(s)."),
                None, {"source": "check", "expiry": expiry.date().isoformat(), "days": days, "quote": fact.quote, "page": fact.page},
            ))

    geocoder = geocoding.get_geocoder()
    claims = by_key.get("distance_claim", [])
    if claims and buildings and geocoder is not None:
        origin = buildings[0]
        for fact in claims:
            claimed = _first_number(fact.value)
            if not claimed or not fact.label:
                continue
            if "m" in fact.value.lower() and "km" not in fact.value.lower():
                claimed = claimed / 1000
            try:
                place = geocoder.geocode(f"{fact.label}, Nairobi, Kenya")
            except geocoding.GeocodingError:
                continue
            if place is None:
                continue
            actual = float(fm.haversine_km(origin["lat"], origin["lon"], place.lat, place.lon))
            if abs(actual - claimed) > DISTANCE_TOLERANCE_KM and abs(actual - claimed) / max(claimed, 0.1) > DISTANCE_TOLERANCE_RATIO:
                results.append(issue(
                    "distance_claim_mismatch", "warning",
                    f"The document says {fact.label} is {claimed:g} km away; by geocoded location it is about {actual:.1f} km.",
                    None, {"source": "check", "place": fact.label, "claimedKm": claimed, "computedKm": round(actual, 2),
                           "geocodedAddress": place.formatted_address, "precision": place.precision, "quote": fact.quote, "page": fact.page},
                ))
    return results
