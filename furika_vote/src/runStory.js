// Turns the run metrics catalogue into the underwriter's story: the bottom line, five questions in order, and what to check.

export function kes(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'n/a';
  const abs = Math.abs(value);
  const sig = (number) => Number(number.toPrecision(3)).toString();
  if (abs >= 1e9) return `KES ${sig(value / 1e9)} bn`;
  if (abs >= 1e6) return `KES ${sig(value / 1e6)} m`;
  if (abs >= 1e3) return `KES ${sig(value / 1e3)} k`;
  return `KES ${sig(value)}`;
}

export const pct = (value, digits = 0) => value == null || !Number.isFinite(Number(value)) ? 'n/a' : `${(value * 100).toFixed(digits)}%`;

// Statuses that mean "look at this before approving"; TRU-02 always warns, so it is a fact, not a flag.
const FLAGS = [
  ['PORT-02', 'publish', (m) => `${m.value} area${m.value === 1 ? '' : 's'} hold too much value in a flood-prone spot`],
  ['FIN-15', 'loss', () => 'The yearly cost depends heavily on tail assumptions (the high estimate is more than twice the low)'],
  ['EXP-09', 'exposure', (m) => `${pct(m.value)} of the property data is synthetic, not from the cedant`],
  ['ING-12', 'hazard', (m) => `Data quality is ${m.display}, below the 85 target`],
  ['TRU-05', 'hazard', (m) => {
    const open = (m.table?.rows || []).filter((row) => row[2] !== 'pass').map((row) => row[1]);
    return open.length ? `${open.length} automatic check${open.length === 1 ? '' : 's'} did not pass: ${open.join(', ')}` : `Not every automatic check passed (${m.display})`;
  }],
  ['HAZ-03', 'quality', (m) => `Flood depths are inconsistent between scenarios (${m.display})`],
  ['FIN-17', 'loss', () => 'Losses do not rise with flood severity, so the loss curve is suspect'],
];

export const CLASS_NAMES = { informal_iron_sheet: 'Iron sheet', semi_permanent: 'Semi-permanent', permanent_masonry: 'Masonry', concrete_rcc: 'Concrete' };
const className = (name) => CLASS_NAMES[name] || name;
const years = (label) => String(label).match(/1 in (\d+)/)?.[1];

// Simple pictures (shown first); the bar chart stays one click away for readers who want it.
function donut(slices, centre) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (!total) return null;
  return { type: 'donut', centre, slices: slices.map((slice) => ({ ...slice, share: pct(slice.value / total, slice.value > 0 && slice.value / total < 0.01 ? 1 : 0) })) };
}

// Every flood size side by side, and how susceptibility scores (0-1) become water depth (score × D_max).
function floodTiers(get) {
  const footprint = get('HAZ-02')?.chart;
  if (!footprint) return null;
  const depth = get('HAZ-04')?.chart;
  const scores = get('HAZ-01')?.chart;
  const financialCurve = get('FIN-14')?.chart || get('FIN-04')?.chart;
  const dMax = get('HAZ-10')?.value ?? 4;
  const series = (chart, name) => chart?.series?.find((item) => item.name === name)?.values || [];
  const at = (labels, n) => (labels || []).findIndex((label) => years(label) === n);
  const bandDepth = (band) => {
    const [low, high] = band.split('-').map(Number);
    return high == null ? 'Dry' : `${low ? (low * dMax).toFixed(1) : 'Up to'}${low ? '–' : ' '}${(high * dMax).toFixed(1)} m`;
  };
  const tiers = footprint.categories.map((label, index) => {
    const n = years(label);
    const d = at(depth?.x, n), r = at(scores?.rows, n);
    return {
      years: n, label: `About once every ${n} years`,
      buildingsPct: series(footprint, '% of properties')[index] ?? 0,
      valuePct: series(footprint, '% of TIV')[index] ?? 0,
      meanDepth: d >= 0 ? series(depth, 'mean')[d] : null,
      maxDepth: d >= 0 ? series(depth, 'max')[d] : null,
      bands: r >= 0 ? scores.cols.map((band, ci) => ({ score: band === '0' ? '0' : band.replace('-', '–'), depth: bandDepth(band), count: scores.values[r][ci] || 0 })) : [],
    };
  });
  const standard = tiers.findIndex((tier) => tier.years === '100');
  return { type: 'floodTiers', dMax, tiers, epCurve: financialCurve, defaultIndex: standard >= 0 ? standard : tiers.length - 1 };
}

