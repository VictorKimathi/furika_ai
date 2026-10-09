# Furika AI Flask backend

Backend for the Furika AI catastrophe-modelling frontend. Portfolio, property, upload, chat and model-run routes read PostgreSQL. Model runs calculate score-to-depth, vulnerability, property-loss, EP and AAL from confirmed uploaded properties and publish results after review. Chat retrieves selected uploaded rows and document text, then tries Claude, Gemini, and OpenAI GPT-5.6 Luna in that order. Some other routes still expose prototype behavior.

Pasted placement memoranda and selected uploaded placement documents receive separate offer-specific checks for data extraction, hazard intensity, vulnerability, financial loss and underwriting flags. `/chat` returns these as `offerChecks` with per-stage results and blocked reasons. They are not portfolio model runs or coverage approvals; an underwriter must review the offer. Portfolio accumulation is not calculated for a single offer unless the underwriter explicitly asks to compare it with nearby insured properties.

For a follow-up about one offer, send the new question in `message` and carry **only that offer** in `context.offerText` (pasted offer) or `context.offerUploadId` (uploaded document). Do not attach the insured-properties CSV. If a supplied offer context is empty or invalid, the API returns an error instead of silently answering from portfolio data. Site hazard scoring may still use the separate scored geographic reference grid; it does not turn other insured properties into the offer's exposure.

## Quick start

Setting up on a new machine? Follow [docs/setup.md](docs/setup.md): prerequisites, PostgreSQL, every `.env` variable, loading data, moving data from another machine, and troubleshooting.

The virtual environment has already been created in `backend/.venv`.

```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
docker compose up -d db
flask --app run.py init-db
flask --app run.py seed-reference   # loads data/reference/exposure_nairobi_with_hazard.csv into SYN-PORT-142,
                                    # builds the hazard grid, and loads data/reference/hotspots.csv if present
python run.py
```

Set `OPENAI_API_KEY` and `RISK_ATLAS_OPENAI_MODEL=gpt-6-luna` in `backend/.env` to use GPT-6 Luna as the OpenAI chat fallback. `RISK_ATLAS_OPENAI_MODEL` takes precedence over the legacy `OPENAI_MODEL`; without either setting, the fallback remains `gpt-5.6-luna`. Gemini defaults to `gemini-3.8-flash` and can be changed with `GEMINI_MODEL`.

Open:

- API: `http://localhost:5000/api/v1`
- Swagger UI: `http://localhost:5000/api/v1/docs`
- OpenAPI JSON: `http://localhost:5000/api/v1/swagger.json`
- Health: `http://localhost:5000/api/v1/health`

For production:

```bash
gunicorn --bind 0.0.0.0:5000 --workers 2 wsgi:app
```

## PostgreSQL

`DATABASE_URL` uses SQLAlchemy's psycopg driver:

```env
DATABASE_URL=postgresql+psycopg://furika:furika@localhost:5432/furika
```

The included Compose file starts PostgreSQL 17. Database models cover:

- users and authentication roles;
- portfolios and properties;
- hazard and loss results;
- accumulation clusters;
- model runs and stage outputs;
- human-review approvals;
- chats and messages.

For schema migrations after the initial prototype:

```bash
flask --app run.py db init
flask --app run.py db migrate -m "initial schema"
flask --app run.py db upgrade
```

## API routes

