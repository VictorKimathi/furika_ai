from app.services import report_email

BASE = "/api/v1/model-runs"
OWNER = "victorbusiness9532@gmail.com"


def test_approved_report_is_emailed_once_to_configured_owner(seeded, app, monkeypatch):
    app.config.update(REPORT_EMAIL_ENABLED=True, REPORT_OWNER_EMAIL=OWNER, SMTP_HOST="smtp.example.test",
                      SMTP_PORT=587, SMTP_USER="sender@example.test", SMTP_PASS="test-only",
                      EMAIL_FROM="sender@example.test", SMTP_STARTTLS=True)
    sent = []
    monkeypatch.setattr(report_email, "_send", lambda message: sent.append(message))
    run_id = seeded.post(BASE, json={"portfolioId": "SYN-PORT-142"}).json["id"]
    assert seeded.post(f"{BASE}/{run_id}/report/email").status_code == 409
    assert not sent
    approved = seeded.post(f"{BASE}/{run_id}/decision", json={"action": "approve"})
    assert approved.status_code == 200
    assert approved.json["reportDelivery"]["status"] == "sent"
    assert approved.json["reportDelivery"]["recipient"] == OWNER
    assert len(sent) == 1
    assert sent[0]["To"] == OWNER
    html = sent[0].get_body(preferencelist=("html",)).get_content()
    assert "Exceedance probability (EP) curve" in html
    assert "Results at every model step" in html
    assert any(part.get_filename() == f"furika-report-{run_id}.json" for part in sent[0].iter_attachments())
    report = seeded.get(f"{BASE}/{run_id}/report")
    assert report.json["emailDelivery"]["status"] == "sent"
    retried = seeded.post(f"{BASE}/{run_id}/report/email")
    assert retried.status_code == 200 and retried.json["reportDelivery"]["status"] == "sent"
    assert len(sent) == 1


def test_mail_failure_does_not_reverse_approval_and_can_retry(seeded, app, monkeypatch):
    app.config.update(REPORT_EMAIL_ENABLED=True, REPORT_OWNER_EMAIL=OWNER, SMTP_HOST="smtp.example.test",
                      SMTP_PORT=587, SMTP_USER="sender@example.test", SMTP_PASS="test-only",
                      EMAIL_FROM="sender@example.test", SMTP_STARTTLS=True)
    run_id = seeded.post(BASE, json={"portfolioId": "SYN-PORT-142"}).json["id"]
    def fail(_message):
        raise OSError("Simulated SMTP outage")
    monkeypatch.setattr(report_email, "_send", fail)
    approved = seeded.post(f"{BASE}/{run_id}/decision", json={"action": "approve"})
    assert approved.status_code == 200
    assert approved.json["status"] == "approved"
    assert approved.json["reportDelivery"]["status"] == "failed"
    assert seeded.get(f"{BASE}/{run_id}/report").status_code == 200
    sent = []
    monkeypatch.setattr(report_email, "_send", lambda message: sent.append(message))
    retried = seeded.post(f"{BASE}/{run_id}/report/email")
    assert retried.status_code == 200 and retried.json["reportDelivery"]["status"] == "sent"
    assert len(sent) == 1
