# Furika AI: models, performance and accuracy

Status: as built, 2026-10-08. Covers every model in the running system, how fast each one runs, and what is known about its accuracy.

Companion documents: the team's *System Documentation* and *Architecture Document* (design, pre-build), the *Metrics Catalogue by Stage*, and `docs/ingestion-plan.md` (data pipeline build notes).

All numbers below come from `scripts/benchmark_models.py`, run on the 600-building reference portfolio (`exposure_nairobi_with_hazard`). They can be reproduced with:

```bash
cd backend
PYTHONPATH=. python scripts/benchmark_models.py path/to/exposure_nairobi_with_hazard.pdf
pytest            # 82 automated tests
```

---

## 1. Summary

| # | Model | Type | Where | Accuracy status |
|---|---|---|---|---|
| 1 | Hazard: score to depth, tier to return period | Deterministic, assumed | `services/furika_model.py` | Internally consistent. **Not validated against observed flooding** |
| 2 | Hazard for new buildings: inverse-distance interpolation | Statistical | `ingestion/enrichment.py` | **Measured**: leave-one-out error 32–46% below a mean-score baseline |
| 3 | Vulnerability: sigmoid depth–damage curves (4 classes) | Deterministic, assumed | `furika_model.py` | Curve checks pass. **Not calibrated to Kenyan claims** |
| 4 | Financial engine: loss, EP curve, AAL | Deterministic | `furika_model.py`, `model_runs.py` | Reconciles exactly. Loss rises with rarity. AAL reported as a range |
| 5 | Portfolio analytics: bands, accumulation, clusters, rank | Deterministic | `repository.py`, `run_metrics.py` | Rule-based; thresholds are assumptions |
| 6 | Sensitivity runs | Deterministic | `run_metrics.py` | Measured (section 9.3) |
| 7 | PDF and text table reader | Rule-based (AI fallback) | `ingestion/pdf_tables.py` | 600 of 600 rows parsed, 0 lines skipped |
| 8 | Column mapping | Exact match, then Claude | `ingestion/mapping.py` | Guarded. **Accuracy not measured** |
| 9 | Document extraction | Claude, quote-verified | `ingestion/documents.py` | Guarded. **Accuracy not measured** (no live run yet) |
| 10 | Geocoding | Google Geocoding API | `services/geocoding.py` | Precision recorded per result. Not benchmarked |
| 11 | Chat analyst | Claude, then Gemini | `services/chat.py`, `chat_provider.py` | Evidence-grounded by design. **Grounding not measured** |

Overall: the calculation chain (models 1, 3 and 4) is deterministic, reproducible and passes every internal consistency check. **No model in the system has been validated against observed losses or observed flood extents**, because none are available for this synthetic portfolio. Treat every loss figure as a scenario-based prototype estimate, not a calibrated catastrophe-model output.

---

## 2. Data that the models run on

| Input | Source | Tag |
|---|---|---|
| 600 buildings: location, housing class, floor area, cost per m², TIV | Starter kit `exposure_nairobi_with_hazard` | Synthetic |
| Five hazard scores per building (common … extreme), 0–1 | Starter kit (terrain 45%, depressions 20%, slope 15%, OSM rivers 20%) | Proxy |
| Return periods, D_max, curve parameters | Model configuration | Assumed |
| Named flood hotspots | Starter kit (24 points) | Real. **Not loaded in this deployment** |

Reference portfolio as modelled:

| Class | Buildings | TIV | Share of TIV |
|---|---|---|---|
| concrete_rcc | 84 | KES 54.2 bn | 85.1% |
| permanent_masonry | 156 | KES 8.45 bn | 13.3% |
| semi_permanent | 181 | KES 851 m | 1.3% |
| informal_iron_sheet | 179 | KES 198 m | 0.3% |
| **Total** | **600** | **KES 63.7 bn** | |

Two data facts drive the results:
- **Value is concentrated in RCC.** 84 RCC buildings hold 85% of the value, so RCC dominates portfolio loss (63% of the 1-in-250 loss).
- **TIV is consistently 10× floor area × cost per m².** All 600 rows show this (median ratio 10.00). The model keeps the supplied TIV and flags it (`tiv_mismatch`, metric ING-05). If TIV was meant to equal area × cost, every loss figure here is 10× too high.

---

## 3. Hazard model

