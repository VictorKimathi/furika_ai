# Reference data: one versioned baseline for the whole system

Status: proposed · Supersedes the loading steps in `accumulation-map-plan.md` (its map behaviour still applies)

## Decision

An upload in the Data store can be promoted to a **reference set**. The active reference sets are the baseline the whole system reads from:

- the map draws them on load, before any portfolio is chosen;
- the model uses them to fill in missing hazard scores;
- every new upload is checked against them;
- the pipeline, metrics and chat explain results relative to them.

There are two kinds, because they answer different questions:

| Kind | Content | Question it answers |
|---|---|---|
| `hazard_grid` | Scored locations: `lat`, `lon` and five 0–1 tier scores | What does the model say about flood susceptibility here? |
| `flood_evidence` | Documented flood locations: `name`, `lat`, `lon`, optional `severity` | Where is flooding known to happen? |

Exactly one set of each kind is active at a time. Sets are versioned and never edited in place. Every model run records the versions it used.

The UI calls these **Reference**, not "ground truth". The evidence list is incomplete: the current terrain proxy misses drainage-driven flooding (Kibera, Westlands, Lavington), so a place missing from the list is not proven dry.

## Why: what is wrong today

| # | Today | Consequence |
|---|---|---|
| 1 | The reference can only be set from the CLI (`seed-reference`, `app/__init__.py:76`). | Underwriters cannot choose or replace the baseline. |
| 2 | `load_reference_points` (`services/reference.py:17`) only adds points whose `loc_id` is new; it never retires old ones. | Two grids silently merge. There is no "current" grid. |
| 3 | `load_hotspots` deletes and replaces every hotspot (`services/reference.py:60`); there is no upload link, only `source_sha256`. | No history and no way back. Property distances go stale until `refresh_hotspot_distances` is run by hand. |
| 4 | The reference upload also becomes 600 `Property` rows in `SYN-PORT-142`, and is hidden with `excludeReference` by joining through `HazardReferencePoint.source_upload_id` (`repository.py:195`). | "Reference" and "insured book" are the same rows, told apart by a side effect. |
| 5 | Model runs do not record which grid or hotspot list they used. | Results cannot be reproduced after the reference changes. |
| 6 | The hotspot check counts a hit if the *nearest property, at any distance* has a score above 0 (`furika_model.py:275`). | "12 of 24" overstates agreement. A property 3 km away can make a hotspot a "hit". |
| 7 | The frontend hard-codes reference facts: an unused `HOTSPOTS` list (`main.jsx:98`), `hotspotsValidated: 12, hotspotsTotal: 24` (`main.jsx:116`) and canned chat text (`main.jsx:344`). | The map and chat can contradict the data actually loaded. |
| 8 | The main map loads portfolio properties and hotspot pins only; just the Accumulation screen fetches the grid (`/locations/flood-reference`). | The map is empty until a portfolio exists, and susceptibility is never shown next to the evidence. |

## Data model

The schema has no migrations folder today (`init-db` runs `db.create_all()`). **Step 0 is to initialise Flask-Migrate** (`flask db init`, then a baseline revision of the current schema), because the changes below alter existing tables.

### New table `reference_sets`

| Column | Type | Notes |
|---|---|---|
| `id` | string(36) PK | |
| `kind` | string(30), not null | `hazard_grid` or `flood_evidence` |
| `version` | int, not null | 1, 2, 3… per kind; unique with `kind` |
| `upload_id` | FK `uploads.id`, nullable | Null only for backfilled legacy sets |
| `label` | string(180) | e.g. "Nairobi terrain proxy, Oct 2026" |
| `source_note` | text | Who produced it, when, and its known limits |
| `status` | string(20), not null | `draft` → `active` → `retired` |
| `row_count`, `skipped_count` | int | From validation |
| `sha256` | string(64) | Of the source file |
| `settings` | JSON | Matching thresholds in force (below) |
| `summary` | JSON | Coverage and agreement figures, computed on activation |
| `activated_by`, `activated_at` | FK users, datetime | |

Constraint: a partial unique index on `(kind) WHERE status = 'active'`, so there can never be two active sets of one kind.

### Changed tables

- **`hazard_reference_points`**: add `reference_set_id` (FK, not null after backfill). The primary key becomes `(reference_set_id, id)`, so the same `loc_id` can exist in several versions. Every read filters by the active set.
- **`hotspots`**: add `reference_set_id` (FK, not null after backfill) and `upload_id`. Activating a new set no longer deletes the old rows.
- **`model_runs.configuration`**: add `reference: {hazard_grid: {id, version}, flood_evidence: {id, version}}`, written when the run starts.
- **`properties.attributes.reference_check`** (JSON, no column change): the result of the new-data check below, with the set versions it used.

