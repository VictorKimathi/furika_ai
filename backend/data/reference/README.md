Place the synthetic reference files here (they are committed, not git-ignored):

- `exposure_nairobi_with_hazard.csv`: 600 synthetic locations with five hazard scores. Seeded into SYN-PORT-142, and its scored rows become the hazard grid used to interpolate scores for new buildings.
- `hotspots.csv`: named flood hotspots with columns `name, lat, lon` and optional `severity` (low/medium/high) or `weight`.

Load both with `flask --app run.py seed-reference`.
