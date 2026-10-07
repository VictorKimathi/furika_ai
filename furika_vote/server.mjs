import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 5173);
const root = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '256kb' }));

const modelContext = `
You are Furika AI, a careful catastrophe-modelling analyst for the Nairobi Urban Flood Challenge, Team A.

Authoritative prototype context:
- Pipeline: Hazard → Vulnerability → Exposure → Financial loss.
- Start file: exposure_nairobi_with_hazard.csv, described by the brief as 600 synthetic building locations with five hazard scores attached.
- Total demonstration portfolio exposure: KES 4.82B across 600 synthetic assets.
- Scenario loss results: Common KES 68.4M (1.4%), Occasional KES 184.2M (3.8%), Moderate KES 412.0M (8.5%), Severe KES 895.5M (18.6%), Extreme KES 1.642B (34.1%).
- Scores from 0–1 are topographic flood-susceptibility proxies, not measured flood depths.
- Proxy signals: basin terrain elevation 45%, local terrain depressions 20%, slope/flatness 15%, distance to OSM rivers/streams 20%.
- The proxy flags 12 of 24 geocoded government-named hotspots. It can miss drainage-driven flooding, including Kibera, Westlands and Lavington.
- Vulnerability parameters are adapted assumptions informed by JRC/Huizinga global depth-damage references; they are not calibrated to Kenyan claims.
- Property loss calculation: mean damage ratio × insured value. Aggregate property losses by scenario.
- The five supplied tiers have no official return periods. Any return-period mapping must be explicitly labelled assumed, and losses must increase with rarity.
- Synthetic data must never be presented as observed assets or claims.

Rules:
Answer in plain language and stay concise. Never invent figures, coordinates, source documents, or model outputs. Clearly label proxy, synthetic, assumed, and AI-derived information. If requested data is unavailable, say so. Mention the exact source or calculation supporting numerical claims. Do not give advice outside the supplied prototype context.
`;

app.post('/api/chat', async (req, res) => {
  const { message, mode = 'analysis' } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'A message is required.' });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY is not configured.' });

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    if (mode === 'exposure') {
      const response = await client.responses.create({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        instructions: `${modelContext}\nExtract a proposed synthetic exposure from the user's text. Return only compact JSON with keys: location, type, value, hazard, mdr, loss. value and loss are KES millions. If a detail is missing, use null; never invent coordinates. hazard and mdr must be null unless the authoritative context directly supports an assumption.`,
        input: message,
        text: {
          format: {
            type: 'json_schema',
            name: 'synthetic_exposure',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                location: { type: ['string', 'null'] },
                type: { type: ['string', 'null'] },
                value: { type: ['number', 'null'] },
                hazard: { type: ['number', 'null'] },
                mdr: { type: ['number', 'null'] },
                loss: { type: ['number', 'null'] },
              },
              required: ['location', 'type', 'value', 'hazard', 'mdr', 'loss'],
              additionalProperties: false,
            },
          },
        },
        store: false,
      });
      const asset = JSON.parse(response.output_text);
      return res.json({ asset });
    }

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      instructions: modelContext,
      input: message,
      store: false,
    });
    return res.json({ answer: response.output_text, source: 'Team A brief · supplied model context' });
  } catch (error) {
    console.error('Furika AI request failed:', error?.message || error);
    return res.status(502).json({ error: 'The AI analyst could not complete this request.' });
  }
});

if (isProduction) {
  app.use(express.static(path.join(root, 'dist')));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    return res.sendFile(path.join(root, 'dist', 'index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Furika AI running at http://localhost:${port}`);
});
