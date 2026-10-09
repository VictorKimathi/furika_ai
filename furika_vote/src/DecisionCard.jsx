import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Clock3, Download, FileText, Loader2, Undo2 } from 'lucide-react';
import { kes, pct } from './runStory.js';
import './decision-card.css';

const CONFIDENCE_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

function Numbers({ numbers }) {
  if (numbers?.loss100Kes == null) return <p className="dc-no-number">No loss could be calculated. The checks below say what is missing.</p>;
  const share = numbers.tivKes ? ` (${pct(numbers.loss100Kes / numbers.tivKes, 1)} of insured value)` : '';
  return <dl className="dc-numbers">
    <div className="lead"><dt>1-in-100 year loss</dt><dd>{kes(numbers.loss100Kes)}<small>{share}</small></dd></div>
    <div><dt>1-in-250 year loss</dt><dd>{kes(numbers.loss250Kes)}</dd></div>
    {numbers.aalLowKes != null && <div><dt>Average yearly loss</dt><dd>{kes(numbers.aalLowKes)} to {kes(numbers.aalHighKes)}</dd></div>}
    {numbers.net100Kes != null && <div><dt>1-in-100 after reinsurance</dt><dd>{kes(numbers.net100Kes)}</dd></div>}
  </dl>;
}

function CheckRow({ check, onOpenSource }) {
  const [open, setOpen] = useState(false);
  const opensElsewhere = check.source?.nodeId && onOpenSource;
  return <li className={check.severity}>
    <button type="button" aria-expanded={opensElsewhere ? undefined : open} onClick={() => opensElsewhere ? onOpenSource(check.source.nodeId) : setOpen(!open)}>
      <i aria-hidden="true"/><span>{check.title}</span><small>{opensElsewhere ? 'Open' : open ? 'Hide' : 'Source'}</small>
    </button>
    {open && <div className="dc-check-source">
      {check.detail && <p>{check.detail}</p>}
      <p className="dc-quote"><FileText size={12}/> <strong>{check.source?.label}</strong>{check.source?.quote ? <>: “{check.source.quote}”</> : ' (no single line of the submission; see the full review)'}</p>
    </div>}
  </li>;
}

function DigDeeper({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!items?.length) return null;
  return <div className="dc-more" ref={ref}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Dig deeper <ChevronDown size={13}/></button>
    {open && <div className="dc-more-menu" role="menu">{items.map((item) => <button type="button" role="menuitem" key={item.label} onClick={() => { setOpen(false); item.onClick(); }}>{item.label}</button>)}</div>}
  </div>;
}

// The home of every answer that has a risk to decide: number, checks, trust, then Approve / Send back.
export default function DecisionCard({ card, record, busy, error, canDecide, onDecide, digDeeper, onShare, sharing, sources, onOpenSource }) {
  const [showWhy, setShowWhy] = useState(false);
  if (!card) return null;
  const confidence = card.confidence || { level: 'low', reasons: [] };
  return <section className="decision-card" aria-label={`Decision on ${card.name}`}>
    <header><div><strong>{card.name}</strong>{card.reference && <small>{card.reference}</small>}</div>{card.deadline && <span className={card.deadline.urgent ? 'urgent' : ''}><Clock3 size={12}/>{card.deadline.text}</span>}</header>
    <Numbers numbers={card.numbers}/>
    <div className="dc-checks">
      <h4>Check before deciding</h4>
      {card.checks.length ? <ul>{card.checks.map((check) => <CheckRow key={check.title} check={check} onOpenSource={onOpenSource}/>)}</ul> : <p className="dc-clear"><Check size={13}/> Nothing found that should change the decision.</p>}
      {card.moreChecks > 0 && <small className="dc-more-checks">{card.moreChecks} smaller point{card.moreChecks === 1 ? '' : 's'} under Dig deeper.</small>}
    </div>
    <div className={`dc-confidence ${confidence.level}`}>
      <span>Confidence: <strong>{CONFIDENCE_LABEL[confidence.level] || confidence.level}</strong>. {confidence.reasons[0]}</span>
      <button type="button" onClick={() => setShowWhy(!showWhy)} aria-expanded={showWhy}>{showWhy ? 'Hide' : 'Why and sources'}</button>
      {showWhy && <div className="dc-why"><ul>{confidence.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>{sources && <p><FileText size={12}/> {sources}</p>}</div>}
    </div>
    <footer>
      {record ? <p className={`dc-record ${record.action}`}>{record.action === 'approve' ? <Check size={14}/> : <Undo2 size={14}/>}{record.action === 'approve' ? 'Approved' : 'Sent back'} by {record.decidedBy} · {new Date(record.decidedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
        : canDecide ? <div className="dc-decide"><button type="button" className="primary" disabled={busy} onClick={() => onDecide('approve')}>{busy ? <Loader2 size={14} className="spin"/> : <Check size={14}/>} Approve</button><button type="button" disabled={busy} onClick={() => onDecide('send_back')}><Undo2 size={14}/> Send back</button></div>
        : <span/>}
      <div className="dc-secondary"><DigDeeper items={digDeeper}/><button type="button" className="dc-share" onClick={onShare} disabled={sharing}><Download size={14}/>{sharing ? 'Preparing…' : 'Download report'}</button></div>
    </footer>
    {error && <p className="dc-error" role="alert">{error}</p>}
  </section>;
}
