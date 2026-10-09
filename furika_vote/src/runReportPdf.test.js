import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRunReportPdf } from './runReportPdf.js';

test('approved report exports an EP chart, financial layers and step results as a PDF', () => {
  const tiers = [10, 25, 50, 100, 250].map((rp) => ({ rp, groundUpKes: rp * 1000, grossKes: rp * 800, netKes: rp * 500,
    ownerKeepsKes: rp * 100, aboveLimitKes: rp * 100, quotaShareKes: rp * 200, catXlKes: rp * 100 }));
  const report = {
    runId: 'RUN-TEST', portfolioId: 'PORT-TEST', summary: { propertyCount: 12, totalTivKes: 1e6 },
    epCurve: tiers.map((row) => ({ returnPeriodYears: row.rp, annualExceedanceProbability: 1 / row.rp, ...row })),
    financial: { aalRangeKes: { low: 100, central: 200, high: 300 }, lossRatio100: 0.1, affectedProperties250: 4,
      aalByLayerKes: { ground_up: 200, gross: 160, net: 100 }, lossWaterfall: tiers },
    stages: Object.fromEntries(['ingestion', 'hazard', 'vulnerability', 'exposure', 'financial', 'ai', 'portfolio', 'trust'].map((key) =>
      [key, { title: key, input: 'input data', output: 'measured result', metrics: [{ id: 'TEST-01', label: 'Example', tag: 'Model', display: '12' }] }])),
    limitations: ['Synthetic exposure'], note: 'Scenario-based estimates.',
  };
  const pdf = buildRunReportPdf(report);
  assert.ok(pdf.getNumberOfPages() >= 2);
  assert.match(pdf.output(), /^%PDF-/);
});
