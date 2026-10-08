"""Select evidence from the database for the chatbot; the browser sends IDs only."""

from __future__ import annotations

import json
import logging
import re

from sqlalchemy import func

from ..extensions import db
from ..models import DocumentChunk, DocumentFact, HazardResult, Hotspot, LossResult, ModelRun, Portfolio, Property, RunStage, Upload, UploadRow
from . import chat_provider, model_runs, offer, run_metrics
from .run_trace import RunFailed

logger = logging.getLogger(__name__)


class ChatError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


AUTO_SOURCES = 3
MAX_EVIDENCE_CHARS = 16000
ROW_KEYS_DROPPED = ("raw", "sources", "provenanceMethods", "hotspots")


def _row_summary(data: dict | None) -> dict:
    """Row data without bookkeeping keys, so the evidence stays short."""
    return {key: value for key, value in (data or {}).items() if key not in ROW_KEYS_DROPPED and value not in (None, {}, [])}
TOP_N = 8


def _kes(value) -> str:
    return f"KES {float(value or 0):,.0f}"


def _overview(portfolio_id: str) -> list[str]:
    """Compact portfolio statistics so questions can be answered without attaching a file."""
    props = Property.query.filter_by(portfolio_id=portfolio_id).all()
    if not props:
        return ["The portfolio has no properties yet. Upload an exposure file in Data sources."]
    lines = []
    def group(key):
        totals = {}
        for prop in props:
            name = key(prop) or "unknown"
            count, tiv = totals.get(name, (0, 0.0))
            totals[name] = (count + 1, tiv + float(prop.insured_value_kes or 0))
        return "; ".join(f"{name}: {count} properties, {_kes(tiv)}" for name, (count, tiv) in sorted(totals.items(), key=lambda item: -item[1][1]))
    lines.append(f"By housing class: {group(lambda prop: prop.housing_class)}")
    lines.append(f"By review status: {group(lambda prop: prop.review_status)}")
    lines.append(f"By hazard source: {group(lambda prop: prop.hazard_source)}")
    if any(prop.region for prop in props):
        lines.append(f"By region: {group(lambda prop: prop.region)}")
    def describe(prop: Property) -> str:
        scores = (prop.attributes or {}).get("hazard_scores") or {}
        label = " ".join(part for part in (prop.name if prop.name != prop.id else None, prop.region) if part)
        severe = f", severe-tier proxy {scores['severe']:.2f}" if scores.get("severe") is not None else ""
        return f"{prop.id}{f' ({label})' if label else ''}: {prop.housing_class}, {_kes(prop.insured_value_kes)}{severe}, at {float(prop.latitude):.4f}, {float(prop.longitude):.4f}"
    by_tiv = sorted(props, key=lambda prop: float(prop.insured_value_kes or 0), reverse=True)[:TOP_N]
    lines.append("Highest insured values: " + "; ".join(describe(prop) for prop in by_tiv))
    scored = [prop for prop in props if ((prop.attributes or {}).get("hazard_scores") or {}).get("severe") is not None]
    by_hazard = sorted(scored, key=lambda prop: prop.attributes["hazard_scores"]["severe"], reverse=True)[:TOP_N]
    if by_hazard:
        lines.append("Highest severe-tier hazard proxy scores: " + "; ".join(describe(prop) for prop in by_hazard))
    run = model_runs.latest_open_or_approved(portfolio_id)
    if run is None:
        lines.append("No model run exists yet, so there are no modelled losses, AAL or flood probabilities.")
        return lines
    label = _run_label(run)
    summary = (run.configuration or {}).get("summary", {})
    if summary:
        tiers = "; ".join(f"{tier['tier']} (1-in-{tier['rp']:g}): {_kes(tier['loss_kes'])}" for tier in summary.get("tierLosses", []))
        lines.append(f"{label} portfolio results: {summary.get('propertyCount')} properties modelled, TIV {_kes(summary.get('totalTivKes'))}, "
                     f"central AAL {_kes(summary.get('aalKes'))}. Scenario losses: {tiers}.")
    top_losses = LossResult.query.filter_by(model_run_id=run.id).order_by(LossResult.aal_kes.desc()).limit(TOP_N).all()
    if top_losses:
        lines.append(f"{label} highest property AAL: " + "; ".join(f"{loss.property_id}: AAL {_kes(loss.aal_kes)}, 1-in-100 {_kes(loss.loss_100_kes)}, 1-in-250 {_kes(loss.loss_250_kes)}" for loss in top_losses))
    return lines


