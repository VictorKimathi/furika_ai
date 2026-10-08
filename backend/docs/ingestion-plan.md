# Ingestion, validation and data-store plan

Status: Phases 0–3 implemented 2026-10-08 (see the notes for each below), plus the Data Sources screen from Phase 5. Phases 4 and 5 (rest) not started.

## Goal

A user uploads a CSV, Excel, PDF or text file. The original is kept unchanged. Exposure fields are extracted and checked. Rows that pass the checks go into one store, and the map, property page, chatbot and model runs all read from that store. Every value can be traced back to its source file, method and quote, and to whoever confirmed it.

```
upload → raw store → extract & map → validation gate ─┬─→ data store → map / property page / chat / model run
                                                       └─→ review queue → (user confirms) ─┘
```

## Where we are today

| Area | Current state | Consequence |
|---|---|---|
| Postgres schema | [app/models.py](../app/models.py) defines `Portfolio`, `Property` (with `source_tag` and `attributes` JSON), `HazardResult`, `LossResult`, `ModelRun`, `Chat` and `Message` | Build on this. No DuckDB or Parquet. |
| Portfolio and property routes | Return hard-coded data from [app/services/dummy.py](../app/services/dummy.py) | Must switch to database queries before uploads can show up anywhere. |
| Resolver | [furika_resolver.py](../app/services/furika_resolver.py) handles exact column matches, then AI mapping, and verifies quotes for `tier_rp`. It expects `llm.json(system, user)`. | Reuse it for column mapping. Generalise its quote check for PDFs. |
| Validation | `furika_model.validate_exposure` checks schema, numeric types, classes, Nairobi bounds, score ranges, `synthetic=TRUE` and TIV reconciliation, and returns a flat list of strings | Wrap it to produce structured, per-row issues. Don't duplicate it. |
| Gemini | [gemini.py](../app/services/gemini.py) is a stub that returns dummy responses | Needs a real client with JSON output, then tool calling. |
| Geocoding | `/locations/geocode` always returns the Nairobi city centre | Replace with Google Geocoding using a server-side key. |
| Hazard scores | The model needs `hazard_score_<tier>` per row. The 600-row synthetic CSV has them attached, but new buildings won't. | Needs a hazard lookup (see Phase 2). |
| Frontend | `PortfolioScreen.jsx` hard-codes `PROPERTIES` and `CLUSTERS`. Chat goes to `furika_vote/server.mjs` (OpenAI, with portfolio figures hard-coded in its prompt), not to Flask. | Fetch properties from the API. Move chat to Flask (resolved question 1). |
| Data files | No CSV, hotspot file or PDF is in either repo | Commit them under `backend/data/reference/` (see resolved question 3). |

## Decisions

