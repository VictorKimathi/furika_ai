import io

from app.services import chat_provider

BASE = "/api/v1"


def ask(client, message, upload_ids=None):
    return client.post(f"{BASE}/chat", json={"message": message, "mode": "analysis", "context": {"portfolioId": "SYN-PORT-142", "uploadIds": upload_ids or []}})


def test_answers_from_portfolio_without_attached_sources(seeded, monkeypatch):
    seen = {}
    monkeypatch.setattr(chat_provider, "answer", lambda prompt: (seen.setdefault("prompt", prompt) and "Grounded answer", "claude", "claude-opus-5-5"))
    response = ask(seeded, "Which properties have the highest insured value?")
    assert response.status_code == 200, response.json
    assert response.json["answer"] == "Grounded answer"
    prompt = seen["prompt"]
    assert "Highest insured values: NBO-0594 (Karen Miotoni Karen): permanent_masonry, KES 94,500,000" in prompt
    assert "By housing class:" in prompt
    assert "reference_sample.csv" in prompt  # the seeded upload is included automatically
    assert "No model run exists yet" in prompt
    assert response.json["workflow"] is None  # an insured-value question needs no model run


def test_data_only_answer_when_ai_is_unavailable(seeded, monkeypatch):
    def fail(prompt):
        raise chat_provider.ChatProviderError("Gemini request failed: HTTP Error 400; Claude request failed: Your credit balance is too low")
    monkeypatch.setattr(chat_provider, "answer", fail)
    response = ask(seeded, "Summarise the portfolio")
    assert response.status_code == 200
    assert response.json["provider"] == "none"
    assert "the Anthropic account has no credit" in response.json["answer"]
    assert "Highest insured values" in response.json["answer"]


def test_approved_run_losses_reach_the_chat(seeded, monkeypatch):
    run = seeded.post(f"{BASE}/model-runs", json={"portfolioId": "SYN-PORT-142"}).json
    assert seeded.post(f"{BASE}/model-runs/{run['id']}/decision", json={"action": "approve"}).status_code == 200
    seen = {}
    monkeypatch.setattr(chat_provider, "answer", lambda prompt: (seen.setdefault("prompt", prompt) and "ok", "claude", "m"))
    response = ask(seeded, "What is the highest AAL?")
    assert f"Approved run {run['id']} highest property AAL" in seen["prompt"]
    assert response.json["workflow"] == {"runId": run["id"], "status": "approved", "created": False}
    assert response.json["actions"] == []


def test_gemini_moves_to_backup_model_when_busy(monkeypatch):
    import io
    import urllib.error

    tried = []
    def fake_once(key, model, prompt, thinking=True):
        tried.append(model)
        if model == "gemini-3.8-flash":
            raise urllib.error.HTTPError("url", 503, "busy", {}, io.BytesIO(b'{"error": {"message": "high demand"}}'))
        return f"answer from {model}"
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-3.8-flash")
    monkeypatch.setattr(chat_provider, "_gemini_once", fake_once)
    assert chat_provider._gemini("q") == ("answer from gemini-3.7-flash", "gemini-3.7-flash")
    assert tried == ["gemini-3.8-flash", "gemini-3.7-flash"]


def test_loss_question_starts_a_run_and_uses_draft_results(seeded, monkeypatch):
    seen = {}
    monkeypatch.setattr(chat_provider, "answer", lambda prompt: (seen.setdefault("prompt", prompt) and "ok", "gemini", "m"))
    response = seeded.post(f"{BASE}/chat", json={"message": "What is the expected flood loss for NBO-0002?", "context": {"portfolioId": "SYN-PORT-142", "uploadIds": []}}).json
    workflow = response["workflow"]
    assert workflow["status"] == "review" and workflow["created"] is True
    assert response["actions"] == ["open_workflow"]
    prompt = seen["prompt"]
    assert f"a new model run {workflow['runId']} was just calculated" in prompt
    assert f"DRAFT run {workflow['runId']} (awaiting human approval" in prompt
    assert "results for NBO-0002: AAL KES" in prompt and "1-in-100 loss KES" in prompt

    seen.clear()
    again = seeded.post(f"{BASE}/chat", json={"message": "And the 1-in-250 loss?", "context": {"portfolioId": "SYN-PORT-142", "uploadIds": []}}).json
    assert again["workflow"] == {"runId": workflow["runId"], "status": "review", "created": False}  # reused, not a second run

    seeded.post(f"{BASE}/model-runs/{workflow['runId']}/decision", json={"action": "approve"})
    detail = seeded.get(f"{BASE}/properties/NBO-0002").json
    assert detail["loss"]["aalKes"] is not None  # approval publishes the reviewed draft results


def test_named_property_results_survive_the_evidence_cap(seeded, monkeypatch):
    from app.services import chat
    monkeypatch.setattr(chat, "MAX_EVIDENCE_CHARS", 1200)
    seeded.post(f"{BASE}/model-runs", json={"portfolioId": "SYN-PORT-142"})
    seen = {}
    monkeypatch.setattr(chat_provider, "answer", lambda prompt: (seen.setdefault("prompt", prompt) and "ok", "gemini", "m"))
    ask(seeded, "Expected loss for NBO-0594?")
    assert "results for NBO-0594: AAL KES" in seen["prompt"]


def test_new_run_supersedes_pending_runs(seeded):
    first = seeded.post(f"{BASE}/model-runs", json={"portfolioId": "SYN-PORT-142"}).json
    second = seeded.post(f"{BASE}/model-runs", json={"portfolioId": "SYN-PORT-142"}).json
    assert seeded.get(f"{BASE}/model-runs/{first['id']}").json["status"] == "superseded"
    assert seeded.post(f"{BASE}/model-runs/{first['id']}/decision", json={"action": "approve"}).status_code == 409
    assert seeded.get(f"{BASE}/model-runs?portfolioId=SYN-PORT-142").json["items"][0]["id"] == second["id"]