def _run_label(run: ModelRun) -> str:
    return f"Approved run {run.id}" if run.status == "approved" else f"DRAFT run {run.id} (awaiting human approval in the Workflow panel, not yet approved)"


MODEL_QUESTION = re.compile(r"loss|aal|annual|damage|risk|exposure|exposed|flood|probab|return period|1-in|ep curve|exceed|scenario|model|run|report|underwrit|premium|accumulat", re.I)
PORTFOLIO_COMPARISON = re.compile(r"\b(?:accumulat\w*|portfolio comparison|compare with (?:the )?portfolio|nearby insured (?:assets|properties))\b", re.I)
MAX_OFFER_CONTEXT_CHARS = 120_000


def ensure_run(portfolio_id: str, question: str) -> tuple[ModelRun | None, bool, str | None]:
    """For questions that need model output: reuse the approved or pending run, else start one. Returns (run, created, problem)."""
    run = model_runs.latest_open_or_approved(portfolio_id)
    if run is not None or not MODEL_QUESTION.search(question):
        return run, False, None
    try:
        created = model_runs.create({"portfolioId": portfolio_id})
    except model_runs.RunError as exc:
        return None, False, str(exc)
    except RunFailed as exc:  # logged with its trace by the run; the chat still answers
        db.session.rollback()
        return None, False, f"{exc} (trace {exc.trace.id})"
    return db.session.get(ModelRun, created["id"]), True, None


