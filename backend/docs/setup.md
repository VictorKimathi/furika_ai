# Running the Furika backend on a new machine

This guide takes a clean machine to a running backend with data loaded and a model run working. It takes about 20 minutes. Commands are for Linux and macOS; Windows notes are at the end.

## 1. What you need

| Tool | Version | Why |
|---|---|---|
| Git | any | Get the code |
| Python | 3.12 or newer (developed on 3.14) | The backend. 3.11 and older will not work |
| PostgreSQL | 15 or newer (17 recommended) | The database. Docker is the easiest way to get it |
| Docker | optional | Runs PostgreSQL with one command |
| Node.js | 20 or newer, only for the frontend | Not needed for the backend itself |

Check what you have:

```bash
python3 --version     # must print 3.12 or higher
psql --version        # only if you install PostgreSQL yourself
docker --version      # only if you use Docker for PostgreSQL
```

No system libraries are needed: the PostgreSQL driver installs as a binary wheel.

## 2. Get the code

```bash
git clone <repository-url> furika_ai
cd furika_ai/backend
```

All commands below run from `furika_ai/backend`.

## 3. Install Python packages

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Activate the environment (`source .venv/bin/activate`) in every new terminal before running `flask` or `python`.

## 4. Start PostgreSQL

Pick one option.

### Option A: Docker (recommended)

```bash
docker compose up -d db
```

This starts PostgreSQL 17 on port 5432 with database `furika`, user `furika`, password `furika`, and keeps the data in a Docker volume. Check it is healthy:

```bash
docker compose ps    # STATUS should say "healthy"
```

### Option B: PostgreSQL installed on the machine

Create a user and an empty database for Furika:

```bash
sudo -u postgres psql -c "CREATE USER furika WITH PASSWORD 'choose-a-password';"
sudo -u postgres psql -c "CREATE DATABASE furika OWNER furika;"
```

On macOS with Homebrew, drop `sudo -u postgres` and run `psql postgres -c "..."`.

Use a database of its own. Do not point Furika at another project's database: the tables will not exist there, and you will see `relation "uploads" does not exist`.

## 5. Configure `.env`

```bash
cp .env.example .env
```

Then edit `.env`. Only `DATABASE_URL` and `SECRET_KEY` are needed to start; the rest switch on features.

| Variable | Needed? | What it does |
|---|---|---|
| `DATABASE_URL` | Required | `postgresql+psycopg://USER:PASSWORD@HOST:5432/furika`. With Docker: `postgresql+psycopg://furika:furika@localhost:5432/furika` |
| `SECRET_KEY` | Required | Any long random string, e.g. the output of `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `ANTHROPIC_API_KEY` | Recommended | Claude: reads PDFs, Word files and text uploads, and is the first chat model. `CLAUDE_CODE` is accepted as an alternative name |
| `CLAUDE_MODEL` | Optional | Defaults to `claude-opus-5-5` |
| `GEMINI_API_KEY` | Recommended | Second chat model, used when Claude fails or has no credit |
| `GEMINI_MODEL` | Optional | Defaults to `gemini-3.8-flash`; falls back to older Flash models when it is overloaded |
| `OPENAI_API_KEY` | Optional | Third chat model. `OPENAI_MODEL` defaults to `gpt-5.6-luna` |
| `GOOGLE_MAPS_API_KEY` | Optional | Server-side Geocoding API key: places uploaded buildings that have an address but no coordinates. Restrict it by IP and to the Geocoding API |
| `CORS_ORIGINS` | If the frontend is not on `http://localhost:5173` | Comma-separated list of frontend origins allowed to call the API |
| `STORAGE_ROOT` | Optional | Folder for original uploaded files. Defaults to `backend/storage` |
| `REPORT_OWNER_EMAIL` | For report email | Owner who receives each approved model report. Set this explicitly in the local `.env`; no recipient is assumed for new installations |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | For report email | Outgoing mail server and sender credentials; without these, approval still works but delivery is marked not configured |
| `SMTP_STARTTLS`, `SMTP_USE_SSL` | Optional | Transport security. Defaults to STARTTLS on port 587; use SSL for port 465 |
| `REPORT_EMAIL_ENABLED` | Optional | Set `false` to disable automatic report email |
| `LOG_LEVEL` | Optional | `INFO` (default) or `DEBUG` |
| `HOST`, `PORT`, `FLASK_DEBUG` | Optional | Used by `python run.py`. Defaults: `0.0.0.0`, `5000`, `false` |

