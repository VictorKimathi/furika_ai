import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAgainstNairobiReference, buildFloodOverlay, floodColour, FLOOD_TIERS } from './accumulationRisk.js';

test('scenario order follows increasing return periods, not tier names', () => {
  assert.deepEqual(FLOOD_TIERS.map((tier) => tier.years), [10, 25, 50, 100, 250]);
});

test('overlay groups mapped assets and excludes missing or zero scores', () => {
  const properties = [
    { latitude: -1.292, longitude: 36.82, region: 'A', hazardScores: { severe: 0.3 } },
    { latitude: -1.291, longitude: 36.821, region: 'A', hazardScores: { severe: 0.8 } },
    { latitude: -1.29, longitude: 36.83, region: 'A', hazardScores: { severe: 0 } },
    { latitude: -1.29, longitude: 36.84, region: 'A', hazardScores: null },
    { latitude: -1.29, longitude: 36.85, region: 'B', hazardScores: { severe: 0.6 } },
    { latitude: null, longitude: 36.86, region: 'A', hazardScores: { severe: 0.7 } },
  ];
  const overlay = buildFloodOverlay(properties, 'severe', 'A', 'neighbourhood');
  assert.equal(overlay.mappedCount, 4);
  assert.equal(overlay.scoredCount, 3);
  assert.equal(overlay.affectedCount, 2);
  assert.equal(overlay.cells.length, 1);
  assert.equal(overlay.cells[0].score, 0.8);
  assert.equal(overlay.cells[0].count, 2);
});

test('overlay only uses scores for the selected scenario and valid map coordinates', () => {
  const properties = [
    { latitude: -1.2, longitude: 36.8, hazardScores: { extreme: 0.1, common: 0.9 } },
    { latitude: 999, longitude: 36.8, hazardScores: { extreme: 0.9 } },
  ];
  assert.equal(buildFloodOverlay(properties, 'extreme', null, 'neighbourhood').cells[0].score, 0.1);
  assert.equal(buildFloodOverlay(properties, 'common', null, 'neighbourhood').cells[0].score, 0.9);
  assert.equal(floodColour(0.8), '#c7353d');
});

test('an uploaded asset is compared with the fixed Nairobi reference, not used as the base layer', () => {
  const points = [{ latitude: -1.2584, longitude: 36.8554, hazardScores: { severe: 0.8 } }];
  const hotspots = [{ name: 'Mathare', latitude: -1.2585, longitude: 36.8555 }];
  const asset = { latitude: -1.2584, longitude: 36.8554, hazardScores: { severe: 0.2 } };
  const result = assessAgainstNairobiReference(asset, points, hotspots, 'severe');
  assert.equal(result.referenceScore, 0.8);
  assert.equal(result.sourceScore, 0.2);
  assert.equal(result.nearestReferenceKm, 0);
  assert.equal(result.nearestHotspot.name, 'Mathare');
  assert.equal(buildFloodOverlay(points, 'severe', null, 'neighbourhood').affectedCount, 1);
  assert.equal(assessAgainstNairobiReference({ latitude: null, longitude: 36.8 }, points, hotspots, 'severe'), null);
  const far = assessAgainstNairobiReference({ latitude: -1.30, longitude: 36.90 }, points, hotspots, 'severe');
  assert.equal(far.approximate, true);
  assert.ok(far.nearestReferenceKm > 0.5);
});