### New table `evidence_agreement`

One row per evidence point per (evidence set, grid set) pair, computed on activation:

| Column | Notes |
|---|---|
| `evidence_set_id`, `hazard_set_id`, `hotspot_id` | Composite PK |
| `status` | `agrees`, `misses` or `no_coverage` |
| `max_score`, `max_score_tier` | Highest score among grid points within the radius |
| `points_within` | Grid points within the radius |
| `nearest_km` | Distance to the nearest grid point |

## Matching rules

These replace `validate_hotspots`. They live in one module (`services/reference_match.py`), and the values in force are stored in `reference_sets.settings`, so every result can be explained later.

| Setting | Default | Meaning |
|---|---|---|
| `match_radius_km` | 0.5 | Search radius around an evidence point. Same as `MAX_GRID_DISTANCE_KM` today. |
| `high_score` | 0.4 | A grid point at or above this score in any tier counts as "the model flags flooding". |
| `disagree_delta` | 0.25 | A supplied score differs "materially" from the grid when it differs by more than this. |

**Evidence point status** (shown on the map):

- `agrees`: at least one grid point within `match_radius_km` has a max-tier score ≥ `high_score`.
- `misses`: grid points exist within the radius, but all score below `high_score`. **The model probably underestimates here.**
- `no_coverage`: no grid point within the radius, so the model can't judge.

**Grid point flag** (no table needed; computed in the layer endpoint): `model_only` when the score is ≥ `high_score` and no evidence point is within the radius. This means unconfirmed, not wrong.

## Checking new data against the reference

This runs inside the existing ingestion enrichment step (`services/ingestion/enrichment.py`), for every property row. It also runs again for all properties when a reference set is activated.

| Check | Rule | Recorded as |
|---|---|---|
| Reference score | IDW from the active grid (existing: k = 4, power = 2) | `reference_check.reference_scores` |
| Outside coverage | Nearest grid point > `match_radius_km` | Existing warning; keep it |
| Score disagrees | Supplied score differs from the reference score by > `disagree_delta` in any tier | `ValidationIssue` code `reference_score_disagrees`, severity `warning` |
| Near a missed flood | Within `match_radius_km` of an evidence point with status `misses` | `ValidationIssue` code `near_missed_evidence`, severity `review` |
| Nearest evidence | Name, distance and status of the nearest evidence point | `reference_check.nearest_evidence`; replaces `nearby_hotspots` and `nearest_hotspot_km` (3 km radius) |

Activating a new set **does not change existing model runs**, because they keep the versions they recorded. The run summary then shows "Based on reference v1; v2 is active. Recalculate to update."

## API

New endpoints:

| Method and path | Purpose |
|---|---|
| `POST /api/v1/uploads/{id}/reference` `{kind, label, sourceNote}` | Validate the upload as that kind and create a `draft` set. Returns row counts, skipped rows and an **agreement preview** against the other active set. |
| `POST /api/v1/reference-sets/{id}/activate` | In one transaction: retire the current active set of that kind, activate this one, compute `evidence_agreement`, rerun property checks and store `summary`. Records `activated_by`. |
| `GET /api/v1/reference-sets?kind=&status=` | History for the Data store. |
| `GET /api/v1/reference-layer` | Everything the map needs in one payload: active set metadata; grid points (`id, lat, lon, scores, modelOnly`); evidence points (`id, name, lat, lon, severity, status, maxScore, nearestKm`); `summary` counts. Sends an `ETag` built from the active set ids, so the browser caches it until a set changes. |

Changes to existing endpoints:

- `GET /locations/hotspots` and `GET /locations/flood-reference` read from the active sets and are marked deprecated; remove them one release after the frontend switches to `/reference-layer`.
- `excludeReference` filters by `reference_sets.upload_id` (active or retired) instead of joining `hazard_reference_points`. The promoted upload's `Property` rows stay untouched, so the demo portfolio keeps working.
- Property payloads gain `referenceCheck`.
- `seed-reference` becomes upload → `POST …/reference` → `activate`, the same code path as the UI. It no longer writes the tables directly.
- Metric `HAZ-07` uses `evidence_agreement`. Its display becomes three counts (illustrative: "agrees 9 · misses 11 · no coverage 4"), not a single hit-rate.