Without any AI key the backend still works: spreadsheets upload and model runs calculate, chat replies with a data-only summary, and PDF and Word uploads are stored but not read.

Keep `.env` out of Git (it is already ignored) and never copy these keys into a `VITE_` variable in the frontend: those are visible to anyone using the site.

Reports are emailed only after a human approves the model run. The email includes the full report as HTML, with the EP curve and per-stage results, plus a JSON attachment. If delivery fails, the run remains approved; the Report tab shows the status and an **Email owner** retry button. A previously approved report can also be sent from that tab.

## 6. Create the tables

```bash
flask --app run.py init-db
```

It prints `Furika database tables created.` This is also the database check: if `DATABASE_URL` is wrong you get the error here (see Troubleshooting).

The project has no migrations yet. `init-db` creates missing tables but does not change existing ones. If a code update adds columns, recreate the database (Docker: `docker compose down -v && docker compose up -d db`, then `init-db` again) or add the columns by hand.

## 7. Load data

The portfolio is `SYN-PORT-142`. The 600-building reference exposure file is not stored in Git, so choose one:

**A. You have the reference CSV.** Copy `exposure_nairobi_with_hazard.csv` (and `hotspots.csv` if you have it) into `backend/data/reference/`, then:

```bash
flask --app run.py seed-reference
```

This uploads the exposure into `SYN-PORT-142`, builds the hazard grid used to estimate scores for new buildings, and loads the hotspots.

**B. You have the exposure as a PDF or spreadsheet.** Start the backend and frontend (steps 8 and 10), open **Data store**, confirm the data is synthetic or redacted, and upload the file.

**C. Just checking the install.** Load the small sample shipped with the tests (6 buildings, 2 hotspots; the output also reports one sample hotspot skipped for being outside Nairobi, which is expected):

```bash
flask --app run.py seed-reference --file tests/fixtures/reference_sample.csv --hotspots tests/fixtures/hotspots_sample.csv
```

### Moving data from an existing machine

To keep everything (uploads, review decisions, model runs), copy the database and the stored files.

On the old machine:

```bash
pg_dump --format=custom --no-owner --dbname "postgresql://USER:PASSWORD@localhost:5432/furika" --file furika.dump
tar czf furika-storage.tgz storage    # the original uploaded files
```

On the new machine, after step 4 (skip steps 6 and 7):

```bash
pg_restore --no-owner --dbname "postgresql://USER:PASSWORD@localhost:5432/furika" furika.dump
tar xzf furika-storage.tgz            # inside backend/
```

Both parts are needed: the database refers to files in `storage/`, so restoring only the database breaks downloads and reprocessing.

## 8. Run the backend

For development:

```bash
flask --app run.py run --port 5000 --debug
```

`--debug` reloads the server when code changes. Without it, restart the server after every backend change or it keeps running the old code. `python run.py` also works and reads `HOST`, `PORT` and `FLASK_DEBUG` from `.env`.

For production:

```bash
gunicorn --bind 0.0.0.0:5000 --workers 2 --timeout 120 wsgi:app
```

Use `--timeout 120` because model runs and document reading can take longer than gunicorn's default 30 seconds. Put the server behind HTTPS and set a real `SECRET_KEY`.

## 9. Check it works

In a second terminal:

