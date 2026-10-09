import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, CircleHelp, ShieldCheck } from 'lucide-react';
import './offer-workflow.css';

const statusLabel = { complete: 'Done', warning: 'Check', blocked: 'Unavailable', review: 'Your review' };
const safeNumber = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const firstStage = (stages) => Math.max(0, stages.findIndex((stage) => stage.key === 'financial_loss' && stage.status === 'complete'));

function StageVisual({ visual }) {
  if (!visual) return null;
  const rows = visual.rows || [];
  if (visual.type === 'bars') {
    const maximum = Math.max(safeNumber(visual.max), ...rows.map((row) => safeNumber(row.value)), 1e-9);
    return <figure className="offer-visual">{visual.highlights?.length > 0 && <div className="offer-facts offer-highlights">{visual.highlights.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>}<figcaption>{visual.unit === 'score' ? 'Flood susceptibility by scenario' : visual.unit === 'damage ratio' ? 'Expected damage by scenario' : 'Modelled building loss by scenario'} <span>{visual.unit}</span></figcaption>
      <div className="offer-bars" role="img" aria-label={`${visual.unit} chart: ${rows.map((row) => `${row.label} ${row.display}`).join(', ')}`}>
        {rows.map((row, index) => <div className="offer-bar-row" key={`${row.label}-${index}`}><span>{row.label}</span><div className="offer-bar-track"><i style={{ width: `${Math.min(100, safeNumber(row.value) / maximum * 100)}%` }}/></div><strong>{row.display}</strong>{row.detail && <small>{row.detail}</small>}</div>)}
      </div>
      <details className="offer-data-table"><summary>View numbers as a table</summary><table><thead><tr><th>Scenario</th><th>{visual.unit}</th>{rows.some((row) => row.detail) && <th>Context</th>}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.label}-${index}`}><td>{row.label}</td><td>{row.display}</td>{rows.some((item) => item.detail) && <td>{row.detail || '—'}</td>}</tr>)}</tbody></table></details>
    </figure>;
  }
  if (visual.type === 'facts') return <div className="offer-facts">{rows.map((row, index) => <div key={`${row.label}-${index}`}><span>{row.label}</span><strong>{row.value}</strong></div>)}</div>;
  if (visual.type === 'findings') return rows.length ? <div className="offer-findings" role="list">{rows.map((row, index) => <div role="listitem" key={`${row.label}-${index}`}><span className={row.severity}>{row.severity}</span><strong>{row.label}</strong><ChevronRight size={15}/></div>)}</div> : <div className="offer-clear"><Check size={19}/> No rule-based findings</div>;
  if (visual.type === 'checklist') return <div className="offer-checklist">{rows.map((row, index) => <div key={`${row.label}-${index}`}><i>{index + 1}</i><span>{row.label}</span></div>)}</div>;
  return null;
}

export default function OfferWorkflowWorkspace({ review, onViewPortfolio }) {
  const stages = review?.offerChecks?.stages || [];
  const [selected, setSelected] = useState(() => firstStage(stages));
  useEffect(() => setSelected(firstStage(review?.offerChecks?.stages || [])), [review]);
  const active = stages[selected];
  const complete = stages.filter((stage) => stage.status === 'complete').length;
  const needsAttention = stages.filter((stage) => ['warning', 'blocked'].includes(stage.status)).length;
  const awaiting = stages.filter((stage) => stage.status === 'review').length;
  const total = stages.length || 1;

  return <section className="offer-workflow-workspace" aria-label="Single-offer workflow">
    <header className="offer-workflow-header">
      <div><span>SINGLE OFFER · UNDERWRITER VIEW</span><h2>Offer review</h2><p>{review?.source || 'Pasted placement offer'}</p></div>
      <span className="offer-workflow-review"><ShieldCheck size={17}/> Your decision is needed</span>
    </header>
    <div className="offer-overview" aria-label="Review progress">
      <div className="offer-progress-ring" style={{ '--done': `${complete / total * 100}%`, '--attention': `${(complete + needsAttention) / total * 100}%` }}><strong>{complete}<small>of {stages.length}</small></strong></div>
      <div className="offer-progress-copy"><strong>Checks at a glance</strong><div className="offer-progress-counts"><span className="done"><i/>{complete} complete</span><span className="attention"><i/>{needsAttention} need attention</span><span className="review"><i/>{awaiting} for you</span></div></div>
      <div className="offer-scope"><strong>One offer only</strong><span>Portfolio assets are not included in these results.</span></div>
    </div>
    <div className="offer-workflow-body">
      <nav className="offer-workflow-steps" aria-label="Offer review stages">{stages.map((stage, index) => <button type="button" key={stage.key} className={`${stage.status} ${selected === index ? 'selected' : ''}`} onClick={() => setSelected(index)} aria-current={selected === index ? 'step' : undefined}><i>{stage.status === 'complete' ? <Check size={15}/> : stage.status === 'review' ? <CircleHelp size={15}/> : <AlertTriangle size={15}/>}</i><span><strong>{stage.title}</strong><small>{statusLabel[stage.status] || stage.status}</small></span><ChevronRight size={16}/></button>)}</nav>
      <article className="offer-workflow-detail">
        {active ? <><div className="offer-workflow-detail-head"><span>CHECK {selected + 1} OF {stages.length}</span><em className={active.status}>{statusLabel[active.status] || active.status}</em></div><h3>{active.title}</h3><StageVisual visual={active.visual}/><p className={`offer-stage-summary ${active.status}`}>{active.summary}</p>{active.details?.length > 0 && <details className="offer-evidence"><summary>Why this result? View evidence and assumptions</summary><ul>{active.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul></details>}</> : <p>No offer checks are available yet.</p>}
        <div className="offer-workflow-guardrail">These checks inform a human decision. They do not approve cover.</div>
      </article>
    </div>
    <footer><button type="button" onClick={onViewPortfolio}>Open separate portfolio workflow <ChevronRight size={15}/></button></footer>
  </section>;
}
