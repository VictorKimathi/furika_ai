"""Gemini service boundary.

`json()` makes real calls to the Gemini REST API and is used for ingestion
column mapping. Chat analysis still returns deterministic placeholder responses.
"""

import json as jsonlib
import os
import urllib.request

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class GeminiService:
    @property
    def provider(self) -> str:
        return "gemini"

    @property
    def model(self) -> str:
        value = os.getenv("GEMINI_MODEL", "")
        return value if value.startswith("gemini-") else "gemini-3.8-flash"

    @property
    def configured(self) -> bool:
        return bool(os.getenv("GEMINI_API_KEY"))

    def json(self, system: str, user: str, timeout: float = 60.0) -> dict:
        """Return the model's JSON object response. Raises on transport or parse errors."""
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
        }
        request = urllib.request.Request(
            GEMINI_ENDPOINT.format(model=self.model),
            data=jsonlib.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": os.getenv("GEMINI_API_KEY", "")},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = jsonlib.load(response)
        text = payload["candidates"][0]["content"]["parts"][0]["text"]
        result = jsonlib.loads(text)
        if not isinstance(result, dict):
            raise ValueError("Gemini returned JSON that is not an object.")
        return result

    def dummy_analysis(self) -> dict:
        return {
            "answer": "This is a dummy Furika AI response. Connect the Gemini model implementation later without changing this API route.",
            "source": "Gemini adapter · dummy response",
            "citations": [],
            "actions": [],
            "provider": self.provider,
            "model": self.model,
            "dummy": True,
        }

    def dummy_exposure(self) -> dict:
        return {
            "asset": {
                "location": None,
                "type": None,
                "value": None,
                "hazard": None,
                "mdr": None,
                "loss": None,
            },
            "source": "Gemini exposure adapter · dummy response",
            "provider": self.provider,
            "model": self.model,
            "dummy": True,
        }


gemini_service = GeminiService()


def get_llm() -> GeminiService | None:
    """Return the configured model client, or None so callers fall back to deterministic paths."""
    return gemini_service if gemini_service.configured else None