1. **Postgres for structured data, local disk for raw files.** Originals go in `STORAGE_ROOT/portfolios/<portfolio_id>/uploads/<upload_id>/original.<ext>`. Their hash, extraction output and validation results live in Postgres, not in sidecar JSON files, so one query can join everything. The folder layout is the same one an S3 bucket would use later.
2. **Rows are staged before they are promoted.** Extracted rows go into `upload_rows` first. They become `properties` only once the gate accepts them, or once a user confirms them. Rejected rows never touch `properties`.
3. **Confirmation rule.** A row is auto-confirmed if every field came from an exact column match, direct user input, or an AI column mapping with confidence ≥ 0.9, and it has no `review` issues. A row is *unconfirmed* if any field was AI-mapped below 0.9 or AI-extracted from a document, or if it has any `review` issue. Unconfirmed properties appear on the map with a badge but are excluded from model runs.
4. **AI never produces a number without a quote.** An AI-extracted field is kept only if its `quote` appears verbatim, after whitespace normalisation, on the cited page. This applies the resolver's existing rule to every field.
5. **Statements are not findings.** Text from a document is tagged by kind: `fact` (e.g. floor area), `term` (deductible, limit), `claim` (e.g. "natural protection from terrain"), or `opinion` (e.g. a broker's "ACCEPT at standard rates"). Only `fact` and `term` can fill exposure fields.
6. **No real client data.** Every upload has a required "synthetic or redacted" attestation. `validate_exposure`'s `synthetic=TRUE` rule stays. Real memos are used only after redaction.
7. **Synchronous first.** Processing runs inside the request and records a `status` (`received → extracting → validating → done | failed`). Moving it to a worker later doesn't change the API.

## Data model (new tables and columns)

```text
uploads
  id, portfolio_id, uploaded_by, filename, media_type, size_bytes,
  sha256 (unique per portfolio), storage_path, status, attestation,
  extractor ("csv" | "excel" | "pdf_text" | "text"), error, created_at

upload_rows                          -- one candidate building per row
  id, upload_id, row_ref ("row 14" | "page 2"), data JSON (canonical fields),
  status ("accepted" | "accepted_with_warnings" | "needs_review" | "rejected"),
  property_id (set after promotion), reviewed_by, reviewed_at

field_provenance                     -- one row per (subject, field)
  id, subject_type ("upload_row" | "property" | "document"), subject_id, field,
  value JSON, method ("exact" | "user" | "ai_mapped" | "ai_extracted" | "derived" | "geocoded" | "lookup"),
  source_upload_id, page, quote, confidence, kind ("fact" | "term" | "claim" | "opinion"),
  confirmed_by, confirmed_at, superseded_by

validation_issues
  id, upload_id, upload_row_id (nullable: file- or document-level),
  code, severity ("error" | "review" | "warning" | "info"), field, message,
  evidence JSON (quotes, computed values), resolved_by, resolution, resolved_at

document_chunks
  id, upload_id, portfolio_id, page, chunk_index, text, tsv (tsvector, GIN index)

document_facts                       -- terms/claims that aren't per-building fields
  id, upload_id, key ("flood_deductible", "policy_limit", "offer_expiry", ...),
  value JSON, kind, page, quote, confidence

properties (add)
  upload_id, review_status ("confirmed" | "unconfirmed"),
  geocode_precision ("supplied" | "rooftop" | "street" | "neighbourhood" | "city"),
  hazard_source ("supplied" | "interpolated" | "missing")
```

The `properties` model has no `hazard_score_*` columns. Store the five scores in `properties.attributes.hazard_scores` for now. That keeps the migration small, and the model-run loader converts them back into the canonical frame.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/portfolios/{id}/uploads` | Multipart upload with the attestation flag. Returns the upload plus a row and issue summary. |
| GET | `/portfolios/{id}/uploads` | List uploads with their status and counts |
| GET | `/uploads/{id}` | Manifest, extractor, status and counts by row status |
| GET | `/uploads/{id}/rows?status=` | Staged rows with their issues and per-field provenance |
| GET | `/uploads/{id}/original` | Download the untouched original |
| GET | `/uploads/{id}/issues` | All issues, including document-level ones |
| POST | `/upload-rows/{id}/decision` | `confirm` / `reject` / `edit` (edited fields get `method=user` and validation runs again) |
| GET | `/portfolios/{id}/review-queue` | Every row with `needs_review`, plus unconfirmed properties |
| GET | `/properties/{id}/provenance` | Field-by-field provenance for the property drawer |
| GET | `/portfolios/{id}/documents/search?q=` | Full-text search returning page and snippet |

Limits: 20 MB per file. Allowed types are `.csv`, `.xlsx`, `.pdf`, `.txt` and `.md`, checked by extension *and* magic bytes. A duplicate hash returns the existing upload with status 200, not 201.

## Pipeline stages

### 1. Receive and store
Stream the file to disk while hashing it, then check the hash for duplicates. If it's a duplicate, delete the temp file and return the existing upload. Otherwise move the file into place, make it read-only and insert the `uploads` row.

### 2. Extract and map
- **CSV / Excel** (`pandas`, `openpyxl`): take one sheet. If there are several, use the one whose headers best match, and record which sheet was chosen. Columns are matched exactly first. Then the resolver's AI mapping runs once per file, and each mapped column gets `method=ai_mapped` with the model's confidence. Headers not in the schema are kept in `data.extra`.
- **PDF** (`pypdf`, one text block per page): if a page has fewer than about 50 characters, record a `no_text_layer` error for the file. OCR is out of scope. The pages are chunked into `document_chunks`. Gemini receives the page-numbered text plus a JSON schema covering exposure fields, `document_facts` keys and suspected inconsistencies. Each value must come with `page`, `quote`, `confidence` and `kind`. Values whose quote fails the check from decision 4 are dropped, and an `ai_quote_not_found` info issue is logged.
- **Text / Markdown**: same as PDF, with a single "page".
- **Derived fields**: if `tiv_kes` is missing but area and cost per m² are both present, compute it with `method=derived`. Supplied values are never overwritten.

### 3. Enrich
- **Geocoding** happens only when coordinates are missing. The result records `geocode_precision`. A precision coarser than `street` raises a `review` issue, `approximate_location`.
- **Hazard lookup**: the default is inverse-distance weighting over the k nearest points (k=4) in the scored reference grid, with `hazard_source=interpolated`. If the nearest point is more than 500 m away, raise a `review` issue (`hazard_far_from_grid`). If the row supplies scores, use them as given (`supplied`).
- **Nearest hotspots** within 3 km are attached for display and checks.

### 4. Validation gate
The checks run in layers, and each issue has a stable `code` so the UI and tests can rely on it.

| Layer | Code | Severity | How |
|---|---|---|---|
| File | `unreadable`, `no_text_layer`, `empty_file`, `wrong_type` | error | Deterministic |
| File | `duplicate_upload` | info | Hash check |
| Schema | `missing_required_field`, `non_numeric`, `invalid_class`, `score_out_of_range`, `not_synthetic` | error | Wraps `validate_exposure`, made per-row |
| Schema | `duplicate_loc_id` (within the file) | error | Deterministic |
| Schema | `loc_id_conflict` (ID belongs to another portfolio) | error | Deterministic |
| Schema | `updates_existing` (ID already in this portfolio; the row updates it) | info | Deterministic |
| Schema | `hazard_missing` (no hazard scores; partial scores are an error) | warning | Deterministic |
| Schema | `unsupported_construction` (e.g. RCC high-rise) | review | Class mapping. Stays out of model runs until the model gets an RCC class. |
| Cross-field | `tiv_mismatch` (>2% off area × rate) | warning | Existing check |
| Cross-field | `area_breakdown_mismatch` (component areas ≠ stated total) | review | Deterministic when the components are extracted |
| Cross-field | `unit_inconsistency` (same quantity in two units that disagree) | review | Unit normalisation, then comparison |
| Cross-field | `internal_contradiction` (one fact stated twice with different values) | review | AI-flagged; must cite both quotes |
| Plausibility | `outside_bounds` | error | Existing Nairobi bounds |
| Plausibility | `distance_claim_mismatch` (a stated distance to a named place is off from the geocoded distance by >30% and >500 m) | warning | Geocode the place, then haversine |
| Plausibility | `approximate_location`, `hazard_far_from_grid` | review | Enrichment |
| Plausibility | `elevation_claim_implausible` | warning | Later; needs a DEM sample (see "Out of scope") |
| Document | `missing_valuation_basis`, `ambiguous_term`, `unsigned_declaration`, `offer_expiring`, `loss_history_gap` | warning | AI-flagged with quotes. `offer_expiring` is deterministic once the date is extracted. |

Row status: any `error` gives `rejected`, and the user can fix and resubmit. Any `review` gives `needs_review`. Any `warning` gives `accepted_with_warnings`. Otherwise the row is `accepted`. Document-level issues apply to the upload and are shown on every property promoted from it.

AI-flagged issues are always `warning` or `review` and never `error`. A model's suspicion can ask for a human decision, but it can't reject data by itself.

### 5. Promote
Accepted and accepted-with-warnings rows are upserted into `properties` by `(portfolio_id, loc_id)`. A newer upload supersedes older provenance rows and keeps them. `review_status` follows decision 3. Rows with `needs_review` wait for a user decision.

## Consumers

- **Map and portfolio routes**: add `app/services/repository.py` with the same function signatures as `dummy.py` (`list_properties`, `property_detail`, `portfolio_summary`, `list_clusters`), backed by SQLAlchemy. The routes switch imports and the response shapes stay the same, with new fields added: `reviewStatus`, `geocodePrecision`, `issueCount`. Hazard and loss fields stay `null` until a model run fills them.
- **Property drawer**: the existing `property_detail` shape, plus a `provenance` list, `issues` and `documents` (snippets from the upload the property came from, with page numbers).
- **Model runs**: the loader selects `review_status='confirmed'` rows that have no `unsupported_construction` issue, builds the canonical frame, and passes the `field_provenance` summary into the run's provenance report.
- **Chatbot** (Gemini tool calling, in Flask): the bot answers only from tool results.
  - `query_properties(filters)` runs parameterised queries over a fixed filter set. It never runs free SQL.
  - `search_documents(q)` returns chunks with page numbers, and every answer cites them.
  - `get_property(id)` returns the drawer payload.
  - `run_scenario(params)` calls the existing `/modelling/calculate` logic with confirmed rows only.
  - If a tool returns nothing, the bot says the data isn't there and asks for an upload. This is the resolver's `NeedInput` behaviour.

## Frontend changes (`furika_vote`)

1. Replace the hard-coded `PROPERTIES` and `CLUSTERS` with fetches from the API.
2. Add an upload panel: drag-and-drop, the attestation checkbox, a progress indicator, and a result summary (counts by status).
3. Add a review queue: each row shows its issues, every field shows source, quote, page and confidence, and the actions are confirm, edit or reject.
4. Add map badges: unconfirmed (hollow pin), approximate location (dashed ring), and has warnings (dot).
5. Extend the property drawer with a provenance tab, an issues tab and document snippets.
6. Point chat at Flask `/chat` and remove the OpenAI call from `server.mjs`.

## Phases

Each phase ends in something that can be demoed, plus passing tests.

| # | Scope | Done when |
|---|---|---|
| 0 | Repository layer over Postgres, a seed command that loads the 600-row synthetic CSV, and routes switched off `dummy.py` | The existing API tests pass against the DB, and the map shows seeded rows from the API |
| 1 | Upload endpoint, raw store, CSV/Excel extraction, schema-layer validation, promotion, the new tables and a migration | Uploading a CSV with renamed headers creates properties with `ai_mapped` provenance. A duplicate upload is detected. A bad row is rejected with coded issues. |
| 2 | Enrichment (geocoder, IDW hazard lookup, hotspots), cross-field and plausibility checks, review queue API and decisions | A row without coordinates is geocoded and flagged `approximate_location`. Confirming it moves it into model runs. |
| 3 | Real Gemini client (JSON mode), PDF/text extraction with quote verification, document chunks, `document_facts`, document-level checks | A redacted version of the sample memo produces the expected issues (see the test fixture below), and the broker line is stored as an `opinion` |
| 4 | Chat moved to Flask with the four tools and citations | "What is the flood deductible?" returns the quote with its page. "Buildings above KES 30m in Mathare" returns rows from the DB. |
| 5 | Frontend: upload panel, review queue, badges, drawer tabs | End-to-end demo: upload → review → confirm → run → drawer shows provenance |

Phases 0 to 2 need no AI key. With a fake LLM they're fully deterministic, so they're the safest to finish first.

## Testing

- Unit tests per check code, using small DataFrames.
- A `FakeLLM` that implements `json(system, user)` with canned responses, including one with a fabricated quote (must be dropped) and one with a wrong page number.
- Fixture: `tests/fixtures/memo_redacted.txt`, a redacted, synthetic copy of the sample memo. Expected issues: `area_breakdown_mismatch` (28,680 vs 24,500 m²), `unit_inconsistency` (45,000 m³/month vs 45,000 L/day), `internal_contradiction` (fuel tanks in Basement 1 vs Basement 2), `distance_claim_mismatch` (Kibra 2.1 km vs about 5.0 km), `missing_valuation_basis`, `ambiguous_term` (the 5% deductible), `unsigned_declaration`, `loss_history_gap`, `unsupported_construction`.
- Full-text search uses Postgres `tsvector`. The SQLite test config falls back to `ILIKE`, behind a single function, so tests still run without Docker.

## New dependencies

`openpyxl`, `pypdf`, `google-genai`. Geocoding uses the Google Geocoding REST API, called with the server-side key via `urllib`, so no extra SDK is needed.

## Out of scope for now

OCR of scanned PDFs, elevation and DEM checks, an RCC / basement vulnerability class (rows are flagged, not modelled), access control beyond the current dummy auth, background workers, and object storage.

## Phase 4 notes (chat, workflow, map)

- **Chat** (`app/services/chat.py`, `chat_provider.py`):
  - Answers from database evidence: a portfolio overview (by class, review status and hazard source; highest TIV and highest hazard properties; approved AAL when a run is approved), the selected uploads' rows, chunks and facts (or the three most recent parsed uploads when none are attached), plus named properties and hotspots.
  - Providers: Gemini first, then Claude through the shared `llm.ClaudeService` (`claude-opus-5-5`, refusal fallbacks). `CLAUDE_CODE` is accepted as an alias for `ANTHROPIC_API_KEY`.
  - When both providers fail, it returns a data-only summary and says why, instead of a 503.
- **Workflow:** `/model-runs` runs `furika_model.run_model` on confirmed properties with all five scores, stops at `review`, and on approval writes `HazardResult`/`LossResult` per property.
- **Map:** properties from `/portfolios/{id}/properties`, hotspots from `/locations/hotspots`.
- **Tables printed to PDF** (`pdf_tables.py`):
  - The column layout comes from standard header names, with no AI; Claude reads the first lines only when the names are non-standard.
  - The server builds the row pattern from fixed sub-patterns and parses every line deterministically. Lines that don't match are reported as `unparsed_line`.
  - `POST /uploads/{id}/reprocess` rebuilds an upload's derived records, for example after adding the key or credit.

## Phase 3 notes

Built in `app/services/llm.py` (Claude client), `app/services/ingestion/documents.py`, the document branch of `pipeline.py`, new endpoints in `app/api/uploads.py` / `portfolios.py`, and the Data Sources screen in `furika_vote/src/main.jsx` (+ `src/api.js`). Tests are in `tests/test_documents.py`.

- **Parsing moved from Gemini to Claude.** Column mapping and document extraction use `claude-opus-5-5` through the Anthropic SDK with structured outputs (`output_config.format` with a JSON schema; the mapping schema restricts `field` and `column` to the real candidates) and server-side refusal fallbacks (`fallbacks: "default"`). Key: `ANTHROPIC_API_KEY` in `backend/.env`; optional `CLAUDE_MODEL`. `run.py`/`wsgi.py` now load `.env`. Gemini remains only behind the placeholder chat routes.
- **Accepted files:** any type. CSV/XLSX → table pipeline; PDF/DOCX/TXT/MD → document pipeline; everything else is stored and hashed with status `stored`. Known types must still match their leading bytes.
- **Background processing:** documents run in a background thread (`INGESTION_ASYNC`, off in tests), so the upload returns `queued` and the client polls `/uploads/{id}`. Statuses: `queued → extracting → validating → done | rejected | extraction_failed | failed`.
- **Text and search:** pypdf (per page), python-docx (paragraphs and tables in order; one "page"), and plain text (pages split on form feeds). Text is chunked (~1,500 chars) into `document_chunks`. `GET /portfolios/{id}/documents/search?q=` uses Postgres full-text search (substring match on SQLite) and returns file, page and snippet. Documents are indexed even without a Claude key (`ai_unavailable` warning).
- **Extraction:** PDFs go to Claude as base64 `document` blocks; DOCX and text go as page-marked text. Claude returns buildings (canonical fields), facts (`fact` / `term` / `claim` / `opinion`, so a broker's "ACCEPT" is stored as an opinion, not a finding) and findings, each with a quote, page and confidence.
- **Quote check:** every quote must appear (after NFKC, case and punctuation normalisation) in the document's own text. The page is corrected when the quote is on a different page; unmatched values, facts and findings are dropped with `ai_quote_not_found` (info). Numeric values must also appear in their quote (`value_not_in_quote`, warning). Scanned PDFs (no text layer) raise `no_text_layer`, and their values get `quote_unverified` (review).
- **Buildings:** extracted buildings go through `evaluate_row` like spreadsheet rows (geocoding, hazard lookup, `unsupported_construction` for RCC, …) with `method=ai_extracted`. They are never auto-confirmed, so they land in the review queue. A missing location ID is generated as `DOC-<upload>-<n>`.
- **Document checks:**
  - Deterministic: `area_breakdown_mismatch` (component areas vs stated gross; this replaces the AI's version of the same finding), `offer_expiring` (≤ 14 days or past), and `distance_claim_mismatch` (geocodes the named place, compares with the building; needs the geocoder).
  - AI-flagged, quote-backed warnings: `internal_contradiction`, `unit_inconsistency`, `missing_valuation_basis`, `ambiguous_term`, `unsigned_declaration`, `loss_history_gap`, `elevation_claim_implausible`.
  - Document-level issues appear on every property that document promoted (`scope: "document"` in property detail warnings).
- **New endpoints:** `GET /uploads/{id}/facts`, `DELETE /uploads/{id}` (reverts or removes the properties it last wrote, then deletes rows, issues, facts, chunks and the stored file; 409 while processing) and the document search above.
- **Data Sources UI:**
  - Lists uploads from the backend and polls while any are processing. Accepts any file by drag-and-drop or browse.
  - Requires choosing *Synthetic data* or *Redacted documents*; the choice is sent as `attestation` and remembered in the browser.
  - Shows status tones, a per-row summary, and expandable details (checks with quotes and pages, extracted facts, a link to the original). Delete has an inline confirm.
  - Chat attachments still use the text of text-like files cached in the browser until Phase 4.
- **Schema changes:** new tables `document_chunks` and `document_facts`. Recreate the local database (`init-db` on an empty database).
- **Not done:** OCR beyond what Claude reads from a scanned PDF (those values always need review), `.doc`/`.xls` (stored only), and a live run against the Claude API. The request shape was checked against the SDK, but extraction quality on real documents still needs testing once the key is set.

## Phase 2 notes

Built in `app/services/ingestion/enrichment.py` (`evaluate_row`), `review.py`, `app/services/geocoding.py`, `app/services/reference.py`, `app/api/locations.py`, and the review routes in `app/api/uploads.py` / `portfolios.py`. Tests are in `tests/test_enrichment_review.py`.

- **One evaluation path:** uploads, review edits and `POST /portfolios/{id}/properties` all run parse → locate → bounds → hazard lookup → hotspots → plausibility.
- **Geocoding:** used only when both coordinates are missing and an `address` column (new optional canonical field) is present. The query is `address, region, Nairobi, Kenya`, biased to Kenya and the Nairobi bounds. Precision comes from Google's `location_type`/`types`; anything coarser than `street` raises `approximate_location` (review). If no address is given, that's an error. If the geocoder isn't configured, fails or finds no match, the row gets `geocode_failed` (review, edit required). `/locations/geocode` is real: 503 without a key, 404 for no match, 502 on a provider error.
- **Hazard grid:** `seed-reference` copies the reference upload's accepted rows with supplied scores into `hazard_reference_points`. Rows without scores get inverse-distance weighting (k=4, power 2); an exact location match takes that point's scores. Provenance is `method=lookup` and lists the points used. If the nearest point is more than 0.5 km away, the row gets `hazard_far_from_grid` (review, confirmable). With no grid loaded it falls back to `hazard_missing` as before.
- **Hotspots:** `seed-reference --hotspots file.csv` (or `data/reference/hotspots.csv` if present) replaces the hotspot list. Rows outside Nairobi are skipped and reported, and distances are refreshed for every property. Properties store `nearest_hotspot_km` (powers the `nearHotspotKm` filter) and hotspots within 3 km.
- **New checks:** `hazard_non_monotonic` (warning; reuses the model's rarity order), `cost_outlier` (warning; cost per m² more than 3× away from the reference median for the class, needs at least 5 reference points), `duplicate_location` (warning; same coordinates as an earlier non-rejected row in the file).
- **Not built (needs documents or a DEM):** `area_breakdown_mismatch`, `unit_inconsistency`, `internal_contradiction` and `distance_claim_mismatch` move to Phase 3, where they apply to extracted documents. Elevation stays out of scope. Coordinates that are *supplied* are not geocoded for cross-checking, to avoid one API call per row.
- **Review queue:** `GET /portfolios/{id}/review-queue` lists `needs_review` rows and rows whose live property is unconfirmed (low-confidence AI mapping).
- **Decisions:** `POST /upload-rows/{id}/decision` takes `confirm`, `reject` or `edit`.
  - `confirm` accepts `approximate_location` and `hazard_far_from_grid`. It refuses (409) rejected rows and rows with `unsupported_construction` or `geocode_failed`, which need an edit.
  - `reject` restores the property from its previous accepted row, or deletes it if this row created it.
  - `edit` overlays values as `method=user`, supersedes the row's old issues and provenance, re-runs the evaluation, and promotes the row as confirmed if it passes. If an edit breaks a live row, the property is reverted. `loc_id` is locked once the row is live.
- **Manual properties:** `POST /portfolios/{id}/properties` accepts `address` instead of coordinates. Errors and edit-required issues return 422. Confirmable review issues create the property as `unconfirmed`, and the response includes `issues`.
- **Schema changes:** new tables `hazard_reference_points` and `hotspots`; new columns `properties.nearest_hotspot_km` and `upload_rows.review_comment`. Re-run `init-db` on a fresh database. An existing local database needs dropping first, because `create_all` doesn't add columns.

## Phase 0 notes

Built in `app/services/repository.py`, `flask --app run.py seed-reference`, and `furika_vote/src/PortfolioScreen.jsx`. Tests are in `tests/test_repository.py`; `tests/test_api.py` now runs against a database seeded from `tests/fixtures/reference_sample.csv`.

- **Routes on the database:** summary, properties (list, create, detail, hazard, loss) and clusters read Postgres. Unknown portfolios and properties return 404.
- **Still dummy:** model runs, chat, export and auth. (Geocoding became real in Phase 2.)
- **Pending model results:** hazard band, flood probability, AAL and losses are `null` / `"pending"`, because nothing writes `HazardResult`/`LossResult` yet. Filters that need them (`hazardBand` other than `pending`, `minProbability`, `aiFlagged=true`) return no rows. `nearHotspotKm` returns 400 until hotspots are loaded (Phase 2 loads them).
- **Shown before a model run:** the five supplied proxy scores (`hazardScores`) and, in the detail view, depth = score × `DEFAULT_D_MAX` with the return periods from `DEFAULT_TIER_RP`, labelled `assumed`.
- **Seeding:** `seed-reference` sends the reference CSV through the normal upload pipeline, so seeded rows get provenance like any other upload. Re-running it is a no-op, because the hash is already in the portfolio.
- **Manual properties:** `POST /portfolios/{id}/properties` runs the same row checks as uploads (422 on errors, 409 on a duplicate ID) and records `method=user` provenance.
- **Frontend:** the portfolio screen fetches from `VITE_API_BASE_URL` (default `http://localhost:5000/api/v1`) and portfolio `VITE_PORTFOLIO_ID` (default `SYN-PORT-142`). It shows loading and error states, grey "pending" pins, hollow unconfirmed pins, and warning counts. The drawer loads `/properties/{id}`, and the hard-coded driver bars and loss figures are gone. Searching a coordinate or an address shows a proxy built from the three nearest records' hazard scores.
- **Gap:** no phase in this plan turns model runs into real `HazardResult`/`LossResult` rows. `furika_model.run_model` already does the calculation. Wiring `/model-runs` to it (confirmed rows only) is what fills the pending fields, and it should be scheduled.

## Phase 1 notes

Built in `app/services/ingestion/` (storage, extract, mapping, validation, pipeline), `app/api/uploads.py`, and new models in `app/models.py`. Tests are in `tests/test_ingestion.py`. Where the build differs from the plan above:

- **No migration file.** `migrations/` is git-ignored and no database exists yet, so `flask --app run.py init-db` creates the new tables. Switch to Flask-Migrate once a shared database holds data worth keeping.
- **Re-uploading an existing `loc_id` in the same portfolio updates it** (`updates_existing`, info). It is not an error. Earlier upload rows stay as history in `/properties/{id}/provenance`.
- **Provenance is stored per upload row** (`subject_type="upload_row"`). A property's current provenance comes from its latest promoted row, so nothing is copied.
- **Hazard scores are optional at ingestion.** If none are supplied, `hazard_missing` is raised and `hazard_source` is set to `missing`, ready for Phase 2's lookup. If only some are supplied, the row is rejected.
- **Coordinates are required for now.** Phase 2 geocoding will relax this.
- **PDF, TXT and MD files are stored and hashed** with status `pending_extractor` until Phase 3.
- **The portfolio is created automatically** on its first upload when it doesn't exist (Phase 0 seeding would normally create it).
- **Header matching** ignores case and punctuation, so `Floor Area m2` matches `floor_area_m2` as `exact`. Anything else goes to Gemini (`GeminiService.json`, REST via `urllib`). If Gemini is unavailable, an `ai_mapping_unavailable` info issue is recorded and only exact matches are used.

## Resolved questions (2026-10-08)

1. **Chat location:** chat moves to Flask + Gemini. `furika_vote/server.mjs` stops calling OpenAI; the frontend calls Flask `/chat` directly.
2. **Hazard for new buildings:** IDW from the nearest scored reference points is accepted, labelled `hazard_source=interpolated`.
3. **Reference files:** the 600-row exposure CSV and the hotspot file are committed under `backend/data/reference/`. They are small and synthetic, so versioning them keeps interpolated hazard scores reproducible. `flask --app run.py seed-reference` loads them into Postgres. User uploads go to `STORAGE_ROOT` on disk, which is git-ignored.
4. **Geocoder:** Google Geocoding API with a server-side key (`GOOGLE_MAPS_API_KEY` in `backend/.env`). Store the key separately from the browser key, restricted by IP or API instead of by HTTP referrer. Tests use a fake geocoder.
5. **Confirmation strictness:** AI column mappings with confidence ≥ 0.9 are auto-confirmed. Lower-confidence mappings, AI-extracted PDF/text values and any row with a `review` issue still need a user to confirm them.
