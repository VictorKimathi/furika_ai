import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStory, kes } from './runStory.js';

const m = (id, value, extra = {}) => ({ id, value, display: String(value), ...extra });
const metrics = { stages: {
  exposure: { metrics: [m('EXP-01', 2.5e9), m('EXP-02', 500), m('EXP-09', 1, { status: 'warn' })] },
  hazard: { metrics: [m('HAZ-02', 0.432), m('HAZ-06', 0.493)] },
  financial: { metrics: [m('FIN-01', 120e6), m('FIN-02', 0.048), m('FIN-05', 9e6, { chart: { series: [{ values: [6, 9, 15] }] } }), m('FIN-15', 2.5, { status: 'warn' }), m('FIN-17', 1, { status: 'pass' })] },
  portfolio: { metrics: [m('PORT-02', 0, { status: 'pass' })] },
  trust: { metrics: [m('TRU-05', 6, { display: '6/7 checks passed', status: 'warn' }), m('TRU-02', 7, { status: 'warn', table: { rows: [['D_max', '4 m']] } })] },
} };

test('kes matches the backend formatting', () => {
  assert.equal(kes(2.5e9), 'KES 2.5 bn');
  assert.equal(kes(104238000), 'KES 104 m');
  assert.equal(kes(null), 'n/a');
});

test('the bottom line leads with value, yearly cost and 1-in-100 loss', () => {
  const story = buildStory(metrics);
  assert.deepEqual(story.headline.map((item) => item.value), ['KES 2.5 bn', 'KES 9 m', 'KES 120 m']);
  assert.equal(story.headline[1].detail, 'range KES 6 m – KES 15 m');
  assert.match(story.chapters[2].answer, /4\.8% of insured value/);
});

test('only warnings and failures become things to check; always-open assumptions do not', () => {
  const ids = buildStory(metrics).flags.map((flag) => flag.id);
  assert.deepEqual(ids, ['FIN-15', 'EXP-09', 'TRU-05']);
  assert.match(buildStory(metrics).flags[2].text, /Not every automatic check/);
});

test('story tells five chapters in order and survives missing metrics', () => {
  assert.deepEqual(buildStory(metrics).chapters.map((c) => c.key), ['covering', 'flood', 'cost', 'concentration', 'trust']);
  assert.match(buildStory(metrics).chapters[3].answer, /No area/);
  assert.equal(buildStory({ stages: {} }), null);
  assert.equal(buildStory({ stages: { x: { metrics: [m('EXP-02', 3)] } } }).flags.length, 0);
});

test('each chapter gets a plain picture that reads without axes', () => {
  const withCharts = structuredClone(metrics);
  withCharts.stages.exposure.metrics.push(m('EXP-04', null, { chart: { categories: ['informal_iron_sheet', 'concrete_rcc'], series: [{ name: '% of TIV', values: [20, 80] }] } }));
  withCharts.stages.financial.metrics.find((x) => x.id === 'FIN-01').chart = { categories: ['1 in 10', '1 in 100'], series: [{ values: [30, 120] }] };
  const [covering, flood, cost] = buildStory(withCharts).chapters;
  assert.deepEqual(covering.simple.slices.map((s) => [s.label, s.share]), [['Iron sheet', '20%'], ['Concrete', '80%']]);
  assert.equal(flood.simple.filled, 43.2);
  assert.deepEqual(cost.simple.rows.map((r) => [r.label, r.display, r.highlight]), [['About once every 10 years', 'KES 30 m', false], ['About once every 100 years', 'KES 120 m', true]]);
});

test('flood panel covers every flood size and turns scores into depth', () => {
  const withHazard = structuredClone(metrics);
  withHazard.stages.hazard.metrics = [
    m('HAZ-02', 0.4, { chart: { categories: ['extreme (1 in 10)', 'occasional (1 in 100)'], series: [{ name: '% of properties', values: [5, 29] }, { name: '% of TIV', values: [3, 31] }] } }),
    m('HAZ-01', null, { chart: { rows: ['extreme (1 in 10)', 'occasional (1 in 100)'], cols: ['0', '0-0.2', '0.2-0.4'], values: [[90, 8, 2], [70, 20, 10]] } }),
    m('HAZ-10', 4),
  ];
  const visual = buildStory(withHazard).stages.quality.visual;
  assert.equal(visual.type, 'floodTiers');
  assert.deepEqual(visual.tiers.map((t) => [t.label, t.buildingsPct]), [['About once every 10 years', 5], ['About once every 100 years', 29]]);
  assert.equal(visual.defaultIndex, 1);
  assert.deepEqual(visual.tiers[1].bands.map((b) => [b.depth, b.count]), [['Dry', 70], ['Up to 0.8 m', 20], ['0.8–1.6 m', 10]]);
});

test('financial engine stage carries the worked example, waterfall and assumptions', () => {
  const withFinance = structuredClone(metrics);
  const tiers = [{ rp: 10, groundUpKes: 300e6, ownerKeepsKes: 15e6, aboveLimitKes: 0, grossKes: 285e6, quotaShareKes: 71e6, catXlKes: 0, netKes: 214e6 },
    { rp: 100, groundUpKes: 1.34e9, ownerKeepsKes: 164e6, aboveLimitKes: 0, grossKes: 1.17e9, quotaShareKes: 293e6, catXlKes: 560e6, netKes: 318e6 }];
  withFinance.stages.financial.metrics.push(m('FIN-18', 318e6, { data: { tiers } }), m('FIN-21', null, { data: { tierRp: { extreme: 10, occasional: 100 }, terms: { quota_share_ceded: 0.25 } } }));
  const stage = buildStory(withFinance).stages.loss;
  assert.equal(stage.visual.type, 'financial');
  assert.equal(stage.visual.defaultIndex, 1);
  assert.equal(stage.short, '1 in 100: KES 1.34 bn ground-up → KES 318 m net');
  assert.match(stage.result, /KES 1\.17 bn \(gross\).*KES 318 m \(net\)/);
});