def _evidence(portfolio_id: str, upload_ids: list[str], question: str, property_id: str | None = None, hotspot_id: str | None = None) -> tuple[str, list[dict], bool]:
    if db.session.get(Portfolio, portfolio_id) is None:
        raise ChatError(f"Portfolio {portfolio_id} was not found.", 404)
    if len(upload_ids) > 5 or len(set(upload_ids)) != len(upload_ids):
        raise ChatError("Select at most five distinct data sources.")
    selected = Upload.query.filter(Upload.portfolio_id == portfolio_id, Upload.id.in_(upload_ids)).all() if upload_ids else []
    if len(selected) != len(upload_ids):
        raise ChatError("One or more selected data sources were not found in this portfolio.", 404)
    if not upload_ids:  # nothing attached: use the most recent parsed uploads so answers still come from the user's data
        selected = Upload.query.filter(Upload.portfolio_id == portfolio_id, Upload.status == "done").order_by(Upload.created_at.desc()).limit(AUTO_SOURCES).all()
    terms = {word.lower() for word in re.findall(r"[A-Za-z0-9_]+", question) if len(word) > 2}
    sections, citations = [], []
    has_source_content = False
    count, tiv = db.session.query(func.count(Property.id), func.sum(Property.insured_value_kes)).filter(Property.portfolio_id == portfolio_id).one()
    sections.append(f"Portfolio {portfolio_id}: {count} properties; total insured value KES {float(tiv or 0):.2f}.")
    citations.append({"portfolioId": portfolio_id})
    # Named properties first: their results must survive the evidence length cap.
    property_ids = list(dict.fromkeys(([property_id] if property_id else []) + re.findall(r"\b(?:NBO|USR)-[A-Za-z0-9-]+\b", question, re.I)))[:5]
    for prop in Property.query.filter(Property.portfolio_id == portfolio_id, Property.id.in_(property_ids)).all() if property_ids else []:
        sections.append(f"Property {prop.id}: {json.dumps({'name': prop.name, 'region': prop.region, 'housingClass': prop.housing_class, 'insuredValueKes': str(prop.insured_value_kes), 'floorAreaM2': str(prop.floor_area_m2), 'costPerM2Kes': str(prop.cost_per_m2_kes), 'hazardScores': (prop.attributes or {}).get('hazard_scores'), 'reviewStatus': prop.review_status, 'sourceUploadId': prop.upload_id}, default=str)}")
        citations.append({"propertyId": prop.id, "uploadId": prop.upload_id})
        run = model_runs.latest_open_or_approved(portfolio_id)
        loss = LossResult.query.filter_by(model_run_id=run.id, property_id=prop.id).first() if run else None
        hazard = HazardResult.query.filter_by(model_run_id=run.id, property_id=prop.id).first() if run else None
        if loss is not None:
            probability = f"{float(hazard.annual_flood_probability):.1%}" if hazard and hazard.annual_flood_probability is not None else "not reached by any scenario"
            depths = "; ".join(f"{tier['tier']} (1-in-{tier['rp']:g}): {float(tier['depth_m']):.2f} m proxy depth" for tier in (hazard.tiers if hazard else []))
            sections.append(f"{_run_label(run)} results for {prop.id}: AAL {_kes(loss.aal_kes)}; 1-in-10 loss {_kes(loss.loss_10_kes)}; 1-in-100 loss {_kes(loss.loss_100_kes)}; "
                            f"1-in-250 loss {_kes(loss.loss_250_kes)}; annual flood probability {probability}. Depths: {depths}.")
            citations.append({"runId": run.id, "propertyId": prop.id})
        elif run is not None:
            sections.append(f"{prop.id} was not included in {run.id} (only confirmed properties with all five hazard scores and a modelled housing class are modelled).")
    sections.extend(_overview(portfolio_id))
    latest_run = ModelRun.query.filter_by(portfolio_id=portfolio_id).order_by(ModelRun.created_at.desc()).first()
    if latest_run:
        stage_status = {stage.stage_key: stage.status for stage in RunStage.query.filter_by(model_run_id=latest_run.id).all()}
        sections.append(f"Workflow {latest_run.id}: status={latest_run.status}; stages={json.dumps(stage_status)}")
        citations.append({"runId": latest_run.id})
        if latest_run.status == "approved":
            sections.append(f"Approved model result {latest_run.id}: {json.dumps((latest_run.configuration or {}).get('summary', {}), default=str)[:4000]}")
    for upload in selected:
        label = f"{upload.filename} ({upload.id})"
        sections.append(f"Source {label}; status={upload.status}; summary={json.dumps(upload.summary or {}, default=str)}")
        rows = UploadRow.query.filter_by(upload_id=upload.id).order_by(UploadRow.position).limit(2000).all()
        has_source_content = has_source_content or bool(rows)
        ranked_rows = sorted(rows, key=lambda row: sum(term in json.dumps(row.data or {}).lower() for term in terms), reverse=True)
        for row in ranked_rows[:8]:
            sections.append(f"{label} row {row.row_ref}, status={row.status}: {json.dumps(_row_summary(row.data), default=str)[:900]}")
            citations.append({"uploadId": upload.id, "filename": upload.filename, "rowRef": row.row_ref})
        chunks = DocumentChunk.query.filter_by(upload_id=upload.id).order_by(DocumentChunk.page, DocumentChunk.chunk_index).limit(100).all()
        has_source_content = has_source_content or bool(chunks)
        ranked_chunks = sorted(chunks, key=lambda chunk: sum(term in chunk.text.lower() for term in terms), reverse=True)
        for chunk in ranked_chunks[:4]:
            sections.append(f"{label} page {chunk.page or 1}: {chunk.text[:1500]}")
            citations.append({"uploadId": upload.id, "filename": upload.filename, "page": chunk.page})
        facts = DocumentFact.query.filter_by(upload_id=upload.id).limit(12).all()
        has_source_content = has_source_content or bool(facts)
        for fact in facts:
            sections.append(f"{label} page {fact.page or 1} {fact.kind}: {fact.label or fact.key}={fact.value}; quote={fact.quote or ''}")
            citations.append({"uploadId": upload.id, "filename": upload.filename, "page": fact.page})
    hotspot_names = [term for term in terms if len(term) >= 4]
    for spot in Hotspot.query.all():
        if spot.id != hotspot_id and not any(term in spot.name.lower() for term in hotspot_names):
            continue
        sections.append(f"Reference hotspot {spot.id}: {json.dumps({'name': spot.name, 'latitude': spot.latitude, 'longitude': spot.longitude, 'severity': spot.severity, 'weight': spot.weight}, default=str)}")
        citations.append({"hotspotId": spot.id, "name": spot.name})
        if sum(bool(citation.get("hotspotId")) for citation in citations) >= 5:
            break
    return "\n".join(sections)[:MAX_EVIDENCE_CHARS], citations, has_source_content


