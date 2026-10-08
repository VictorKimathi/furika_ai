"""Provenance-aware input resolution for the deterministic Furika pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from . import furika_model as fm


@dataclass
class InputQuestion:
    name: str
    reason: str
    expected: str


class NeedInput:
    def __init__(self, questions: list[InputQuestion]):
        self.questions = questions

    def __str__(self) -> str:
        return "Input required: " + "; ".join(f"{question.name}: {question.reason}" for question in self.questions)


class DataResolver:
    """Resolve explicit user data first, then exact files, then reviewed AI mapping."""

    def __init__(self, llm, directory: str | Path):
        self.llm = llm
        self.directory = Path(directory)
        self.records: dict[str, dict[str, Any]] = {}

    def _record(self, name: str, provenance: str, source: str, confidence: float = 1.0) -> None:
        self.records[name] = {"input": name, "provenance": provenance, "source": source, "confidence": confidence}

    @staticmethod
    def _load_frame(value) -> pd.DataFrame:
        if isinstance(value, pd.DataFrame):
            return value.copy()
        return pd.read_csv(value)

    def exposure(self, supplied=None):
        if supplied is not None:
            try:
                frame = self._load_frame(supplied)
            except Exception as exc:
                return None, f"Could not read the supplied exposure: {exc}"
            missing = [column for column in fm.REQUIRED_EXPOSURE_COLUMNS if column not in frame.columns]
            if missing:
                return None, f"Missing required columns: {', '.join(missing)}"
            self._record("exposure", "user", "user-supplied DataFrame" if isinstance(supplied, pd.DataFrame) else str(supplied))
            return frame, None

        candidates = sorted(self.directory.glob("*.csv"))
        non_hotspot_frames = []
        for path in candidates:
            try:
                frame = pd.read_csv(path)
            except Exception:
                continue
            if set(fm.REQUIRED_EXPOSURE_COLUMNS).issubset(frame.columns):
                self._record("exposure", "exact", str(path))
                return frame, None
            if not {"name", "lat", "lon"}.issubset(frame.columns):
                non_hotspot_frames.append((path, frame))

        if self.llm is not None:
            for path, frame in non_hotspot_frames:
                response = self.llm.json(
                    "Map a portfolio file to the canonical Furika schema. Never invent a column.",
                    f"Required columns: {fm.REQUIRED_EXPOSURE_COLUMNS}\nAvailable columns: {list(frame.columns)}",
                )
                mapping = response.get("mapping", {}) if isinstance(response, dict) else {}
                if not all(canonical in mapping and mapping[canonical] in frame.columns for canonical in fm.REQUIRED_EXPOSURE_COLUMNS):
                    continue
                renamed = frame.rename(columns={source: canonical for canonical, source in mapping.items()})
                self._record("exposure", "ai_mapped", str(path), float(response.get("confidence", 0)))
                return renamed, None
        return None, "No exposure CSV with the required schema was found."

    def hotspots(self, supplied=None):
        if supplied is not None:
            frame = self._load_frame(supplied)
            missing = [column for column in ("name", "lat", "lon") if column not in frame.columns]
            if missing:
                return None, f"Missing hotspot columns: {', '.join(missing)}"
            self._record("hotspots", "user", "user supplied")
            return frame, None
        for path in sorted(self.directory.glob("*.csv")):
            try:
                frame = pd.read_csv(path)
            except Exception:
                continue
            if {"name", "lat", "lon"}.issubset(frame.columns) and "loc_id" not in frame.columns:
                self._record("hotspots", "exact", str(path))
                return frame, None
        self._record("hotspots", "not_supplied", "none", 0.0)
        return None, None

    def tier_rp(self, supplied=None):
        if supplied is not None:
            issues = fm.validate_tier_rp(supplied)
            if issues:
                return None, " ".join(issues)
            self._record("tier_rp", "user", "user supplied")
            return dict(supplied), None

        documents = []
        for extension in ("*.txt", "*.md"):
            for path in sorted(self.directory.glob(extension)):
                try:
                    documents.append((path, path.read_text(encoding="utf-8")))
                except OSError:
                    continue
        if self.llm is not None and documents:
            combined = "\n\n".join(text for _, text in documents)
            response = self.llm.json(
                "Extract only values supported by an exact quote. Return found=false when absent.",
                f"Find tier_rp with keys {fm.TIERS} in this text:\n{combined}",
            )
            if response.get("found"):
                value, quote = response.get("value"), response.get("quote", "")
                if quote and quote in combined and isinstance(value, dict) and not fm.validate_tier_rp(value):
                    self._record("tier_rp", "ai_extracted", ", ".join(str(path) for path, _ in documents), float(response.get("confidence", 0)))
                    return value, None
        self._record("tier_rp", "assumed", "DEFAULT_TIER_RP")
        return dict(fm.DEFAULT_TIER_RP), None

    def provenance_report(self) -> pd.DataFrame:
        columns = ["input", "provenance", "source", "confidence"]
        return pd.DataFrame(list(self.records.values()), columns=columns)


class Pipeline:
    def __init__(self, steps, resolver: DataResolver):
        self.steps = steps
        self.resolver = resolver

    def run(self, supplied: dict | None = None):
        supplied = supplied or {}
        exposure, error = self.resolver.exposure(supplied.get("exposure"))
        if error:
            return NeedInput([InputQuestion("exposure", error, f"CSV/DataFrame with: {', '.join(fm.REQUIRED_EXPOSURE_COLUMNS)}")])
        tier_rp, error = self.resolver.tier_rp(supplied.get("tier_rp"))
        if error:
            return NeedInput([InputQuestion("tier_rp", error, "Mapping from each tier to a return period")])
        hotspots, error = self.resolver.hotspots(supplied.get("hotspots"))
        if error:
            return NeedInput([InputQuestion("hotspots", error, "name, lat, lon and optional severity/weight")])
        return fm.run_model(
            exposure,
            tier_rp=tier_rp,
            hotspots=hotspots,
            apply_uplift=bool(supplied.get("apply_uplift", False)),
            d_max=float(supplied.get("d_max", fm.DEFAULT_D_MAX)),
            wet_threshold=float(supplied.get("wet_threshold", fm.DEFAULT_WET_THRESHOLD)),
        )

    def provenance_report(self) -> pd.DataFrame:
        return self.resolver.provenance_report()


def build_steps() -> list[str]:
    return [
        "resolve_inputs",
        "validate_exposure",
        "hazard_to_depth",
        "vulnerability",
        "property_loss",
        "portfolio_aggregation",
        "ep_and_aal",
        "hotspot_validation",
    ]

