# Furika AI · Nairobi CAT Modelling

Team A hackathon prototype for Nairobi urban flood susceptibility and catastrophe loss modelling. The interface connects an AI catastrophe analyst to an interactive Google Map.

## Model scope

- Pipeline: Hazard → Vulnerability → Exposure → Financial loss
- Five 0–1 susceptibility-proxy tiers; they are not measured flood depths
- Synthetic Nairobi exposure portfolio
- Scenario loss table and exceedance-probability curve
- Structural-class vulnerability comparison
- Documented hotspots and terrain-proxy limitations
- AI-assisted free-text exposure ingestion with human confirmation
- Switchable Map and Agent Workflow views
- Executable agent pipeline with audit log and blocking human approval gate

## Configure

```bash
cp .env.example .env
```

Add both keys to `.env`:

```env
VITE_GOOGLE_MAPS_API_KEY=your_browser_restricted_google_maps_key
VITE_API_BASE_URL=http://localhost:5000/api/v1
```

`VITE_GOOGLE_MAPS_API_KEY` is available to the browser and must be restricted by HTTP referrer. Chat uses the Flask backend. Set `GEMINI_API_KEY` and optionally `ANTHROPIC_API_KEY` or `CLAUDE_CODE` in `backend/.env`; never use a `VITE_` prefix for either server key.

## Run

```bash
npm install
npm run dev
```

For a production-style run:

```bash
npm run build
npm start
```

The chatbot sends selected upload IDs to Flask. Flask retrieves parsed rows and document text and tries Gemini, then Claude. If neither provider is available, chat reports the error instead of inventing an answer.
