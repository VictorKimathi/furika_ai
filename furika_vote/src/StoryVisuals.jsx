import React, { useState } from 'react';
import { AlertTriangle, Check, CircleX } from 'lucide-react';
import { CLASS_NAMES, kes, pct } from './runStory.js';
import { Chart } from './StageMetrics.jsx';
import './run-story.css';

// Plain-language pictures for the summary: one per chapter, each readable without knowing how to read an axis.
// Construction types run weakest to strongest, so they share one blue ramp (validated: ordinal, light surface).
const CLASS_RAMP = ['#86b6ef', '#5598e7', '#1c5cab', '#0d366b'];

function Donut({ visual }) {
  const [hover, setHover] = useState(null);
  const total = visual.slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const r = 70, stroke = 26, c = 2 * Math.PI * r, gap = 2;
  let offset = 0;
  const shown = hover != null ? visual.slices[hover] : null;
  return <div className="sv-donut">
    <svg viewBox="0 0 180 180" role="img" aria-label={visual.slices.map((slice) => `${slice.label} ${slice.display}`).join(', ')}>
      <circle cx="90" cy="90" r={r} fill="none" stroke="#edf1f6" strokeWidth={stroke}/>
      {visual.slices.map((slice, index) => {
        const length = slice.value / total * c;
        const dash = Math.max(length - gap, 0);
        const el = dash > 0 && <circle key={slice.label} cx="90" cy="90" r={r} fill="none" stroke={CLASS_RAMP[index % CLASS_RAMP.length]} strokeWidth={hover === index ? stroke + 6 : stroke}
          strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset} transform="rotate(-90 90 90)" onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}/>;
        offset += length;
        return el;
      })}
      <text x="90" y="86" textAnchor="middle" className="sv-donut-value">{shown ? shown.display : visual.centre.value}</text>
      <text x="90" y="104" textAnchor="middle" className="sv-donut-label">{shown ? shown.label : visual.centre.label}</text>
    </svg>
    <ul className="sv-key">{visual.slices.map((slice, index) => <li key={slice.label} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} className={hover === index ? 'active' : ''}><i style={{ background: CLASS_RAMP[index % CLASS_RAMP.length] }}/><span>{slice.label}</span><strong>{slice.share}</strong>{slice.display && <small>{slice.display}</small>}</li>)}</ul>
  </div>;
}

function Waffle({ visual }) {
  const filled = Math.max(0, Math.min(100, Math.round(visual.filled)));
  return <div className="sv-waffle">
    <div className="sv-waffle-grid" role="img" aria-label={`${filled} of 100 ${visual.noun}`}>{Array.from({ length: 100 }, (_, index) => <i key={index} className={index < filled ? 'on' : ''}/>)}</div>
    <p><strong>{filled} of every 100</strong> {visual.noun} {visual.caption}</p>
  </div>;
}

function Ladder({ visual }) {
  const max = Math.max(...visual.rows.map((row) => row.value), 1e-9);
  return <div className="sv-ladder">{visual.rows.map((row) => <div key={row.label} className={row.highlight ? 'highlight' : ''}>
    <span>{row.label}</span>
    <div className="sv-ladder-track"><i style={{ width: `${Math.max(1, row.value / max * 100)}%` }}/></div>
    <strong>{row.display}</strong>
  </div>)}</div>;
}

// Wetter bands are darker (validated ordinal ramp); dry buildings are counted in text, not drawn.
const DEPTH_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'];
const metres = (value) => value == null ? 'n/a' : `${value.toFixed(1)} m`;

