# Accumulation map: fixed Nairobi reference versus uploaded insured assets

## Input and meaning

- The supplied `exposure_nairobi_with_hazard(in)(1).csv` has 600 **synthetic scored locations** and five 0–1 susceptibility tiers. It is the permanent Nairobi reference layer, not an underwriter's portfolio.
- The supplied `nairobi_hotspots_geocoded(in).csv` has 24 named point locations. It has no severity or flood-boundary polygons.
- Neither file establishes a measured inundation area or a calibrated flood probability. Map circles are visual summaries of scored points, not flood extents.

## Implementation

1. Load the two baseline files once with `seed-reference`. The existing ingestion pipeline validates the scored rows, stores them as `HazardReferencePoint`s and loads named `Hotspot`s.
2. `GET /api/v1/locations/flood-reference` supplies this fixed base layer and its source upload IDs. Accumulation always requests it independently of the selected underwriter dataset.
3. Underwriters use the existing CSV/XLSX upload control. Rows with coordinates are placed on the map; an address can be geocoded if the backend Google key is configured. Missing hazard scores are interpolated from the fixed reference by ingestion. Invalid or uncertain rows remain in the review flow.
4. Accumulation requests portfolio properties and region totals with `excludeReference=true`, so the synthetic baseline never inflates underwriter counts or insured value. Choosing a dataset filters only the insured-asset overlay; it does not change the Nairobi base.
5. For each mapped insured property, the UI compares its own score with an independent four-nearest-point, inverse-distance-weighted reference score and shows the nearest named hotspot. A nearest reference farther than 0.5 km is marked approximate. Region circles show insured counts; their colour summarizes the reference proxy at those insured locations.
6. The five-tier control changes reference colours and property comparisons. All visible language calls these *susceptibility proxies*, not flood depths, flood boundaries or measured probabilities.

## Load the supplied files

From `backend/`, after setting up PostgreSQL and running `flask --app run.py init-db`:

```bash
flask --app run.py seed-reference \
  --file "/home/victorcodes/Downloads/exposure_nairobi_with_hazard(in)(1).csv" \
  --hotspots "/home/victorcodes/Downloads/nairobi_hotspots_geocoded(in).csv"
```

Alternatively, put them at `backend/data/reference/exposure_nairobi_with_hazard.csv` and `backend/data/reference/hotspots.csv`, then run `flask --app run.py seed-reference`. The map fetches the resulting database rows when Accumulation opens. It does not read a developer's Downloads directory at runtime.

## Acceptance checks

- Before any underwriter upload, the map shows scored Nairobi reference points and named hotspots, while insured-asset counts remain zero.
- After an upload, green property pins and regional counts appear over the unchanged base. Selecting another upload changes only those pins and counts.
- Uploaded properties without supplied scores show an interpolated score when the reference has coverage; a distant/missing lookup is not presented as certain.
- A baseline reference upload is excluded from Accumulation totals and dataset choices. Other portfolio and chatbot workflows are unchanged.
