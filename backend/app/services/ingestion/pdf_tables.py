"""Read data tables that were printed to PDF (for example an exposure CSV exported as a PDF).

PDF text layers often glue columns together ("informal_iron_sheet16", "portfolio0.66"). Claude
looks at the first lines only and names each column with a coarse type; the server then builds
an anchored pattern from fixed, safe sub-patterns (Claude never supplies a regex) and parses
every line deterministically. Values therefore come verbatim from the document text.
"""

from __future__ import annotations

import itertools
import re

import pandas as pd

from .validation import CANONICAL_FIELDS, HAZARD_FIELDS

SAMPLE_LINES = 40
MIN_ROWS = 3
MIN_MATCH_SHARE = 0.9
NUMBER = r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?"
TYPE_PATTERNS = {
    "id": r"[A-Za-z0-9][A-Za-z0-9_\-/.]*",
    "number": NUMBER,
    "word": r"[A-Za-z_]+",
    "boolean": r"(?:TRUE|FALSE|True|False|true|false|YES|NO|Yes|No|yes|no)",
    "text": r".*?",
}
NUMERIC_TOKEN = re.compile(NUMBER)

LAYOUT_SYSTEM = (
    "You identify the column layout of a data table that was extracted from a PDF as plain text. "
    "Columns may be glued together without spaces, in the header and in the rows. Report the exact header "
    "line, then every column in order with its name as written in the header and its type: "
    "id (a code without spaces), number, word (letters and underscores only), boolean, or text "
    "(free text that may contain spaces; use it for at most one column). If the text is not a table "
    "with one record per line, set is_table to false."
)
LAYOUT_SCHEMA = {
    "type": "object",
    "properties": {
        "is_table": {"type": "boolean"},
        "header_line": {"type": "string"},
        "columns": {"type": "array", "items": {
            "type": "object",
            "properties": {"name": {"type": "string"}, "type": {"type": "string", "enum": list(TYPE_PATTERNS)}},
            "required": ["name", "type"],
            "additionalProperties": False,
        }},
    },
    "required": ["is_table", "header_line", "columns"],
    "additionalProperties": False,
}


CANONICAL_TYPES = {
    "loc_id": "id", "housing_class": "word", "synthetic": "boolean", "name": "text", "region": "text", "address": "text",
    **{name: "number" for name in ("lat", "lon", "floor_area_m2", "cost_per_m2_kes", "tiv_kes", *HAZARD_FIELDS)},
}
MAX_UNKNOWN_COLUMNS = 4


class TableLayoutError(ValueError):
    pass


def _split_header_token(token: str) -> list[str]:
    """Split a glued header token ("housing_classfloor_area_m2") into canonical names.

    A trailing non-canonical name is peeled off only when it looks like a column name of its own
    (contains "_"), so ordinary words that merely start with a canonical name ("latitude") stay whole.
    """
    names = sorted(CANONICAL_FIELDS, key=len, reverse=True)
    parts, rest = [], token
    while rest:
        name = next((name for name in names if rest.startswith(name)), None)
        if name is None:
            if parts and "_" in rest and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", rest):
                return [*parts, rest]
            return [token]
        parts.append(name)
        rest = rest[len(name):]
    return parts


def infer_layout_locally(lines: list[str]) -> dict | None:
    """Layout from a header that uses canonical column names; unknown columns get the types that fit the sample rows best."""
    for index, line in enumerate(lines[:5]):
        names = [part for token in line.split() for part in _split_header_token(token)]
        if sum(name in CANONICAL_TYPES for name in names) < 4:
            continue
        unknown = [position for position, name in enumerate(names) if name not in CANONICAL_TYPES]
        if len(unknown) > MAX_UNKNOWN_COLUMNS or len(set(names)) != len(names):
            return None
        sample = [row for row in lines[index + 1:index + 1 + SAMPLE_LINES] if len(NUMERIC_TOKEN.findall(row)) >= 2]
        best, best_hits = None, -1
        for types in itertools.product(TYPE_PATTERNS, repeat=len(unknown)):
            columns = [{"name": name, "type": CANONICAL_TYPES.get(name, "text")} for name in names]
            for position, kind in zip(unknown, types):
                columns[position]["type"] = kind
            try:
                pattern = build_pattern(columns)
            except TableLayoutError:
                continue
            hits = sum(1 for row in sample if pattern.match(row))
            if hits > best_hits:
                best, best_hits = columns, hits
        if best is not None and sample and best_hits / len(sample) >= MIN_MATCH_SHARE:
            return {"is_table": True, "header_line": line, "columns": best, "method": "header names"}
        return None
    return None


