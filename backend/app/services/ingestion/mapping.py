"""Map source columns to canonical exposure fields: exact header matches first, then reviewed AI mapping."""

from __future__ import annotations

import json
import re

from .. import furika_model as fm
from .validation import CANONICAL_FIELDS

FIELD_DESCRIPTIONS = {
    "loc_id": "unique building or location identifier",
    "lat": "latitude in decimal degrees",
    "lon": "longitude in decimal degrees",
    "housing_class": f"construction class; valid values are {', '.join(fm.VALID_CLASSES)}",
    "floor_area_m2": "floor area in square metres (not square feet)",
    "cost_per_m2_kes": "rebuild cost per square metre in Kenyan shillings",
    "tiv_kes": "total insured value in Kenyan shillings",
    **{f"hazard_score_{tier}": f"0-1 flood hazard score for the '{tier}' tier" for tier in fm.TIERS},
    "name": "building or site name",
    "region": "neighbourhood or area name",
    "address": "street address or place description that can be geocoded",
    "synthetic": "true/false flag marking the row as synthetic data",
}

MAPPING_SYSTEM = (
    "You map spreadsheet columns to the canonical Furika exposure schema. "
    "Map a column only when its header and sample values clearly mean the same thing in the same units. "
    "Never invent a column name and never map one column to two fields. Leave out fields with no matching column. "
    'Return JSON: {"mappings": [{"field": "<canonical field>", "column": "<exact column header>", "confidence": <0-1>}]}'
)


def normalise_header(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(header).strip().lower()).strip("_")


def map_columns(columns: list[str], samples: dict[str, list[str]], llm) -> tuple[dict[str, dict], list[dict]]:
    """Return ({field: {column, method, confidence}}, file-level notes)."""
    mapping: dict[str, dict] = {}
    used: set[str] = set()
    by_normalised: dict[str, str] = {}
    for column in columns:
        by_normalised.setdefault(normalise_header(column), column)
    for field in CANONICAL_FIELDS:
        column = by_normalised.get(field)
        if column is not None and column not in used:
            mapping[field] = {"column": column, "method": "exact", "confidence": 1.0}
            used.add(column)

    unmapped = [field for field in CANONICAL_FIELDS if field not in mapping]
    free = [column for column in columns if column not in used]
    if llm is None or not unmapped or not free:
        return mapping, []

    prompt = json.dumps(
        {
            "fields": {field: FIELD_DESCRIPTIONS[field] for field in unmapped},
            "columns": {column: samples.get(column, []) for column in free},
        },
        ensure_ascii=False,
    )
    try:
        response = llm.json(MAPPING_SYSTEM, prompt)
    except Exception as exc:  # network, quota, or malformed output: fall back to exact matches only
        return mapping, [{
            "code": "ai_mapping_unavailable",
            "severity": "info",
            "field": None,
            "message": "AI column mapping was unavailable; only exact header matches were used.",
            "evidence": {"error": str(exc)[:300]},
        }]

    items = response.get("mappings", []) if isinstance(response, dict) else []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        field, column = item.get("field"), item.get("column")
        if field not in unmapped or field in mapping or column not in free or column in used:
            continue
        try:
            confidence = float(item.get("confidence"))
        except (TypeError, ValueError):
            continue
        if not 0 <= confidence <= 1:
            continue
        mapping[field] = {"column": column, "method": "ai_mapped", "confidence": confidence}
        used.add(column)
    return mapping, []
