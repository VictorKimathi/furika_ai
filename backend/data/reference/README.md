Place the synthetic reference files here (they are committed, not git-ignored):

- `exposure_nairobi_with_hazard.csv`: 600 synthetic locations with five hazard scores. Seeded into SYN-PORT-142, and its scored rows become the fixed Nairobi susceptibility reference used to interpolate scores for new buildings. Accumulation keeps these reference rows separate from underwriter-uploaded insured assets and excludes them from its exposure totals.
- `hotspots.csv`: named point locations with columns `name, lat, lon` and optional `severity` (low/medium/high) or `weight`. Points are not flood-boundary polygons.

Load both with `flask --app run.py seed-reference`.
