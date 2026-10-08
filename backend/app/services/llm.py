"""Claude client for parsing: spreadsheet column mapping and document extraction.

Uses ANTHROPIC_API_KEY (server-only). Responses are constrained with structured outputs
(`output_config.format`) and run with server-side refusal fallbacks enabled.
"""

from __future__ import annotations

import base64
import json
import os

import anthropic

MODEL = os.getenv("CLAUDE_MODEL") or "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMError(RuntimeError):
    pass


class ClaudeService:
    def __init__(self, api_key: str, model: str = MODEL):
        self.client = anthropic.Anthropic(api_key=api_key, timeout=600.0)
        self.model = model

    def _request(self, system: str, content: list[dict], schema: dict, max_tokens: int, effort: str) -> dict:
        """Stream one structured-output request and return the parsed JSON object."""
        try:
            with self.client.beta.messages.stream(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": content}],
                output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
                betas=[FALLBACK_BETA],
                fallbacks="default",
            ) as stream:
                message = stream.get_final_message()
        except anthropic.APIConnectionError as exc:
            raise LLMError(f"Could not reach the Claude API: {exc}") from exc
        except anthropic.RateLimitError as exc:
            raise LLMError("Claude API rate limit reached; try again shortly.") from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(f"Claude API error {exc.status_code}: {exc.message}") from exc

        if message.stop_reason == "refusal":
            category = getattr(message.stop_details, "category", None) if message.stop_details else None
            raise LLMError(f"Claude declined to process this content (category: {category or 'unspecified'}).")
        if message.stop_reason == "max_tokens":
            raise LLMError("Claude's response was cut off at the output limit; the document may be too large to extract in one pass.")
        text = next((block.text for block in message.content if block.type == "text"), None)
        if text is None:
            raise LLMError("Claude returned no text output.")
        try:
            result = json.loads(text)
        except json.JSONDecodeError as exc:
            raise LLMError(f"Claude returned invalid JSON: {exc}") from exc
        if not isinstance(result, dict):
            raise LLMError("Claude returned JSON that is not an object.")
        return result

    def text(self, system: str, user: str, max_tokens: int = 4000, effort: str = "medium") -> str:
        """Plain-text answer (chat). Raises LLMError like the structured calls."""
        try:
            message = self.client.beta.messages.create(
                model=self.model, max_tokens=max_tokens, system=system,
                messages=[{"role": "user", "content": user}],
                output_config={"effort": effort}, betas=[FALLBACK_BETA], fallbacks="default",
            )
        except anthropic.APIConnectionError as exc:
            raise LLMError(f"Could not reach the Claude API: {exc}") from exc
        except anthropic.RateLimitError as exc:
            raise LLMError("Claude API rate limit reached; try again shortly.") from exc
        except anthropic.APIStatusError as exc:
            raise LLMError(f"Claude API error {exc.status_code}: {exc.message}") from exc
        if message.stop_reason == "refusal":
            raise LLMError("Claude declined to answer this request.")
        answer = "\n".join(block.text for block in message.content if block.type == "text").strip()
        if not answer:
            raise LLMError("Claude returned no text.")
        return answer

    def json(self, system: str, user: str, schema: dict | None = None) -> dict:
        """Small structured request (column mapping). `schema` defaults to a free-form object."""
        schema = schema or {"type": "object", "properties": {}, "additionalProperties": False}
        return self._request(system, [{"type": "text", "text": user}], schema, max_tokens=8000, effort="medium")

    def extract_document(self, system: str, instructions: str, schema: dict, *, pdf_bytes: bytes | None = None, text: str | None = None) -> dict:
        """Extract structured data from a PDF (sent as a document block) or from page-marked text."""
        content: list[dict] = []
        if pdf_bytes is not None:
            content.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": base64.standard_b64encode(pdf_bytes).decode("ascii")},
            })
        elif text is not None:
            content.append({"type": "text", "text": f"<document>\n{text}\n</document>"})
        content.append({"type": "text", "text": instructions})
        return self._request(system, content, schema, max_tokens=32000, effort="high")


def get_llm() -> ClaudeService | None:
    """Return the Claude client, or None so callers fall back to deterministic paths."""
    key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("CLAUDE_CODE", "")  # CLAUDE_CODE kept for older .env files
    return ClaudeService(key) if key else None