**Purpose:** turn each building's 0–1 susceptibility score into a flood depth for five scenarios, each with a return period.

### 3.1 Score to depth

```
depth_k = clip(score_k, 0, 1) × D_max          D_max = 4.0 m (assumed)
depth_k = 0 where depth_k < wet_threshold      wet_threshold = 0 m
```

The score is a terrain susceptibility proxy, not a measured depth. Depth is therefore assumed, and it is labelled "proxy depth" everywhere in the UI.

### 3.2 Tier to return period

| Tier | Return period | Annual exceedance probability | Buildings wet (reference portfolio) |
|---|---|---|---|
| extreme | 10 years | 10% | 32 |
| severe | 25 years | 4% | 51 |
| moderate | 50 years | 2% | 110 |
| occasional | 100 years | 1% | 174 |
| common | 250 years | 0.4% | 259 |

**Why this ordering.** In the starter data, scores *fall* from `common` to `extreme` for every building (NBO-0002: 0.458 → 0.135), and the flooded footprint shrinks from 259 buildings to 32. The design document (section 2.2) anticipated this. If the tier labels are taken literally (common = frequent), loss falls as floods get rarer, which is physically wrong. The implemented model takes the design document's "labels reversed" option: the tier with the widest footprint (`common`) is the rarest event. The model enforces this direction (`validate_tier_rp`) and checks it every run (HAZ-03 nesting check: 0 violations).

**Not implemented:** design Option A (a single footprint with rarity multipliers on depth) and Option B (forced monotonicity plus uplift).

### 3.3 Flood probability per building

```
p_flood = 1 / RP_first      RP_first = the shortest return period whose depth > 0
```

Buildings that no scenario reaches have no modelled flood probability. Risk bands come from p_flood: **severe** ≥ 10%, **high** ≥ 4%, **moderate** ≥ 1%, otherwise **low**.

### 3.4 Hotspot uplift (built, switched off)

`hotspot_uplift()` implements the design's drainage uplift, `u(x) = Σ w(severity) × exp(−d/r)` with r = 1 km, applied as `min(1, score + u)`. It is **off** in every run: the AI pipeline that would produce the hotspot evidence (design section 5.1) is not built, and no hotspot file is loaded.

---

## 4. Hazard interpolation for new buildings

**Purpose:** give buildings uploaded without hazard scores a proxy score, so that they can be modelled.

```
score_k(x) = Σ w_i score_k(i) / Σ w_i      over the 4 nearest scored reference points
w_i = 1 / d_i²                              (exact location match: that point's scores)
```

Provenance is recorded as `method=lookup`, with the points used. If the nearest point is more than 0.5 km away, the building goes to review (`hazard_far_from_grid`).

Accuracy is measured in section 9.2. It is the only model in the system with a measured predictive accuracy.

---

## 5. Vulnerability model

**Purpose:** turn depth into a mean damage ratio for each construction class.

```
DR(d) = dr_max × [σ(k(d − d50)) − σ(−k·d50)] / [1 − σ(−k·d50)]      σ = logistic; DR(0) = 0, DR ≤ dr_max
```

| Class | dr_max | d50 (m) | k | Source / status |
|---|---|---|---|---|
| informal_iron_sheet | 0.95 | 0.55 | 3.5 | Adapted from JRC/Huizinga, open |
| semi_permanent | 0.85 | 0.80 | 3.0 | Adapted from JRC/Huizinga, open |
| permanent_masonry | 0.65 | 1.20 | 2.4 | Adapted from JRC/Huizinga, open |
| concrete_rcc | 0.39 | 1.60 | 2.2 | 0.6 × masonry, from prototype weights (RCC 0.30 vs masonry 0.50); open |

Damage ratio at sample depths:

| Depth | Informal | Semi-permanent | Masonry | RCC |
|---|---|---|---|---|
| 0.25 m | 14.4% | 7.2% | 2.7% | 0.8% |
| 0.5 m | 35.8% | 19.1% | 7.1% | 2.1% |
| 1 m | 76.3% | 52.1% | 22.6% | 7.3% |
| 2 m | 94.3% | 82.5% | 56.2% | 27.2% |
| 4 m | 95.0% | 85.0% | 64.9% | 38.8% |

Checks run on every model call (VUL-04, 13 checks, all pass): monotonic in depth, DR(0) = 0, capped at dr_max, and class ordering informal ≥ semi ≥ masonry ≥ RCC at every depth from 0 to 8 m.

