# Furika AI Flask backend

Backend for the Furika AI catastrophe-modelling frontend. Portfolio, property and upload routes read PostgreSQL; model-run, chat and export routes still return deterministic demo data. The modelling routes execute real, auditable score-to-depth, vulnerability, property-loss, EP, AAL, accumulation, and sensitivity calculations. Replace functions in `app/services/dummy.py` with PostgreSQL repositories, workers, and Gemini calls later; the frontend-facing routes do not need to change.

## Quick start

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

The default text model is `gemini-3.8-flash`. You can override it with `GEMINI_MODEL` in `.env`.

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
| GET | `/portfolios/{id}/clusters` | Accumulation clusters |
| GET | `/portfolios/{id}/export` | Export contract |
| GET | `/properties/{id}` | Complete property detail |
| GET | `/properties/{id}/hazard` | Hazard-only detail |
| GET | `/properties/{id}/loss` | Loss and EP curve |
| GET | `/properties/{id}/provenance` | Field-by-field source of uploaded values |
| GET/POST | `/portfolios/{id}/uploads` | List uploads / upload a CSV, XLSX, PDF, TXT, or MD file (multipart: `file`, `attestation`=`synthetic`\|`redacted`) |
| GET | `/uploads/{id}` | Upload manifest, status, column mapping, issue counts |
| GET | `/uploads/{id}/rows?status=` | Staged rows with issues and provenance |
| GET | `/uploads/{id}/issues` | All validation issues |
| GET | `/uploads/{id}/original` | Download the untouched original |
| GET | `/portfolios/{id}/review-queue` | Rows needing review and unconfirmed properties |
| POST | `/upload-rows/{id}/decision` | `confirm` / `reject` / `edit` a staged row |
| GET | `/locations/geocode?q=...` | Google geocoding (needs `GOOGLE_MAPS_API_KEY`) with precision |
| POST | `/model-runs` | Start workflow |
| GET | `/model-runs/{id}` | Workflow status and stages |
| GET | `/model-runs/{id}/events` | Server-Sent Event stream |
| GET | `/model-runs/{id}/stages/{stage}/output` | Stage output and provenance |
| POST | `/model-runs/{id}/decision` | Approve or return human gate |
| POST | `/model-runs/{id}/cancel` | Cancel workflow |
| GET | `/model-runs/{id}/report` | Underwriter report/export |
| POST | `/modelling/validate-exposure` | Validate canonical exposure rows and TIV reconciliation |
| POST | `/modelling/damage-ratio` | Evaluate normalized vulnerability curves |
| POST | `/modelling/calculate` | Execute hazard → loss → EP → AAL calculations |
| POST | `/modelling/ep-curve` | Build/interpolate the occurrence EP curve and AAL range |
| POST | `/modelling/hotspot-uplift` | Calculate distance-decayed hotspot uplift |
| POST | `/modelling/sensitivity` | Run D-max sensitivity scenarios |
| POST | `/chat` | Dummy AI analysis/exposure parsing |
| GET/POST | `/chats` | Recent chats/create chat |
| GET/POST | `/chats/{id}/messages` | Read/append messages |
| DELETE | `/chats/{id}` | Delete chat |

## Frontend connection

Set the React app's environment value:

```env
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

The Google Maps browser key remains in the frontend and should be restricted by HTTP referrer. Keep `GEMINI_API_KEY`, PostgreSQL credentials, session secrets, and future model credentials in the backend only. The current Gemini adapter returns dummy data and does not make external model calls yet.

## Dummy-service boundary

All placeholder behavior lives in `app/services/dummy.py`. A later implementation can introduce:

- `PostgresPortfolioRepository` for SQLAlchemy queries;
- `CatModelService` for hazard, vulnerability, and financial-loss execution;
- a worker queue for asynchronous runs;
- object storage for reports and exports;
- `GeminiService` for grounded analyst responses and exposure parsing;
- Google server-side geocoding if desired.

Keep the response schemas and route paths stable while replacing these functions.

## Uploads

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
