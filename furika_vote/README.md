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
OPENAI_API_KEY=your_server_side_openai_key
OPENAI_MODEL=gpt-5-mini
```

`VITE_GOOGLE_MAPS_API_KEY` is intentionally available to the browser and must be restricted by HTTP referrer in Google Cloud. `OPENAI_API_KEY` remains server-side and must never use the `VITE_` prefix.

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

The app includes grounded local fallback answers when the OpenAI key is missing or temporarily unavailable. AI-extracted exposure records always require user confirmation before changing the session portfolio.