def looks_tabular(pages: list[str]) -> bool:
    """Cheap pre-check: most lines on the first pages carry several numbers."""
    lines = [line for page in pages[:2] for line in page.splitlines() if line.strip()]
    if len(lines) < MIN_ROWS + 1:
        return False
    numeric = sum(1 for line in lines if len(NUMERIC_TOKEN.findall(line)) >= 4)
    return numeric / len(lines) >= 0.6


def build_pattern(columns: list[dict]) -> re.Pattern:
    if not columns:
        raise TableLayoutError("No columns were identified.")
    if sum(1 for column in columns if column["type"] == "text") > 1:
        raise TableLayoutError("At most one free-text column is supported.")
    parts = [f"(?P<c{index}>{TYPE_PATTERNS[column['type']]})" for index, column in enumerate(columns)]
    return re.compile(r"^\s*" + r"\s*".join(parts) + r"\s*$")


def parse_table(pages: list[str], llm) -> tuple[pd.DataFrame, dict]:
    """Return (frame of raw strings, report). Raises TableLayoutError when the text isn't a parseable table.

    The layout comes from the header when it uses canonical column names (no AI call); otherwise Claude
    names the columns from the first lines. `llm` may be None, in which case only the first route is tried.
    """
    lines = [(number, line.strip()) for number, page in enumerate(pages, start=1) for line in page.splitlines() if line.strip()]
    layout = infer_layout_locally([line for _, line in lines])
    if layout is None:
        if llm is None:
            raise TableLayoutError("The header doesn't use the standard column names and Claude is not configured to read the layout.")
        sample = "\n".join(line for _, line in lines[:SAMPLE_LINES])
        layout = llm.json(LAYOUT_SYSTEM, sample, schema=LAYOUT_SCHEMA) | {"method": "claude"}
    if not layout.get("is_table"):
        raise TableLayoutError("Claude did not recognise a one-record-per-line table.")
    header = (layout.get("header_line") or "").strip()
    columns = layout.get("columns") or []
    if not header or header not in {line for _, line in lines}:
        raise TableLayoutError("The reported header line was not found in the document text.")
    squashed_header = re.sub(r"\s+", "", header)
    missing = [column["name"] for column in columns if re.sub(r"\s+", "", column["name"]) not in squashed_header]
    if missing:
        raise TableLayoutError(f"Column name(s) not found in the header: {', '.join(missing)}.")
    names = [column["name"].strip() for column in columns]
    if len(set(names)) != len(names):
        raise TableLayoutError("Column names must be unique.")

    pattern = build_pattern(columns)
    header_index = next(index for index, (_, line) in enumerate(lines) if line == header)
    # Titles, footers and page numbers aren't records: only lines carrying most of the numeric columns count.
    numeric_columns = sum(1 for column in columns if column["type"] == "number")
    min_numbers = max(1, numeric_columns // 2)
    candidates = [(page, line) for page, line in lines[header_index + 1:] if line != header and len(NUMERIC_TOKEN.findall(line)) >= min_numbers]
    rows, unmatched = [], []
    for page, line in candidates:
        match = pattern.match(line)
        if match:
            rows.append({name: (match.group(f"c{index}") or "").strip() or None for index, name in enumerate(names)})
        else:
            unmatched.append({"page": page, "line": line[:300]})
    if len(rows) < MIN_ROWS or len(rows) / max(len(candidates), 1) < MIN_MATCH_SHARE:
        raise TableLayoutError(f"Only {len(rows)} of {len(candidates)} lines matched the inferred layout.")
    report = {"header": header, "columns": columns, "rows": len(rows), "unmatched": unmatched, "method": layout.get("method", "claude")}
    return pd.DataFrame(rows, columns=names), report