```bash
curl http://localhost:5000/api/v1/health                        # {"status": "ok", ...}
curl http://localhost:5000/api/v1/portfolios/SYN-PORT-142/summary   # portfolio totals after step 7
curl -X POST http://localhost:5000/api/v1/model-runs \
     -H "Content-Type: application/json" -d '{"portfolioId": "SYN-PORT-142"}'
```

The last call runs the flood model. It should return status 202 with `"status": "review"` and a `trace` listing nine steps, all `ok`. The Flask terminal shows the same steps with timings.

API documentation is at http://localhost:5000/api/v1/docs.

Run the test suite (it uses an in-memory SQLite database, so it does not touch your data or need AI keys):

```bash
pytest
```

## 10. Connect the frontend

In `furika_ai/furika_vote`:

```bash
cp .env.example .env     # set VITE_API_BASE_URL=http://localhost:5000/api/v1 and VITE_GOOGLE_MAPS_API_KEY
npm install
npm run dev              # http://localhost:5173
```

If the frontend runs on another address, add it to `CORS_ORIGINS` in the backend `.env` and restart Flask.

## Logs

Each API call and each model-run step is logged in the Flask terminal:

```
INFO  app.model_runs: model_run.create step=write_results ok trace=f401c415a758 ms=43.2 rows=1200
INFO  app.http: POST /api/v1/model-runs -> 202 131.5ms request=f401c415a758
```

When something fails, the failing step is logged as `FAILED` with the error and a traceback. The same trace ID appears in the browser console (`[Furika]` lines), in the Workflow panel, and in `window.furikaLog`, so you can match a browser error to its server log line.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `password authentication failed for user "furika"` | `DATABASE_URL` user or password is wrong, or `.env` was not loaded | Check `DATABASE_URL`; run commands from `backend/` so `.env` is found |
| `connection refused` on port 5432 | PostgreSQL is not running | `docker compose up -d db`, or start the PostgreSQL service |
| `relation "uploads" does not exist` | Tables not created, or `DATABASE_URL` points at another database | Check the database name, then run `flask --app run.py init-db` |
| `column ... does not exist` after updating the code | `init-db` does not alter existing tables | Recreate the database (step 6) or add the column by hand |
| Model run fails with `ForeignKeyViolation` on `hazard_results` | The server is running code from before the fix | Restart Flask |
| Model run returns 422 "No confirmed properties…" | No data loaded, or rows still awaiting review | Load data (step 7) and confirm rows in the review queue |
| Browser shows "The backend at … is not reachable" | Flask not running, wrong `VITE_API_BASE_URL`, or a CORS block | Start Flask; check `VITE_API_BASE_URL`; add the frontend origin to `CORS_ORIGINS` |
| Port 5000 already in use (often on macOS, where AirPlay Receiver uses it) | Another program owns the port | Use `--port 5001` and update `VITE_API_BASE_URL`, or turn off AirPlay Receiver |
| Chat says the AI models are unavailable | Missing keys, no Anthropic credit, or Gemini overloaded | Add or top up a key; the reply names the provider that failed |
| PDF upload stays "Stored" and is never read | No `ANTHROPIC_API_KEY` | Add the key, restart, then use **Reprocess** on the file in Data store |
| Uploaded buildings without coordinates need review | No `GOOGLE_MAPS_API_KEY` for geocoding | Add the key, or add coordinates in the review queue |

## Windows

Use the same steps with these changes:

- Activate the environment with `.venv\Scripts\activate` (PowerShell: `.venv\Scripts\Activate.ps1`).
- Use `copy` instead of `cp`.
- Docker Desktop provides `docker compose`. For a local PostgreSQL install, run the `CREATE USER` and `CREATE DATABASE` commands in pgAdmin or `psql -U postgres`.
- `gunicorn` does not run on Windows. For a production-like server use `pip install waitress` and `waitress-serve --port=5000 wsgi:app`.
