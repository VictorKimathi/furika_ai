import test from 'node:test';
import assert from 'node:assert/strict';
import { RAIN_BY_TIER, rainTargets } from './mapRain.js';

test('severe and extreme tiers produce visibly heavier rain', () => {
  const levels = ['common', 'occasional', 'moderate', 'severe', 'extreme'].map((tier) => RAIN_BY_TIER[tier].intensity);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
  const moderate = rainTargets({ width: 700, height: 500, visibleWetCount: 10, intensity: RAIN_BY_TIER.moderate.intensity });
  const severe = rainTargets({ width: 700, height: 500, visibleWetCount: 10, intensity: RAIN_BY_TIER.severe.intensity });
  assert.ok(severe.local > moderate.local);
  assert.ok(severe.background > moderate.background);
});

test('rain targets remain bounded and support a map without visible assets', () => {
  assert.deepEqual(rainTargets({ width: 0, height: 0, visibleWetCount: 0, intensity: 1 }), { local: 0, background: 0 });
  assert.ok(rainTargets({ width: 700, height: 500, visibleWetCount: 0, intensity: 0.85 }).background > 0);
  assert.deepEqual(rainTargets({ width: 10000, height: 10000, visibleWetCount: 10000, intensity: 1 }), { local: 650, background: 420 });
});