All versioned endpoints use `/api/v1`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/health/readiness` | Dependency readiness |
| POST | `/auth/login` | Dummy login token |
| GET | `/auth/me` | Current underwriter |
| POST | `/auth/logout` | End session |
| GET | `/portfolios/{id}/summary` | TIV, AAL, loss, and risk summary |
| GET | `/portfolios/{id}/properties` | Search/filter/map data |
| POST | `/portfolios/{id}/properties` | Add synthetic exposure |
| GET | `/portfolios/{id}/clusters?type=neighbourhood&uploadId=` | Accumulation by region for all properties or one uploaded dataset; includes counts, TIV, geocoded/review counts and map centroids |
| GET | `/portfolios/{id}/export` | Export contract |
| GET | `/properties/{id}` | Complete property detail |
| GET | `/properties/{id}/hazard` | Hazard-only detail |
| GET | `/properties/{id}/loss` | Loss and EP curve |
| GET | `/properties/{id}/provenance` | Field-by-field source of uploaded values |
| GET/POST | `/portfolios/{id}/uploads` | List uploads / upload any file (multipart: `file`, `attestation`=`synthetic`\|`redacted`); CSV/XLSX and PDF/DOCX/TXT/MD are parsed |
| GET | `/portfolios/{id}/documents/search?q=` | Search uploaded document text (file, page, snippet) |
| GET/DELETE | `/uploads/{id}` | Upload manifest, status, mapping, issue counts / delete the upload and revert its properties |
| GET | `/uploads/{id}/facts` | Facts, terms, claims and opinions extracted from a document |
| GET | `/uploads/{id}/rows?status=` | Staged rows with issues and provenance |
| GET | `/uploads/{id}/issues` | All validation issues |
| GET | `/uploads/{id}/original` | Download the untouched original |
| GET | `/portfolios/{id}/review-queue` | Rows needing review and unconfirmed properties |
| POST | `/upload-rows/{id}/decision` | `confirm` / `reject` / `edit` a staged row |
| GET | `/locations/geocode?q=...` | Google geocoding (needs `GOOGLE_MAPS_API_KEY`) with precision |
| GET | `/locations/flood-reference` | Fixed Nairobi susceptibility points and named hotspots for the Accumulation base map |
| GET/POST | `/model-runs` | Resume latest portfolio run / calculate a new run for review |
| GET | `/model-runs/{id}` | Workflow status and stages |
| GET | `/model-runs/{id}/events` | Server-Sent Event stream |
| GET | `/model-runs/{id}/stages/{stage}/output` | Stage output and provenance |
| POST | `/model-runs/{id}/decision` | Approve or return human gate |
| POST | `/model-runs/{id}/cancel` | Returns 409 for synchronous review runs |
| GET | `/model-runs/{id}/report` | Approved JSON summary |
| POST | `/modelling/validate-exposure` | Validate canonical exposure rows and TIV reconciliation |
| POST | `/modelling/damage-ratio` | Evaluate normalized vulnerability curves |
| POST | `/modelling/calculate` | Execute hazard → loss → EP → AAL calculations |
| POST | `/modelling/ep-curve` | Build/interpolate the occurrence EP curve and AAL range |
| POST | `/modelling/hotspot-uplift` | Calculate distance-decayed hotspot uplift |
| POST | `/modelling/sensitivity` | Run D-max sensitivity scenarios |
| POST | `/chat` | Answer from one offer, selected upload IDs, or a portfolio property ID; Claude, Gemini, then OpenAI fallback |
| GET/POST | `/chats` | Recent chats/create chat |
| GET/POST | `/chats/{id}/messages` | Read/append messages |
| DELETE | `/chats/{id}` | Delete chat |

## Frontend connection

Set the React app's environment value:

```env
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

The Google Maps browser key remains in the frontend and should be restricted by HTTP referrer. Keep `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` (or your existing `CLAUDE_CODE` Anthropic API key), PostgreSQL credentials, and session secrets in the backend only. Chat tries Claude, then Gemini, then OpenAI; the OpenAI request sets `store: false`.

## Remaining prototype routes

Authentication, chat history and portfolio export still have placeholder implementations. Model runs are synchronous and require a human approve/return decision before their calculated results are published.

## Uploads

Parsing uses Claude (`ANTHROPIC_API_KEY` in `.env`): spreadsheet column mapping and PDF/DOCX/text extraction, with every extracted value checked against a verbatim quote in the document. Documents are processed in a background thread; poll `/uploads/{id}`.

Originals are written once to `STORAGE_ROOT` (default `backend/storage/`, git-ignored), hashed with SHA-256, and made read-only. CSV and Excel rows are mapped to the canonical schema (exact headers first, then Gemini when `GEMINI_API_KEY` is set), validated per row, and promoted to `properties` when accepted. See `docs/ingestion-plan.md` for issue codes and the confirmation rule.

## Deterministic model modules

- `app/services/furika_model.py` contains exposure validation, hazard-score to depth conversion, normalized sigmoid vulnerability, property/portfolio loss, hotspot uplift, accumulation, EP interpolation, AAL, and sensitivity calculations.
- `app/services/furika_resolver.py` resolves exact files before asking Gemini to map columns or extract parameters. AI-extracted parameters are accepted only when the returned quote exists verbatim in the source document.
- Root-level `furika_model.py` and `furika_resolver.py` are compatibility imports for the supplied standalone test harness.

Run the complete verification suite with:

```bash
cd backend
source .venv/bin/activate
pytest
python test_furika.py
```
