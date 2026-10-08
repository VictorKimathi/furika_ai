// The model's tier names run opposite to scenario rarity; keep this order aligned
// with DEFAULT_TIER_RP in backend/app/services/furika_model.py.
export const FLOOD_TIERS = [
  { id: 'extreme', years: 10 },
  { id: 'severe', years: 25 },
  { id: 'moderate', years: 50 },
  { id: 'occasional', years: 100 },
  { id: 'common', years: 250 },
];

export const floodColour = (score) => score >= 0.75 ? '#c7353d'
  : score >= 0.5 ? '#ed7438'
    : score >= 0.25 ? '#e9ad3a' : '#36a7aa';

export function buildFloodOverlay(properties, tier, selectedRegion, clusterType) {
  const cells = new Map();
  let mappedCount = 0;
  let scoredCount = 0;
  let affectedCount = 0;

  for (const property of properties) {
    const lat = Number(property.latitude);
    const lng = Number(property.longitude);
    if (property.latitude == null || property.longitude == null
      || !Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const region = clusterType === 'grid'
      ? `Grid ${(Math.round(lat / 0.05) * 0.05).toFixed(2)}, ${(Math.round(lng / 0.05) * 0.05).toFixed(2)}`
      : property.region || 'Unassigned';
    if (selectedRegion && region !== selectedRegion) continue;
    mappedCount += 1;
    const rawScore = property.hazardScores?.[tier];
    if (rawScore == null || rawScore === '') continue;
    const score = Number(rawScore);
    if (!Number.isFinite(score) || score < 0 || score > 1) continue;
    scoredCount += 1;
    if (score <= 0) continue;
    affectedCount += 1;

    // Group nearby asset locations for a readable overlay. These circles are
    // visual summaries of point scores, not inferred inundation boundaries.
    const key = `${Math.floor(lat / 0.008)}:${Math.floor(lng / 0.008)}`;
    const cell = cells.get(key) || { lat: 0, lng: 0, score: 0, count: 0 };
    cell.lat += lat;
    cell.lng += lng;
    cell.score = Math.max(cell.score, score);
    cell.count += 1;
    cells.set(key, cell);
  }

  return {
    cells: [...cells.values()].map((cell) => ({
      lat: cell.lat / cell.count,
      lng: cell.lng / cell.count,
      score: cell.score,
      count: cell.count,
    })),
    mappedCount,
    scoredCount,
    affectedCount,
  };
}