def respond(payload: dict) -> dict:
    question = (payload.get("message") or "").strip()
    if not question:
        raise ChatError("A message is required.")
    context = payload.get("context") or {}
    portfolio_id = context.get("portfolioId") or "SYN-PORT-142"
    upload_ids = context.get("uploadIds") or []
    if not isinstance(upload_ids, list) or any(not isinstance(item, str) for item in upload_ids):
        raise ChatError("context.uploadIds must be a list of source IDs.")
    if context.get("offerText") and context.get("offerUploadId"):
        raise ChatError("Select one offer context, not both pasted text and an uploaded offer.")
    if offer.is_offer(question):
        return _respond_to_offer(question, portfolio_id)
    if context.get("offerText"):
        offer_text = context["offerText"]
        if not isinstance(offer_text, str) or len(offer_text) > MAX_OFFER_CONTEXT_CHARS or not offer.is_offer(offer_text):
            raise ChatError("The carried offer context is invalid or too long; select the offer again.")
        if upload_ids:
            raise ChatError("A carried offer cannot be mixed with other selected data sources. Clear the offer first.")
        return _respond_to_offer(offer_text, portfolio_id, question=question,
                                 include_portfolio_comparison=bool(PORTFOLIO_COMPARISON.search(question)))
    if context.get("offerUploadId"):
        if upload_ids and upload_ids != [context["offerUploadId"]]:
            raise ChatError("A carried offer cannot be mixed with other selected data sources. Clear the offer first.")
        upload, document_text = _offer_document(portfolio_id, context["offerUploadId"])
        return _respond_to_offer(document_text, portfolio_id, source_upload=upload, question=question,
                                 include_portfolio_comparison=bool(PORTFOLIO_COMPARISON.search(question)))
    if len(upload_ids) == 1:
        upload = Upload.query.filter_by(id=upload_ids[0], portfolio_id=portfolio_id).first()
        if upload and upload.extractor in ("pdf", "docx", "text"):
            chunks = DocumentChunk.query.filter_by(upload_id=upload.id).order_by(DocumentChunk.chunk_index).limit(200).all()
            document_text = "\n".join(chunk.text for chunk in chunks)[:120000]
            if offer.is_offer(document_text):
                return _respond_to_offer(document_text, portfolio_id, upload, question=question,
                                         include_portfolio_comparison=bool(PORTFOLIO_COMPARISON.search(question)))
    run, run_created, run_problem = ensure_run(portfolio_id, question)
    evidence, citations, has_source_content = _evidence(portfolio_id, upload_ids, question, context.get("propertyId"), context.get("hotspotId"))
    stage = context.get("stage")
    if stage and context.get("runId"):  # asked from a workflow stage panel: put that stage's metrics first
        stage_run = db.session.get(ModelRun, context["runId"])
        if stage_run is not None and stage_run.portfolio_id == portfolio_id:
            try:
                stage_text = run_metrics.summary_text(run_metrics.compute(stage_run), stage)
            except run_metrics.MetricsError:
                stage_text = ""
            if stage_text:
                evidence = stage_text + "\n\n" + evidence
                citations.insert(0, {"runId": stage_run.id, "stage": stage})
    if run_created:
        evidence = f"Note: no approved results existed, so a new model run {run.id} was just calculated and is waiting for human approval in the Workflow panel.\n" + evidence
    if run_problem:
        evidence = f"Note: a model run could not be started: {run_problem}\n" + evidence
    workflow = {"runId": run.id, "status": run.status, "created": run_created} if run is not None else None
    if upload_ids and not has_source_content:
        return {"answer": "The selected file is stored, but its rows or document text are not available yet. Wait for processing to finish, or choose a parsed data source.", "source": ", ".join(upload.filename for upload in selected_uploads(upload_ids)), "citations": [], "actions": [], "workflow": workflow, "provider": "none", "model": "none", "dummy": False}
    prompt = f"Question: {question[:4000]}\n\nEvidence from the Furika database:\n{evidence}"
    try:
        answer, provider, model = chat_provider.answer(prompt)
    except chat_provider.ChatProviderError as exc:
        logger.warning("Chat providers failed: %s", exc)
        # Still answer from the user's data, without AI, and say why.
        answer = (f"The AI models are unavailable right now ({_short_reason(str(exc))}), so this is a data-only summary "
                  f"from your portfolio, not an analysis of your question.\n\n" + "\n".join(f"- {line}" for line in _overview(portfolio_id)))
        provider, model = "none", "none"
    actions = ["open_workflow"] if workflow and workflow["status"] == "review" else []
    return {"answer": answer, "source": ", ".join(upload.filename for upload in selected_uploads(upload_ids)) or "Portfolio and workflow database", "citations": _dedupe(citations)[:20], "actions": actions, "workflow": workflow, "provider": provider, "model": model, "dummy": False}