function FloodTiers({ visual }) {
  const [index, setIndex] = useState(visual.defaultIndex);
  const tier = visual.tiers[index] || visual.tiers[0];
  const wet = tier.bands.filter((band) => band.score !== '0');
  const dry = tier.bands.find((band) => band.score === '0')?.count;
  const most = Math.max(...wet.map((band) => band.count), 1);
  return <div className="sv-tiers">
    <h5>Every flood size <small>years are assumed · tap one</small></h5>
    <div className="sv-tier-list" role="tablist" aria-label="Flood size">{visual.tiers.map((item, i) => <button type="button" role="tab" aria-selected={i === index} key={item.years} className={i === index ? 'active' : ''} onClick={() => setIndex(i)}>
      <span>{item.label}</span>
      <div className="sv-ladder-track"><i style={{ width: `${Math.max(1, item.buildingsPct)}%` }}/></div>
      <strong>{Math.round(item.buildingsPct)}% of buildings</strong>
    </button>)}</div>
    <div className="sv-tier-detail">
      <Waffle visual={{ filled: tier.buildingsPct, noun: 'buildings', caption: `get wet in a flood seen ${tier.label.toLowerCase()}` }}/>
      <dl className="pl-figures"><div><dt>Insured value under water</dt><dd>{Math.round(tier.valuePct)}%</dd></div><div><dt>Typical water depth</dt><dd>{metres(tier.meanDepth)}</dd></div><div><dt>Deepest water</dt><dd>{metres(tier.maxDepth)}</dd></div></dl>
    </div>
    {wet.length > 0 && <div className="sv-suscept">
      <h5>How flood susceptibility becomes water depth</h5>
      <p>Each location has a susceptibility score for every flood size, from 0 (stays dry) to 1 (most exposed). Water depth is the score × {visual.dMax} m, so a score of 0.5 means about {(visual.dMax / 2).toFixed(1)} m of water.</p>
      <div className="sv-hist" role="img" aria-label={wet.map((band) => `${band.count} buildings at ${band.depth}`).join(', ')}>{wet.map((band, i) => <div key={band.score} title={`${band.count} buildings · score ${band.score} · ${band.depth}`}>
        <em>{band.count}</em>
        <div className="sv-hist-bar"><i style={{ height: `${band.count ? Math.max(3, band.count / most * 100) : 0}%`, background: DEPTH_RAMP[i % DEPTH_RAMP.length] }}/></div>
        <strong>{band.depth.replace('Up to ', '≤ ')}</strong>
        <small>score {band.score}</small>
      </div>)}</div>
      {dry != null && <p className="sv-hist-note">Buildings by water depth in this flood. {dry.toLocaleString('en-KE')} more stay dry.</p>}
    </div>}
    {visual.epCurve && <div className="sv-ep-curve"><h5>Loss against rarity <small>exceedance probability (EP) curve</small></h5><Chart chart={visual.epCurve}/></div>}
  </div>;
}

const rpLabel = (rp) => `1 in ${rp}`;

function WorkedExample({ example, dMax, buildingCount }) {
  const step = example.steps.find((item) => item.rp === 100) || example.steps[example.steps.length - 1];
  const type = (CLASS_NAMES[example.housingClass] || example.housingClass).toLowerCase();
  const limitHit = step.groundUpKes - example.deductibleKes > example.limitKes;
  const lines = [
    ['Flood susceptibility score', step.score.toFixed(2), `for a ${rpLabel(step.rp)} year flood`],
    ['Water depth', `${step.depthM.toFixed(2)} m`, `${step.score.toFixed(2)} × ${dMax} m`],
    ['Damage ratio', pct(step.damageRatio, 1), `from the ${type} damage curve at that depth`],
    ['Ground-up loss', kes(step.groundUpKes), `${pct(step.damageRatio, 1)} × ${kes(example.tivKes)} insured value`],
    ['Gross loss', kes(step.grossKes), `minus the ${kes(example.deductibleKes)} deductible${limitHit ? ', capped at the limit' : `; the ${kes(example.limitKes)} limit is not reached`}`],
  ];
  return <section className="sv-fin-block">
    <h5>One building, step by step <small>{example.locId}, {type}</small></h5>
    <ol className="sv-chain">{lines.map(([label, value, how]) => <li key={label}><span>{label}</span><strong>{value}</strong><small>{how}</small></li>)}</ol>
    <p className="sv-fin-note">Repeat for {buildingCount ? `all ${buildingCount.toLocaleString('en-KE')}` : 'every'} building{buildingCount === 1 ? '' : 's'} and add them up to get the portfolio loss for this flood. Repeat for each flood size to get the curve below.</p>
  </section>;
}

function Waterfall({ tier }) {
  const steps = [
    { label: 'Ground-up loss', value: tier.groundUpKes, kind: 'total' },
    { label: 'Owners pay (deductibles)', value: -tier.ownerKeepsKes, kind: 'less' },
    { label: 'Above building limits', value: -tier.aboveLimitKes, kind: 'less' },
    { label: 'Gross loss (insurer owes)', value: tier.grossKes, kind: 'total' },
    { label: 'Reinsurer: quota share', value: -tier.quotaShareKes, kind: 'less' },
    { label: 'Reinsurer: cat excess of loss', value: -tier.catXlKes, kind: 'less' },
    { label: 'Net loss (insurer keeps)', value: tier.netKes, kind: 'net' },
  ];
  const max = Math.max(tier.groundUpKes, 1e-9);
  let running = 0;
  return <div className="sv-waterfall" role="table" aria-label="Loss waterfall">{steps.map((step) => {
    const start = step.kind === 'less' ? running + step.value : 0;
    const width = Math.abs(step.value);
    if (step.kind !== 'less') running = step.value; else running += step.value;
    return <div key={step.label} role="row" className={step.kind}>
      <span role="cell">{step.label}</span>
      <div className="sv-wf-track"><i style={{ left: `${start / max * 100}%`, width: `${Math.max(width ? 0.6 : 0, width / max * 100)}%` }}/></div>
      <strong role="cell">{step.kind === 'less' ? (width ? `− ${kes(width)}` : 'KES 0') : kes(step.value)}</strong>
    </div>;
  })}</div>;
}