// Financial engine: one building worked through, then ground-up -> gross -> net for every flood size, with the assumptions.
function financialView(get) {
  const waterfall = get('FIN-18')?.data?.tiers;
  if (!waterfall?.length) return null;
  const assumptions = get('FIN-21')?.data || {};
  const standard = waterfall.findIndex((tier) => tier.rp === 100);
  return {
    type: 'financial', tiers: waterfall, defaultIndex: standard >= 0 ? standard : waterfall.length - 1,
    example: get('FIN-19')?.data || null, aal: get('FIN-20')?.data || null,
    tierRp: assumptions.tierRp || null, terms: assumptions.terms || null, dMax: get('HAZ-10')?.value ?? 4,
    buildingCount: get('EXP-02')?.value ?? null,
  };
}

export function buildStory(metrics) {
  const all = Object.values(metrics?.stages || {}).flatMap((stage) => stage.metrics || []);
  if (!all.length) return null;
  const get = (id) => all.find((item) => item.id === id);
  const value = (id) => get(id)?.value ?? null;
  const measured = (id) => (get(id)?.value != null || get(id)?.chart || get(id)?.table) ? get(id) : null;

  const count = value('EXP-02');
  const tiv = value('EXP-01');
  const aal = value('FIN-05');
  const [aalLow, , aalHigh] = (get('FIN-05')?.chart?.series?.[0]?.values || []).map((v) => v == null ? null : v * 1e6);
  const l100 = value('FIN-01');
  const lossRatio = value('FIN-02');
  const wet250 = value('HAZ-02');
  const tivInBand = value('HAZ-06');
  const flagged = value('PORT-02');
  const top10 = value('FIN-11');
  const checks = get('TRU-05');
  const openAssumptions = value('TRU-02');

  const net100 = get('FIN-18')?.data?.tiers?.find((tier) => tier.rp === 100) || null;
  const classSplit = get('EXP-04')?.chart;
  const tivShare = classSplit?.series?.find((series) => series.name === '% of TIV')?.values || [];
  const valueDonut = classSplit && tiv != null ? donut(classSplit.categories.map((name, index) => ({ label: className(name), value: tivShare[index] || 0, display: kes((tivShare[index] || 0) / 100 * tiv) })), { value: kes(tiv), label: 'insured' }) : null;
  const tierLosses = get('FIN-01')?.chart;
  const ladder = tierLosses ? { type: 'ladder', rows: tierLosses.categories.map((label, index) => ({ label: years(label) ? `About once every ${years(label)} years` : label, value: tierLosses.series[0].values[index] || 0, display: kes((tierLosses.series[0].values[index] || 0) * 1e6), highlight: years(label) === '100' })) } : null;
  const byClass = get('FIN-09')?.chart;
  const at100 = byClass ? byClass.categories.findIndex((label) => years(label) === '100') : -1;
  const lossDonut = at100 >= 0 ? donut(byClass.series.map((series) => ({ label: className(series.name), value: series.values[at100] || 0, display: kes((series.values[at100] || 0) * 1e6) })), { value: kes(l100), label: '1-in-100 loss' }) : null;
  const checkList = checks?.table?.rows?.length ? { type: 'checks', items: checks.table.rows.map(([, label, status]) => ({ label, status })) } : null;

  const flags = FLAGS.map(([id, nodeId, text]) => {
    const metric = get(id);
    return metric && ['warn', 'fail'].includes(metric.status) ? { id, nodeId, severity: metric.status, text: text(metric) } : null;
  }).filter(Boolean);

  const headline = [
    { label: 'Insured value', value: kes(tiv), detail: count != null ? `${count.toLocaleString('en-KE')} buildings` : null },
    { label: 'Expected flood cost per year', value: kes(aal), detail: aalLow != null ? `range ${kes(aalLow)} – ${kes(aalHigh)}` : null },
    { label: '1-in-100 year flood loss', value: kes(l100), detail: net100 ? `ground-up · ${kes(net100.netKes)} net after reinsurance` : lossRatio != null ? `${pct(lossRatio, 1)} of insured value` : null },
  ];

  const chapters = [
    {
      key: 'covering', nodeId: 'exposure', question: 'What are we covering?',
      answer: `${count?.toLocaleString('en-KE') ?? 'n/a'} buildings insured for ${kes(tiv)}.`,
      facts: [measured('ING-12') && { label: 'Data quality', value: get('ING-12').display, status: get('ING-12').status }, measured('EXP-09') && { label: 'Synthetic (sample) records', value: pct(value('EXP-09')) }].filter(Boolean),
      chart: measured('EXP-04'), chartTitle: 'Where the value sits, by construction type',
      simple: valueDonut, simpleTitle: 'Share of insured value by construction type',
    },
    {
      key: 'flood', nodeId: 'quality', question: 'How much of it can flood?',
      answer: `${pct(tivInBand)} of insured value sits where floodwater can reach. In a rare 1-in-250 year flood, ${pct(wet250)} of buildings get wet.`,
      facts: [measured('VUL-06') && { label: 'Average damage to a flooded building', value: pct(value('VUL-06')) }].filter(Boolean),
      chart: measured('HAZ-02'), chartTitle: 'Share of buildings and value under water, by flood size',
      simple: wet250 != null ? { type: 'waffle', filled: wet250 * 100, noun: 'buildings', caption: 'get wet in a rare 1-in-250 year flood' } : null, simpleTitle: 'Buildings reached by water in a rare flood',
    },
    {
      key: 'cost', nodeId: 'loss', question: 'What could it cost us?',
      answer: `On average about ${kes(aal)} a year${aalLow != null ? ` (between ${kes(aalLow)} and ${kes(aalHigh)})` : ''}. A 1-in-100 year flood would cost ${kes(l100)}, or ${pct(lossRatio, 1)} of insured value.`,
      facts: [measured('FIN-06') && { label: 'Yearly cost as share of value', value: get('FIN-06').display },
        net100 && { label: '1-in-100 after policy terms (gross)', value: kes(net100.grossKes) },
        net100 && { label: '1-in-100 after reinsurance (net)', value: kes(net100.netKes) }].filter(Boolean),
      chart: measured('FIN-01'), chartTitle: 'Loss for each flood size',
      simple: ladder, simpleTitle: 'Ground-up cost of one flood, common to rare (years assumed)',
    },
    {
      key: 'concentration', nodeId: 'publish', question: 'Is the risk concentrated?',
      answer: [flagged == null ? null : flagged === 0 ? 'No area holds too much value in a flood-prone spot.' : `${flagged} area${flagged === 1 ? '' : 's'} hold too much value in a flood-prone spot.`,
        top10 != null ? `The 10 costliest buildings make up ${pct(top10)} of the 1-in-100 loss.` : null].filter(Boolean).join(' ') || 'Concentration was not measured for this run.',
      tone: flagged ? 'warn' : 'pass',
      table: get('PORT-02')?.table || null,
      chart: get('PORT-02')?.table ? null : measured('FIN-09'), chartTitle: 'Loss by construction type, for each flood size',
      simple: lossDonut, simpleTitle: 'Who drives a 1-in-100 year loss, by construction type',
    },
    {
      key: 'trust', nodeId: 'review', question: 'Can we trust these numbers?',
      answer: [checks ? `${checks.display.replace(' checks passed', '')} automatic checks passed.` : null, openAssumptions != null ? `${openAssumptions} modelling assumptions are still open and should be agreed before binding.` : null].filter(Boolean).join(' '),
      tone: checks?.status === 'pass' ? 'pass' : 'warn',
      facts: [value('FIN-15') != null && { label: 'Sensitivity to tail assumptions', value: `${get('FIN-15').status === 'warn' ? 'High' : 'Low'}: high estimate is ${value('FIN-15').toFixed(2)}× the low`, status: get('FIN-15').status }, measured('TRU-08') && { label: 'Known limitations', value: get('TRU-08').display }].filter(Boolean),
      simple: checkList, simpleTitle: 'Automatic model checks',
      list: get('TRU-02')?.table?.rows?.map(([name, current]) => `${name}: ${current}`) || [],
    },
  ];
  const byNode = Object.fromEntries(chapters.map((chapter) => [chapter.nodeId, chapter]));
  const funnel = get('ING-02')?.chart;
  const rows = (name) => funnel?.series?.[0]?.values?.[funnel.categories.indexOf(name)] ?? null;
  const damage = get('VUL-06')?.chart;
  const damageAt100 = damage ? damage.series.map((series) => ({ name: className(series.name), value: series.values[damage.categories.findIndex((label) => years(label) === '100')] })) : [];
  const weakest = damageAt100[0], strongest = damageAt100[damageAt100.length - 1];
  const dataChecks = (checks?.table?.rows || []).filter((row) => String(row[0]).startsWith('ING-') && row[2] !== 'pass').map((row) => row[1]);

  // One short result per pipeline stage: a sentence, up to three numbers and at most one picture.
  const stages = {
    hazard: {
      short: rows('received') != null ? `${rows('received').toLocaleString('en-KE')} rows · ${rows('rejected') ? `${rows('rejected')} rejected` : 'none rejected'}` : null,
      result: rows('received') != null ? `${rows('received').toLocaleString('en-KE')} rows received and ${rows('rejected') ? `${rows('rejected')} rejected` : 'none rejected'}.` : null,
      figures: [measured('ING-12') && { label: 'Data quality', value: get('ING-12').display, status: get('ING-12').status }, dataChecks.length > 0 && { label: 'Needs a look', value: dataChecks.join(', '), status: 'warn' }].filter(Boolean),
    },
    quality: { short: tivInBand != null ? `${pct(tivInBand)} of value can flood` : null, result: byNode.quality.answer, visual: floodTiers(get) || byNode.quality.simple },
    vulnerability: {
      short: value('VUL-06') != null ? `${pct(value('VUL-06'))} average damage when flooded` : null,
      result: weakest?.value != null && strongest?.value != null ? `When a 1-in-100 year flood reaches them, ${weakest.name.toLowerCase()} buildings lose about ${Math.round(weakest.value)}% of their value; ${strongest.name.toLowerCase()} buildings about ${Math.round(strongest.value)}%.` : null,
      figures: [value('VUL-06') != null && { label: 'Average damage to a flooded building', value: pct(value('VUL-06')) }, measured('VUL-04') && { label: 'Damage curve checks', value: get('VUL-04').display, status: get('VUL-04').status }].filter(Boolean),
    },
    exposure: { short: count != null ? `${count.toLocaleString('en-KE')} buildings · ${kes(tiv)}` : null, result: byNode.exposure.answer, visual: byNode.exposure.simple },
    loss: (() => {
      const view = financialView(get);
      const at100 = view?.tiers.find((tier) => tier.rp === 100);
      return {
        short: at100 ? `1 in 100: ${kes(at100.groundUpKes)} ground-up → ${kes(at100.netKes)} net` : aal != null ? `${kes(aal)} a year · ${kes(l100)} at 1 in 100` : null,
        result: at100 ? `A 1-in-100 year flood causes ${kes(at100.groundUpKes)} of damage (ground-up). After each building's deductible and limit the insurer owes ${kes(at100.grossKes)} (gross); after reinsurance it keeps ${kes(at100.netKes)} (net).` : byNode.loss.answer,
        visual: view || byNode.loss.simple,
      };
    })(),
    intelligence: { short: flags.length ? `${flags.length} thing${flags.length === 1 ? '' : 's'} to check` : 'Nothing unusual', result: byNode.publish.answer, flags },
    review: { short: checks ? `${checks.display.replace(' checks passed', '')} checks passed` : null, result: byNode.review.answer, visual: byNode.review.simple },
    publish: { short: metrics.status === 'approved' ? 'Released' : null, result: null },
  };

  const tiers = get('FIN-18')?.data?.tiers || [];
  const groundUpAt = (rp) => tiers.find((tier) => tier.rp === rp)?.groundUpKes ?? (() => {
    const chart = get('FIN-01')?.chart; const i = chart ? chart.categories.findIndex((label) => years(label) === String(rp)) : -1;
    return i >= 0 ? chart.series[0].values[i] * 1e6 : null;
  })();
  // The few numbers a decision rests on, and what limits trust in them.
  const numbers = { tivKes: tiv, loss100Kes: l100, loss250Kes: groundUpAt(250), aalLowKes: aalLow ?? null, aalHighKes: aalHigh ?? null, net100Kes: net100?.netKes ?? null };
  const trust = { syntheticShare: value('EXP-09'), openAssumptions, checksStatus: checks?.status || null, termsAssumed: !!get('FIN-21') };
  return { headline, flags, chapters, stages, numbers, trust };
}