**Differences from the design document.** The design's starting guesses were informal 0.90 / 0.4 m / 4, semi 0.85 / 0.8 m / 3, masonry 0.75 / 1.5 m / 2.5, and no RCC class. The implemented values differ. Neither set is calibrated: no Kenyan depth–damage data was available, and the digitised JRC reference points are not loaded, so the fit to reference (VUL-05) is not measured.

**Not modelled:** basements and plant rooms (flagged as `basement_not_modelled` when a description mentions them), contents separately from the building, and duration or velocity of flooding.

---

## 6. Financial engine

```
loss(i, k)  = DR(depth(i, k), class(i)) × TIV(i)                    ground-up; no deductible, limit or reinsurance
L(k)        = Σ_i loss(i, k)
EP curve    = points (RP_k, L(k)) plus anchor (1 yr, 0); linear in ln(RP); held flat beyond 250 yr
AAL         = ∫ loss d(annual probability), trapezoid on the EP curve
AAL range   = low (no tail), central, high (tail beyond 250 yr at the 250-yr loss)
```

Reference portfolio results:

| Return period | Ground-up loss | Loss ratio | Exposed TIV (depth > 0) |
|---|---|---|---|
| 1 in 10 | KES 302 m | 0.48% | KES 1.66 bn |
| 1 in 25 | KES 461 m | 0.72% | KES 5.25 bn |
| 1 in 50 | KES 822 m | 1.29% | KES 12.0 bn |
| 1 in 100 | KES 1,335 m | 2.10% | KES 19.8 bn |
| 1 in 250 | KES 2,093 m | 3.29% | KES 31.4 bn |

- **AAL:** KES 193 m – 201 m, central **KES 197 m**, which is 3.10‰ of TIV. The tail assumption adds KES 8.4 m; AAL high/low = 1.04 (FIN-15 passes, threshold 2).
- **1-in-250 loss by class:** RCC KES 1,323 m (63%), masonry KES 628 m (30%), semi-permanent KES 105 m (5%), informal KES 37 m (2%).
- **Each model run's summary** also lists the class breakdown and the 10 highest-AAL buildings.

This is a deterministic scenario curve built from five events. It is not a stochastic event catalogue, so it says nothing about correlation between locations or event frequency beyond the assumed return periods.

---

## 7. Portfolio analytics

| Model | Rule |
|---|---|
| Risk band | From the building's flood probability (section 3.3) |
| AAL rank | Position by AAL within the approved run ("Top 5% · #25 of 516") |
| Local accumulation | TIV of all buildings within 500 m (haversine) |
| Clusters | Region if present, otherwise a 0.05° grid (about 5.5 km). Loss, AAL and mean flood probability from the approved run |
| Accumulation flag | A cluster holding > 10% of TIV with mean flood probability > 1% (assumed defaults) |
| Map flood mesh | Wet buildings in the selected scenario linked to up to 3 wet neighbours within 1.2 km; groups of 4 or more connected buildings are drawn as cluster outlines |

These are presentation rules over model output. They add no predictive claim.

---

## 8. AI components

| Component | Model | Used for | Guardrails |
|---|---|---|---|
| Column mapping | `claude-opus-5-5`, structured output | Spreadsheet headers that don't match the schema | Exact matches first. Claude may only name columns that exist. A confidence of 0.9 or more is auto-confirmed; anything below goes to review |
| Document extraction | `claude-opus-5-5`, PDF document input | Buildings, facts, terms, claims, opinions and findings from PDF, DOCX and TXT | **Every value needs a verbatim quote, found on the cited page of the document's own text layer.** Unmatched values are dropped. AI-extracted buildings are never auto-confirmed. AI findings can warn but never reject |
| PDF table layout | Header names (no AI); Claude as fallback | Tables printed to PDF | The server builds the row pattern from fixed sub-patterns (Claude never supplies a regex). Every value is parsed from the text |
| Chat analyst | `claude-opus-5-5`, then Gemini (`gemini-3.8-flash`, falling back to `3.7-flash` and `3.5-flash`) | Questions about the portfolio, properties, runs and documents | Answers only from evidence the server selects from the database. Uploaded text is treated as untrusted. If every provider fails, it returns a data-only summary |
| Geocoding | Google Geocoding API | Addresses without coordinates | Precision is recorded. Anything coarser than street level goes to review |

