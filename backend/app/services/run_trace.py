"""Step-by-step trace of a model run. Every step is logged with its timing; a failure names the step
and the underlying error, and the same trace ID appears in the Flask log, the API response and the browser."""

from __future__ import annotations

import logging
import re
import time
import uuid
from contextlib import contextmanager

from flask import has_request_context, request

logger = logging.getLogger("app.model_runs")
REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def request_id() -> str:
    """The browser's X-Request-ID when it sent a usable one, else a new ID; stored for the request log."""
    if has_request_context():  # kept on the request itself: g can outlive one request when an app context is already pushed
        if "furika.request_id" not in request.environ:
            supplied = request.headers.get("X-Request-ID", "")
            request.environ["furika.request_id"] = supplied if REQUEST_ID.match(supplied) else uuid.uuid4().hex[:12]
        return request.environ["furika.request_id"]
    return uuid.uuid4().hex[:12]


def describe(exc: BaseException) -> str:
    """Error class and its first lines; SQLAlchemy errors are unwrapped to the database's message and DETAIL."""
    original = getattr(exc, "orig", None) or exc
    lines = [line.strip() for line in str(original).splitlines() if line.strip() and not line.strip().startswith("[")]
    return f"{type(original).__name__}: {' '.join(lines[:2])}"[:500]


def _fmt(details: dict) -> str:
    return " ".join(f"{key}={value}" for key, value in details.items() if value is not None)


class RunFailed(RuntimeError):
    """An unexpected error inside a traced step."""

    def __init__(self, step: str, error: BaseException, trace: "RunTrace"):
        self.step, self.error, self.trace = step, error, trace
        super().__init__(f"Model run failed at step '{step}': {describe(error)}")


class RunTrace:
    def __init__(self, action: str, expected: tuple[type[BaseException], ...] = (), **context):
        self.id, self.action, self.context, self.expected = request_id(), action, context, expected
        self.steps: list[dict] = []
        self.started = time.perf_counter()
        logger.info("%s started trace=%s %s", action, self.id, _fmt(context))

    @contextmanager
    def step(self, name: str):
        """Time a step. The caller may add details to the yielded dict; they are logged and returned to the browser."""
        detail: dict = {}
        entry = {"step": name, "status": "running", "ms": None, "detail": detail}
        self.steps.append(entry)
        started = time.perf_counter()
        try:
            yield detail
        except self.expected as exc:  # a known refusal (no portfolio, nothing to model): not a crash
            entry.update(status="rejected", ms=self._ms(started), error=str(exc))
            exc.trace = self
            logger.warning("%s step=%s rejected trace=%s ms=%s reason=%s", self.action, name, self.id, entry["ms"], exc)
            raise
        except Exception as exc:
            entry.update(status="failed", ms=self._ms(started), error=describe(exc))
            logger.exception("%s step=%s FAILED trace=%s ms=%s error=%s", self.action, name, self.id, entry["ms"], entry["error"])
            raise RunFailed(name, exc, self) from exc
        entry.update(status="ok", ms=self._ms(started))
        logger.info("%s step=%s ok trace=%s ms=%s %s", self.action, name, self.id, entry["ms"], _fmt(detail))

    def finish(self, **context) -> dict:
        logger.info("%s finished trace=%s total_ms=%s %s", self.action, self.id, self._ms(self.started), _fmt(context))
        return self.as_dict()

    def as_dict(self) -> dict:
        return {"traceId": self.id, "action": self.action, "totalMs": self._ms(self.started), "steps": self.steps}

    @staticmethod
    def _ms(started: float) -> float:
        return round((time.perf_counter() - started) * 1000, 1)
