import React, { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, CircleHelp, ShieldCheck } from 'lucide-react';
import './offer-checks.css';

export default function OfferChecks({ report }) {
  const [expanded, setExpanded] = useState(() => new Set(['hazard_intensity', 'vulnerability', 'financial_loss']));
  if (!report?.stages?.length) return null;
  const toggle = (key) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const evaluated = report.stages.filter((stage) => stage.status !== 'review');
  const blocked = evaluated.filter((stage) => stage.status === 'blocked').length;
  return <section className="offer-checks" aria-label="Placement offer checks">
    <header><div><ShieldCheck size={16}/><span><strong>Placement checks</strong><small>{evaluated.length - blocked} evaluated · {blocked} blocked · human review pending</small></span></div></header>
    <p className="offer-checks-note">These checks apply to this offer only. They do not add the building to the portfolio or approve cover.</p>
    <div className="offer-check-list">{report.stages.map((stage, index) => <div key={stage.key} className={`offer-check ${stage.status}`}><button type="button" aria-expanded={expanded.has(stage.key)} onClick={() => toggle(stage.key)}><span className="offer-check-index">{String(index + 1).padStart(2, '0')}</span><span className="offer-check-name"><strong>{stage.title}</strong><small>{stage.summary}</small></span><em>{stage.status === 'complete' ? <Check size={12}/> : stage.status === 'review' ? <CircleHelp size={12}/> : <AlertTriangle size={12}/>} {stage.status === 'complete' ? 'Done' : stage.status === 'warning' ? 'Caution' : stage.status === 'blocked' ? 'Blocked' : 'Review'}</em><ChevronDown className={expanded.has(stage.key) ? 'expanded' : ''} size={13}/></button>{expanded.has(stage.key) && stage.details?.length > 0 && <ul>{stage.details.map((detail, detailIndex) => <li key={`${stage.key}-${detailIndex}`}>{detail}</li>)}</ul>}</div>)}</div>
  </section>;
}