The AI never computes a loss. It only produces data (mapped columns, extracted fields, text), and every number reported as a loss comes from the deterministic engine.

**Deployment state at the time of writing:**
- The Anthropic account has **no credit**, so every Claude call fails and the chat runs on Gemini.
- Document extraction and Claude column mapping have **only been exercised with test doubles**, not live calls.
- The PDF table route ran live, using header names with no AI needed.

---

## 9. Accuracy and validation

### 9.1 Internal consistency (run on every model run)

| Check | Result |
|---|---|
| HAZ-03 Nesting: depth never falls as RP rises | Pass, 0 violations |
| VUL-04 Curve checks (13) | Pass, 13 of 13 |
| FIN-16 Reconciliation: building sum = class sum = portfolio, per tier | Pass |
| FIN-17 Loss rises with return period | Pass |
| FIN-15 Anchor sensitivity (AAL high/low ≤ 2) | Pass (1.04) |
| Duplicates, coordinates inside Nairobi bounds | Pass |
| ING-05 TIV reconciliation (median TIV / area × cost ≈ 1) | **Warn** (10.00) |
| ING-11 Cross-field consistency | **Warn** (600 `tiv_mismatch`) |
| **Total** | **7 of 9 pass; 2 warnings, both caused by the TIV definition** |

The 82 automated tests cover these rules, the ingestion pipeline (including fabricated-quote rejection), review decisions, runs and metrics.

### 9.2 Hazard interpolation: leave-one-out accuracy

**Method:** each of the 600 reference points was predicted from the other 599. The prediction was compared with the true score, and with a baseline that predicts the mean score everywhere.

| Tier | MAE (score 0–1) | Baseline MAE | Error reduction | 90th-percentile error | Wet/dry accuracy | Recall (wet found) | Precision | Share actually wet |
|---|---|---|---|---|---|---|---|---|
| common | 0.054 | 0.101 | 46% | 0.154 | 77.5% | 68.7% | 76.7% | 43.2% |
| occasional | 0.042 | 0.078 | 46% | 0.138 | 83.0% | 63.2% | 74.3% | 29.0% |
| moderate | 0.032 | 0.056 | 43% | 0.107 | 88.0% | 60.0% | 70.2% | 18.3% |
| severe | 0.022 | 0.035 | 36% | 0.064 | 90.5% | 51.0% | 44.8% | 8.5% |
| extreme | 0.015 | 0.022 | 32% | 0.035 | 93.0% | 50.0% | 38.1% | 5.3% |

Wet = true score > 0; predicted wet = interpolated score > 0.05. The median distance to the nearest other point is 0.45 km, and 57.5% of points have a neighbour within 500 m.

How to read this:
- **Score values:** interpolation clearly beats the naive baseline, roughly halving the error in the frequent-footprint tiers.
- **Wet/dry in the rare-footprint tiers (severe, extreme):** it is no better than guessing "dry" everywhere. That guess would score 91.5% and 94.7%, against measured accuracies of 90.5% and 93.0%. It finds only about half of the wet buildings, and about half of its "wet" calls are wrong. Small flood footprints are local, and a 0.45 km point spacing can't resolve them.
- **Implication:** interpolated scores are adequate for portfolio-level losses. For individual buildings in the severe and extreme scenarios they are unreliable. These buildings are labelled `hazard_source = interpolated`, and anything more than 0.5 km from the grid goes to review.

### 9.3 Sensitivity to assumptions

| Assumption varied | 1-in-100 loss | Change | Central AAL | Change |
|---|---|---|---|---|
| Base | KES 1,335 m | | KES 197 m | |
| D_max 3 m | KES 885 m | −33.7% | KES 126 m | −35.9% |
| D_max 5 m | KES 1,788 m | +33.9% | KES 261 m | +32.3% |
| RP map 2/10/25/100/250 | KES 1,335 m | 0% | KES 314 m | +59.1% |
| Vulnerability −20% (dr_max) | KES 1,068 m | −20.0% | KES 158 m | −20.0% |
| Vulnerability +20% (dr_max, capped at 1) | KES 1,598 m | +19.6% | KES 236 m | +19.6% |

- **Which assumption matters most:** the return-period mapping drives AAL most (+59% for a plausible alternative). D_max drives the 1-in-100 loss most (±34%).
- **Effective uncertainty:** combined with the AAL tail range, the uncertainty on AAL is at least **KES 126 m – 314 m** (a factor of about 2.5) from assumptions alone, before any hazard-proxy or exposure error.

