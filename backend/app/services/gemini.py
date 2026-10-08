"""Gemini service boundary.

Chat analysis returns deterministic placeholder responses. Document and column
parsing uses Claude (see `llm.py`).
"""

import os


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