def _offer_document(portfolio_id: str, upload_id: str) -> tuple[Upload, str]:
    if not isinstance(upload_id, str):
        raise ChatError("context.offerUploadId must be an uploaded document ID.")
    upload = Upload.query.filter_by(id=upload_id, portfolio_id=portfolio_id).first()
    if upload is None:
        raise ChatError("The selected offer was not found in this portfolio.", 404)
    if upload.extractor not in ("pdf", "docx", "text"):
        raise ChatError("The selected source is not an offer document.")
    chunks = DocumentChunk.query.filter_by(upload_id=upload.id).order_by(DocumentChunk.chunk_index).limit(200).all()
    document_text = "\n".join(chunk.text for chunk in chunks)[:MAX_OFFER_CONTEXT_CHARS]
    if not offer.is_offer(document_text):
        raise ChatError("The selected document has no processed placement offer to review.", 422)
    return upload, document_text


def _respond_to_offer(text: str, portfolio_id: str, source_upload: Upload | None = None, *, question: str | None = None,
                      include_portfolio_comparison: bool = False) -> dict:
    """A pasted placement offer: score it with the model, then have the AI write the briefing from those results."""
    if db.session.get(Portfolio, portfolio_id) is None:
        raise ChatError(f"Portfolio {portfolio_id} was not found.", 404)
    analysis = offer.analyse(text, portfolio_id, include_portfolio_comparison=include_portfolio_comparison)
    checks = offer.stage_report(analysis)
    answer = offer.briefing(analysis)
    try:
        commentary, provider, model = chat_provider.answer(offer.prompt(analysis, question))
        answer += f"\n\n## Additional AI interpretation\n{commentary}"
    except chat_provider.ChatProviderError as exc:
        logger.warning("Chat providers failed on an offer: %s", exc)
        provider, model = "none", "none"
    coords = (analysis["facts"].get("coordinates") or {}).get("value")
    accumulation = analysis.get("accumulation") or {}
    citations = [{"uploadId": source_upload.id, "filename": source_upload.filename} if source_upload else {"offer": (analysis["facts"].get("reference") or {}).get("value") or "pasted offer"}]
    if accumulation.get("runId"):
        citations.append({"runId": accumulation["runId"]})
    model_view = analysis.get("model") or {}
    asset = {"kind": "offer", "name": (analysis["facts"].get("client") or {}).get("value") or "Pasted offer", "lat": coords["lat"], "lng": coords["lon"],
             "annualFloodProbability": model_view.get("annualFloodProbability"), "aalKes": model_view.get("aalKes"), "loss100Kes": model_view.get("loss100Kes"),
             "flags": analysis["flags"]} if coords else None
    source_name = source_upload.filename if source_upload else "Pasted placement offer"
    return {"answer": answer, "asset": asset, "source": f"{source_name} (contact details redacted)", "citations": citations, "actions": [],
            "workflow": None, "offerChecks": checks, "provider": provider, "model": model, "dummy": False}


def _dedupe(citations: list[dict]) -> list[dict]:
    seen, unique = set(), []
    for citation in citations:
        key = json.dumps(citation, sort_keys=True)
        if key not in seen:
            seen.add(key)
            unique.append(citation)
    return unique


def _short_reason(errors: str) -> str:
    reasons = []
    if "credit balance is too low" in errors:
        reasons.append("the Anthropic account has no credit")
    elif "Claude" in errors:
        reasons.append("Claude is not reachable or not configured")
    if "Gemini" in errors:
        reasons.append("Gemini failed or is not configured")
    if "OpenAI" in errors:
        reasons.append("OpenAI failed or is not configured")
    return "; ".join(reasons) or "provider error"


def selected_uploads(upload_ids: list[str]) -> list[Upload]:
    return Upload.query.filter(Upload.id.in_(upload_ids)).all() if upload_ids else []