### 9.4 What has not been measured, and how to measure it

| Gap | Why | How to close it |
|---|---|---|
| Hazard vs observed flooding (HAZ-07 hotspot hit-rate) | No hotspot file loaded. The design doc reports the proxy flags 12 of 24 hotspots (not reproduced here) | Load `nairobi_hotspots_geocoded.csv` with `seed-reference --hotspots`; HAZ-07 then fills automatically |
| Loss vs observed claims | Synthetic portfolio; no claims data | Back-test against any historical event with known losses (e.g. 2024 long-rains claims), event by event |
| Vulnerability calibration (VUL-05) | No Kenyan damage data; JRC points not loaded | Load the digitised JRC Africa residential curve, report RMSE per class; replace parameters when local data exists |
| AI uplift effect (HAZ-08, AI-06, AI-07) | Uplift pipeline not built | Build design section 5.1 with a hold-out of 12–15 hotspots |
| Column mapping and extraction accuracy (AI-01 to AI-03) | No live Claude runs yet (no credit) | Hand-label about 50 fields from 5 documents; report accuracy per field and calibration by confidence |
| Chat grounding (AI-11, AI-12) | Answers are not logged | Log answers and citations; sample-check numbers against the database |
| Stochastic uncertainty | Five deterministic scenarios only | Design "stretch": Monte Carlo year-loss simulation |

21 of the 87 catalogue metrics are not measurable yet for these reasons: ING-08, ING-09, HAZ-07, HAZ-08, VUL-05, EXP-05, FIN-10, FIN-12 to FIN-14, AI-01 to AI-03, AI-06, AI-07, AI-10 to AI-14, and TRU-07. The other 66 are computed for every run.

---

## 10. Performance

Measured on an Intel Core i5-8365U (8 threads, 1.6 GHz), 15 GB RAM, Python 3.14, pandas 3.0, numpy 2.5. The API was measured in-process against SQLite in memory; PostgreSQL adds network and disk time.

| Operation (600 buildings) | Time |
|---|---|
| Core model (`run_model`: 5 tiers, depth, damage, loss, EP, AAL) | 0.22 s |
| Model run via API (model, per-building EP/AAL, 6,000 result rows, top risks) | 6.2 s |
| Approve run | 0.01 s |
| Metrics catalogue, 87 metrics including 7 sensitivity runs: first call | 2.4 s |
| Metrics catalogue: cached | 2.5 ms |
| Ingest the 15-page PDF table (parse, validate, enrich, promote 600 rows) | 2.5 s |
| Hazard interpolation, one building | 0.19 ms |
| `GET` properties (2,000-row page) / summary / clusters / property detail | 171 ms / 4.5 ms / 47 ms / 10 ms |

AI calls are network-bound and depend on the provider:

| Call | Observed |
|---|---|
| Chat via `gemini-3.8-flash`, about 16k-character evidence | 13.5 s (one call); 46 s with a 28k-character prompt |
| Chat when 3.8-flash is overloaded (HTTP 503), falling back through 3.7-flash to 3.5-flash | 57–62 s end to end |
| `gemini-3.5-flash` alone, short prompt | about 2.4 s |
| Claude (any model) | Not measured: the account has no credit |
| Document extraction | Runs in a background thread. Not measured live |

---

## 11. Known limitations

1. **Hazard is a proxy.** Scores are terrain susceptibility, not modelled or observed depths; depth = score × 4 m is an assumption.
2. **Return periods are assumed**, and the tier ordering was inferred from the data (section 3.2).
3. **Vulnerability is uncalibrated** for Kenya, and the RCC curve rests on prototype relative weights.
4. **Five deterministic scenarios** are not a stochastic catalogue. Correlation and secondary uncertainty are not modelled.
5. **Losses are ground-up.** Deductibles, limits and reinsurance are out of scope (FIN-12 to FIN-14).
6. **The TIV definition is unresolved** (10× area × cost), and RCC holds 85% of the value. Both dominate the result.
7. **AI uplift is not active**, so drainage-driven flooding that terrain misses (Kibera, Westlands, Lavington, per the design doc) is not captured.
8. **The portfolio is synthetic.** No result here is a statement about real buildings.