## Frontend

**Map** (`MapWorkspace` and `AccumulationScreen`): fetch `/reference-layer` once when the app starts, independent of any portfolio. Draw these layers in this order:

1. Susceptibility grid for the selected tier, coloured by score (existing tier control).
2. Evidence points coloured by status: agrees, misses, no coverage. They have a legend and a text label, never colour alone, and misses are drawn on top.
3. Portfolio properties above both. Their popup shows `referenceCheck`: reference score versus supplied score, and the nearest evidence point with its status.

With no portfolio uploaded, the map shows layers 1 and 2 only. That is the "map already populated" requirement.

**Data store** (`DataSourcesScreen`):
- Each eligible upload gets a **Use as reference** action. It opens a dialog: choose the kind, enter a label and source note, see the preview (rows accepted or skipped, coverage, agreement versus the current set), then **Activate**.
- Active sets show a `Reference · v2` badge.
- A **Reference history** list per kind shows label, version, date, who activated it, and **Restore** (activates an older version).

**Remove hard-coded reference facts:** delete `HOTSPOTS` (`main.jsx:98`) and `MODEL_FACTS.hotspotsValidated` and `hotspotsTotal` (`main.jsx:116`). Build the canned chat answer at `main.jsx:344` from `/reference-layer` `summary`.

**Pipeline:** the Flood exposure stage shows one line from the run's recorded agreement, e.g. (illustrative numbers) "Model agrees with 9 of 24 documented flood spots; misses 11", followed by the list of misses.

**Chat** (`services/chat.py` context): include the active set labels and versions, the agreement summary, and, for a selected location, its `referenceCheck`. Answers about a location must name the evidence point and its status.

## Migration of existing data

1. Initialise Flask-Migrate with a baseline revision of the current schema.
2. Create `reference_sets` and `evidence_agreement`, and add the new columns as nullable.
3. Backfill `hazard_grid` v1: one set per distinct `hazard_reference_points.source_upload_id`. If there is more than one, the newest becomes `active` and the rest `retired`. Point the rows at their set.
4. Backfill `flood_evidence` v1 from the current `hotspots`, with `upload_id` null and `sha256` from `source_sha256`, as `active`.
5. Make the FKs not null, change the `hazard_reference_points` primary key, and add the partial unique index.
6. Run activation side effects for both v1 sets (agreement and property checks), so the stored figures follow the new rule.

## Delivery phases

| Phase | Scope | Done when |
|---|---|---|
| 1. Versioned reference | Steps 0–6 of the migration, `reference_sets`, activate endpoint, `seed-reference` through the same path, run records versions | Activating v2 leaves v1 intact; old runs still report v1; there is never more than one active set per kind |
| 2. Agreement on the map | `reference_match.py`, `evidence_agreement`, `/reference-layer`, map layers, hard-coded facts removed | With no portfolio, the map shows grid and evidence with agrees, misses and no coverage; counts match `HAZ-07` |
| 3. Data store control | Use as reference dialog with preview, badges, history, restore | An underwriter can promote an upload, see the preview, activate it and restore the previous version, without the CLI |
| 4. New data checks | Ingestion checks, `ValidationIssue` codes, re-check on activation, pipeline and chat wiring | An uploaded property within 0.5 km of a missed evidence point appears in the review queue with `near_missed_evidence` |

Tests to add (pytest, `backend/tests`): matching-rule edge cases (exactly at the radius, exactly at the threshold, no grid); the single-active constraint under concurrent activation; restore; the backfill against a copy of today's schema; and property re-check after activation.

## Open questions

1. **Thresholds:** are 0.5 km and a 0.4 score right for Nairobi? Should they be set per reference set (for example, a coarser grid needs a larger radius)?
2. **Who may activate:** authentication is a stub today (`api/auth.py`, one dummy user). Until real roles exist, activation is open to anyone, so a role check (`modeller` or `admin`) needs real login first.
3. **Evidence severity:** should a high-severity missed point raise `review` while a low-severity one only raises `warning`?
4. **A third kind, `baseline_book`:** comparing a new offer with the confirmed insured book for accumulation is partly covered by the offer review today. Decide whether it becomes a reference kind or stays a portfolio feature.
5. **Polygons:** the evidence is points only. If flood-extent polygons become available, `flood_evidence` should accept GeoJSON, and "agrees" should become "the grid scores high inside the polygon".
