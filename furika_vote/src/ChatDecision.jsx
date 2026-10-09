import React, { useEffect, useState } from 'react';
import { Download, Plus, RotateCcw } from 'lucide-react';
import DecisionCard from './DecisionCard.jsx';
import { needFromYou, offerCard, storyCard } from './decision.js';
import { buildStory } from './runStory.js';
import { PORTFOLIO_ID, apiGet, apiRequest } from './api.js';
import kenyaReReportLogo from './assets/kenya-re-logo-light.png?inline';

const post = (path, body) => apiRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Share: the same "Download report" everywhere, built from whatever message is in view.
export function useReport() {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const share = async (message) => {
    setSharing(true); setError('');
    try {
      const { downloadChatReportPdf } = await import('./chatReportPdf.js');
      downloadChatReportPdf(message, { logoDataUrl: kenyaReReportLogo, portfolioId: PORTFOLIO_ID, generatedAt: message.createdAt || new Date() });
    } catch (err) { setError(err.message || 'Could not create the PDF report.'); }
    finally { setSharing(false); }
  };
  return { sharing, error, share };
}

function useDecisionRecord(subjectRef) {
  const [record, setRecord] = useState(null);
  const reload = () => subjectRef && apiGet(`/decisions?subjectRef=${encodeURIComponent(subjectRef)}`).then((body) => setRecord(body.items?.[0] || null)).catch(() => {});
  useEffect(() => { reload(); }, [subjectRef]);
  return [record, setRecord, reload];
}

const sourcesText = (message) => [message.source, ...new Set((message.citations || []).map((c) => c.filename || c.propertyId || c.runId || c.name || c.offer).filter(Boolean))].filter(Boolean).slice(0, 5).join(' · ');

export function OfferDecision({ message, reportMessage, onOpenView }) {
  const card = offerCard(message.decision);
  const [record, setRecord] = useDecisionRecord(card?.subjectRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const report = useReport();
  const decide = async (action) => {
    setBusy(true); setError('');
    try {
      setRecord(await post('/decisions', { subjectType: 'offer', subjectRef: card.subjectRef, subjectLabel: card.subjectLabel, action, portfolioId: PORTFOLIO_ID,
        snapshot: { numbers: card.numbers, checks: card.checks.map((check) => ({ severity: check.severity, title: check.title })), confidence: card.confidence, reference: card.reference } }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return <DecisionCard card={card} record={record} busy={busy} error={error || report.error} canDecide onDecide={decide}
    digDeeper={[{ label: 'Offer checks, stage by stage', onClick: () => onOpenView('offer-workflow', false, message) }, { label: 'Offer location on the map', onClick: () => onOpenView('map') }]}
    onShare={() => report.share(reportMessage)} sharing={report.sharing} sources={sourcesText(message)}/>;
}

export function RunDecision({ message, reportMessage, onOpenView, onRunDecided }) {
  const runId = message.workflow?.runId;
  const [metrics, setMetrics] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [record, , reloadRecord] = useDecisionRecord(runId ? `run:${runId}` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const report = useReport();
  const load = () => apiGet(`/model-runs/${runId}/metrics`).then(setMetrics).catch((err) => setLoadError(err.message));
  useEffect(() => { if (runId) load(); }, [runId]);
  const status = metrics?.status || message.workflow?.status;
  const card = metrics ? storyCard(buildStory(metrics), { runId, portfolioId: metrics.portfolioId || PORTFOLIO_ID, status }) : null;
  const decide = async (action) => {
    setBusy(true); setError('');
    try {
      await post(`/model-runs/${runId}/decision`, { action: action === 'approve' ? 'approve' : 'return' });
      await Promise.all([load(), reloadRecord()]);
      onRunDecided?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  if (!card) return <p className="decision-loading">{loadError ? `Could not load the run figures: ${loadError}` : 'Loading the figures for this run…'}</p>;
  return <DecisionCard card={card} record={record} busy={busy} error={error || report.error} canDecide={status === 'review'} onDecide={decide}
    digDeeper={[{ label: 'Results and model stages', onClick: () => onOpenView('workflow') }, { label: 'Portfolio on the map', onClick: () => onOpenView('map') }]}
    onShare={() => report.share(reportMessage)} sharing={report.sharing} sources={sourcesText(message)} onOpenSource={() => onOpenView('workflow')}/>;
}

export function AnswerFooter({ message, reportMessage }) {
  const report = useReport();
  const sources = sourcesText(message);
  return <div className="answer-footer">
    {sources ? <details><summary>Sources used</summary><div>{sources}</div></details> : <span/>}
    <button type="button" className="dc-share" onClick={() => report.share(reportMessage)} disabled={report.sharing}><Download size={14}/>{report.sharing ? 'Preparing…' : 'Download report'}</button>
    {report.error && <small className="dc-error" role="alert">{report.error}</small>}
  </div>;
}

// A failed answer is never a dead end: say what is needed, and offer Retry.
export function NeedFromYou({ message, onRetry, onAddFile }) {
  const need = needFromYou(message.content);
  return <div className="need-from-you">
    <strong>What I need from you</strong>
    <p>{need.ask}</p>
    <small>Details: {message.content}</small>
    <div>{message.request && <button type="button" className="primary" onClick={onRetry}><RotateCcw size={14}/> Retry</button>}{need.addFile && <button type="button" onClick={onAddFile}><Plus size={14}/> Add file</button>}</div>
  </div>;
}