function Financial({ visual }) {
  const [index, setIndex] = useState(visual.defaultIndex);
  const tier = visual.tiers[index] || visual.tiers[0];
  const terms = visual.terms;
  const tierRp = visual.tierRp ? Object.entries(visual.tierRp).sort((a, b) => a[1] - b[1]) : [];
  return <div className="sv-fin">
    {visual.example && <WorkedExample example={visual.example} dMax={visual.dMax} buildingCount={visual.buildingCount}/>}
    <section className="sv-fin-block">
      <h5>From damage to what the insurer keeps</h5>
      <div className="sv-rp-picker" role="tablist" aria-label="Flood size">{visual.tiers.map((item, i) => <button type="button" role="tab" aria-selected={i === index} key={item.rp} className={i === index ? 'active' : ''} onClick={() => setIndex(i)}>{rpLabel(item.rp)}</button>)}</div>
      <Waterfall tier={tier}/>
    </section>
    <section className="sv-fin-block">
      <h5>Loss against rarity <small>exceedance probability (EP) curve</small></h5>
      <table className="sv-ep"><thead><tr><th>Flood</th><th>Chance a year</th><th>Ground-up</th><th>Gross</th><th>Net</th></tr></thead>
        <tbody>{visual.tiers.map((item, i) => <tr key={item.rp} className={i === index ? 'active' : ''} onClick={() => setIndex(i)}><td>{rpLabel(item.rp)}</td><td>{pct(1 / item.rp, item.rp >= 100 ? 1 : 0)}</td><td>{kes(item.groundUpKes)}</td><td>{kes(item.grossKes)}</td><td><strong>{kes(item.netKes)}</strong></td></tr>)}</tbody>
        {visual.aal && <tfoot><tr><td colSpan={2}>Average per year (AAL)</td><td>{kes(visual.aal.ground_up)}</td><td>{kes(visual.aal.gross)}</td><td><strong>{kes(visual.aal.net)}</strong></td></tr></tfoot>}
      </table>
      <p className="sv-fin-note">Read a row as: in any year there is that chance of a loss at least this big. Budget for the 1-in-100 and 1-in-250 rows.</p>
    </section>
    {(terms || tierRp.length > 0) && <section className="sv-fin-block sv-assumed">
      <h5>Assumed, not supplied</h5>
      <ul>
        {tierRp.length > 0 && <li><strong>Flood sizes:</strong> the five tiers have no official years, so we assume {tierRp.map(([name, rp]) => `${name} = ${rpLabel(rp)}`).join(', ')}.</li>}
        {terms && <li><strong>Policy:</strong> each building has a deductible of {pct(terms.deductible_pct_tiv, 1)} of its value and a limit of {pct(terms.limit_pct_tiv)} of its value.</li>}
        {terms && <li><strong>Reinsurance:</strong> a {pct(terms.quota_share_ceded)} quota share applies first; then a cat excess of loss pays {kes(terms.cat_xl_limit_kes)} above {kes(terms.cat_xl_attachment_kes)} of what the insurer keeps from each flood.</li>}
      </ul>
    </section>}
  </div>;
}

const CHECK_ICON = { pass: Check, warn: AlertTriangle, fail: CircleX };
function Checks({ visual }) {
  return <ul className="sv-checks">{visual.items.map((item) => { const Icon = CHECK_ICON[item.status] || AlertTriangle; return <li key={item.label} className={item.status}><Icon size={14}/><span>{item.label}</span><em>{item.status === 'pass' ? 'Passed' : item.status === 'fail' ? 'Failed' : 'Needs a look'}</em></li>; })}</ul>;
}

export default function StoryVisual({ visual }) {
  if (!visual) return null;
  if (visual.type === 'donut') return <Donut visual={visual}/>;
  if (visual.type === 'waffle') return <Waffle visual={visual}/>;
  if (visual.type === 'ladder') return <Ladder visual={visual}/>;
  if (visual.type === 'checks') return <Checks visual={visual}/>;
  if (visual.type === 'floodTiers') return <FloodTiers visual={visual}/>;
  if (visual.type === 'financial') return <Financial visual={visual}/>;
  return null;
}
