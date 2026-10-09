// Visual emphasis only: these tiers do not represent measured rainfall or a forecast.
export const RAIN_BY_TIER = Object.freeze({
  common: { intensity: 0.26, label: 'Light' },
  occasional: { intensity: 0.38, label: 'Light' },
  moderate: { intensity: 0.58, label: 'Steady' },
  severe: { intensity: 0.85, label: 'Heavy' },
  extreme: { intensity: 1, label: 'Very heavy' },
});

export function rainTargets({ width, height, visibleWetCount, intensity }) {
  const level = Math.max(0, Math.min(1, Number(intensity) || 0));
  const area = Math.max(0, Number(width) || 0) * Math.max(0, Number(height) || 0);
  const wetCount = Math.max(0, Number(visibleWetCount) || 0);
  return {
    local: Math.min(650, Math.round(wetCount * (5 + level * 13) * level)),
    background: Math.min(420, Math.round(area / 3200 * level * (0.35 + level * 1.15))),
  };
}
