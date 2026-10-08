"""Read tabular uploads into string-valued frames. Parsing of values happens in validation."""

from __future__ import annotations

import math
from pathlib import Path

import pandas as pd

from .mapping import normalise_header
from .validation import CANONICAL_FIELDS


def cell(value) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    return text or None


def _header_score(frame: pd.DataFrame) -> int:
    return len({normalise_header(column) for column in frame.columns} & set(CANONICAL_FIELDS))


def read_table(path: Path, extractor: str) -> tuple[pd.DataFrame, str | None]:
    """Return (frame, sheet name). Excel picks the sheet whose headers best match the schema."""
    if extractor == "csv":
        try:
            return pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig"), None
        except UnicodeDecodeError:
            return pd.read_csv(path, dtype=str, keep_default_na=False, encoding="latin-1"), None
    if extractor == "excel":
        sheets = pd.read_excel(path, sheet_name=None, dtype=str, engine="openpyxl")
        if not sheets:
            return pd.DataFrame(), None
        name = max(sheets, key=lambda sheet: _header_score(sheets[sheet]))
        return sheets[name], name
    raise ValueError(f"No table reader for extractor '{extractor}'.")


def column_samples(frame: pd.DataFrame, limit: int = 3) -> dict[str, list[str]]:
    samples = {}
    for column in frame.columns:
        values = [text for text in (cell(value) for value in frame[column].head(50)) if text is not None]
        samples[str(column)] = values[:limit]
    return samples
