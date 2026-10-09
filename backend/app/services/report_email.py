"""Deliver an approved model report to the configured portfolio owner."""

from __future__ import annotations

import json
import logging
import math
import smtplib
from datetime import UTC, datetime
from email.message import EmailMessage
from html import escape

from flask import current_app

from ..extensions import db
from ..models import ModelRun
from . import run_reports

log = logging.getLogger("app.report_email")


def _money(value) -> str:
    return "n/a" if value is None else f"KES {float(value):,.0f}"


def render_html(report: dict) -> str:
    """A self-contained report: the table remains readable if an email client removes SVG."""
    points = report["epCurve"]
    max_loss = max((row["groundUpKes"] for row in points), default=0) or 1
    x_min = min((row["returnPeriodYears"] for row in points), default=1)
    x_max = max((row["returnPeriodYears"] for row in points), default=250)
    def x(row):
        return 45 + 500 * (math.log(row["returnPeriodYears"]) - math.log(x_min)) / (math.log(x_max) - math.log(x_min) or 1)
    def y(row, layer):
        return 170 - 140 * row[layer] / max_loss
    def curve(layer, color):
        coords = " ".join(f"{x(row):.1f},{y(row, layer):.1f}" for row in points)
        return f'<polyline points="{coords}" fill="none" stroke="{color}" stroke-width="3"/>'
    chart = ("<svg viewBox='0 0 580 200' role='img' aria-label='EP loss curve by return period' style='max-width:100%'>"
             "<path d='M45 25 V170 H550' fill='none' stroke='#8091a3'/>"
             + curve("groundUpKes", "#2a78d6") + curve("grossKes", "#eb6834") + curve("netKes", "#1baf7a")
             + "</svg>")
    ep_rows = "".join("<tr>" + "".join(f"<td>{escape(str(value))}</td>" for value in
        (f"1 in {row['returnPeriodYears']}", f"{100 * row['annualExceedanceProbability']:.1f}%",
         _money(row["groundUpKes"]), _money(row["grossKes"]), _money(row["netKes"]))) + "</tr>" for row in points)
    stage_html = "".join(
        f"<h3>{escape(stage['title'])}</h3><p><b>Input:</b> {escape(stage['input'])}<br><b>Output:</b> {escape(stage['output'])}</p>"
        + "<ul>" + "".join(f"<li><b>{escape(item['label'])}:</b> {escape(str(item['display']))} <small>({escape(item['tag'])})</small></li>"
                             for item in stage["metrics"]) + "</ul>"
        for stage in report["stages"].values())
    terms = report["financial"]["assumptions"]
    assumptions = "".join(f"<li>{escape(name)}: {escape(str(value))}</li>" for name, value in
                          [(f"{tier} return period", f"1 in {rp}") for tier, rp in terms["tierRp"].items()]
                          + list(terms["terms"].items()))
    limitations = "".join(f"<li>{escape(value)}</li>" for value in report["limitations"])
    summary = report["summary"]
    aal = report["financial"]["aalRangeKes"]
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Furika approved model report</title>
<style>body{{font:14px/1.5 Arial,sans-serif;color:#173650;max-width:900px;margin:24px auto;padding:0 16px}}h1,h2,h3{{color:#041d3b}}h1{{margin-bottom:0}}small,.note{{color:#617487}}table{{border-collapse:collapse;width:100%;margin:12px 0}}th,td{{padding:8px;text-align:left;border-bottom:1px solid #dfe6ee}}th{{background:#f3f6fa}}.kpi{{display:inline-block;padding:12px;margin:4px;background:#f3f6fa;border-radius:5px}}.kpi b{{display:block;font-size:17px}}</style></head><body>
<h1>Approved Nairobi flood model report</h1><p>Run {escape(report['runId'])} · Portfolio {escape(report['portfolioId'])} · synthetic/redacted exposure</p>
<h2>Executive results</h2><div class="kpi">Insured value<b>{_money(summary.get('totalTivKes'))}</b></div><div class="kpi">Central annual average loss<b>{_money(aal['central'])}</b></div><div class="kpi">AAL range<b>{_money(aal['low'])} – {_money(aal['high'])}</b></div>
<h2>Exceedance probability (EP) curve</h2><p>Modelled loss against assumed flood return period. Blue: ground-up; orange: gross; green: net.</p>{chart}
<table><thead><tr><th>Return period</th><th>Annual chance</th><th>Ground-up loss</th><th>Gross loss</th><th>Net loss</th></tr></thead><tbody>{ep_rows}</tbody></table>
<p class="note">A 1-in-100 level has about a 1% annual chance of exceedance; it does not happen on a fixed 100-year schedule. Return periods are assumed, not observed.</p>
<h2>Financial engine</h2><p>Damage ratio × insured value gives ground-up loss. Illustrative deductibles and limits give gross loss; assumed reinsurance gives net loss. Ground-up, gross and net AAL: {_money(report['financial']['aalByLayerKes']['ground_up'])}, {_money(report['financial']['aalByLayerKes']['gross'])}, {_money(report['financial']['aalByLayerKes']['net'])}.</p>
<h2>Results at every model step</h2>{stage_html}<h2>Assumptions</h2><ul>{assumptions}</ul><h2>Limitations</h2><ul>{limitations}</ul><p class="note">{escape(report['note'])}</p></body></html>"""


def _message(report: dict, recipient: str) -> EmailMessage:
    sender = current_app.config["EMAIL_FROM"] or current_app.config["SMTP_USER"]
    msg = EmailMessage()
    msg["Subject"] = f"Furika approved flood model report · {report['runId']}"
    msg["From"] = sender
    msg["To"] = recipient
    msg.set_content(f"The approved flood model report for {report['portfolioId']} ({report['runId']}) is below in HTML format. A machine-readable JSON copy is attached.\n\nThe EP curve and loss figures use synthetic/redacted exposure and documented assumptions.")
    msg.add_alternative(render_html(report), subtype="html")
    msg.add_attachment(json.dumps(report, ensure_ascii=False, indent=2).encode("utf-8"),
                       maintype="application", subtype="json", filename=f"furika-report-{report['runId']}.json")
    return msg


def _send(message: EmailMessage) -> None:
    config = current_app.config
    host, port = config["SMTP_HOST"], config["SMTP_PORT"]
    use_ssl = config["SMTP_USE_SSL"] or port == 465
    with (smtplib.SMTP_SSL(host, port, timeout=15) if use_ssl else smtplib.SMTP(host, port, timeout=15)) as server:
        if not use_ssl and config["SMTP_STARTTLS"]:
            server.starttls()
        if config["SMTP_USER"]:
            server.login(config["SMTP_USER"], config["SMTP_PASS"])
        server.send_message(message)


def deliver(run: ModelRun) -> dict:
    """Attempt once per approved run; persist outcome separately from the approval transaction."""
    if run.status != "approved":
        raise ValueError("Only approved reports can be emailed.")
    run_id = run.id
    previous = (run.configuration or {}).get("reportDelivery")
    if previous and previous.get("status") == "sent":
        return previous
    config = current_app.config
    recipient = config["REPORT_OWNER_EMAIL"].strip()
    if not config["REPORT_EMAIL_ENABLED"] or not recipient or not config["SMTP_HOST"] or not (config["EMAIL_FROM"] or config["SMTP_USER"]):
        outcome = {"status": "not_configured", "recipient": recipient, "message": "Report email is not configured."}
    elif bool(config["SMTP_USER"]) != bool(config["SMTP_PASS"]) or (config["SMTP_USER"] and not (config["SMTP_USE_SSL"] or config["SMTP_STARTTLS"] or config["SMTP_PORT"] == 465)):
        outcome = {"status": "not_configured", "recipient": recipient, "message": "SMTP authentication or TLS is not configured safely."}
    else:
        try:
            report = run_reports.build(run)
            _send(_message(report, recipient))
            outcome = {"status": "sent", "recipient": recipient, "sentAt": datetime.now(UTC).isoformat()}
            log.info("Approved report delivered run=%s recipient=%s", run.id, recipient)
        except Exception as exc:
            db.session.rollback()
            outcome = {"status": "failed", "recipient": recipient, "message": "Email delivery failed; retry from the Report tab."}
            log.error("Approved report email failed run=%s error_type=%s", run.id, type(exc).__name__)
    try:
        run = db.session.get(ModelRun, run.id)
        run.configuration = {**(run.configuration or {}), "reportDelivery": outcome}
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        log.error("Could not save report email status run=%s error_type=%s", run_id, type(exc).__name__)
    return outcome
