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

const distanceKm = (a, b) => {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);
  const arc = Math.sin(latitude / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitude / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(arc)));
};

export function assessAgainstNairobiReference(property, points, hotspots, tier) {
  const latitude = Number(property.latitude);
  const longitude = Number(property.longitude);
  if (property.latitude == null || property.longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const location = { latitude, longitude };
  const nearest = [];
  for (const point of points) {
    const score = Number(point.hazardScores?.[tier]);
    if (!Number.isFinite(score) || score < 0 || score > 1) continue;
    const km = distanceKm(location, point);
    if (nearest.length === 4 && km >= nearest[3].km) continue;
    const position = nearest.findIndex((item) => km < item.km);
    nearest.splice(position < 0 ? nearest.length : position, 0, { km, score });
    if (nearest.length > 4) nearest.pop();
  }
  let referenceScore = null;
  if (nearest.length) {
    if (nearest[0].km < 0.000001) referenceScore = nearest[0].score;
    else {
      const weighted = nearest.map((item) => ({ weight: 1 / item.km ** 2, score: item.score }));
      referenceScore = weighted.reduce((total, item) => total + item.weight * item.score, 0)
        / weighted.reduce((total, item) => total + item.weight, 0);
    }
  }
  let closestHotspot = null;
  for (const hotspot of hotspots) {
    const km = distanceKm(location, hotspot);
    if (!closestHotspot || km < closestHotspot.km) closestHotspot = { name: hotspot.name, km };
  }
  const rawSourceScore = property.hazardScores?.[tier];
  const sourceScore = rawSourceScore == null ? null : Number(rawSourceScore);
  return {
    referenceScore,
    sourceScore: Number.isFinite(sourceScore) ? sourceScore : null,
    nearestReferenceKm: nearest[0]?.km ?? null,
    nearestHotspot: closestHotspot,
    approximate: nearest.length > 0 && nearest[0].km > 0.5,
  };
}

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
