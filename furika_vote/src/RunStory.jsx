import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, CircleX, Loader2, Play, ShieldCheck } from 'lucide-react';
import { Chart } from './StageMetrics.jsx';
import { CLASS_NAMES, buildStory } from './runStory.js';
import StoryVisual from './StoryVisuals.jsx';
import './run-story.css';

// Readable category names; series names stay as-is because the class palette keys colours off them.
const readable = (chart) => ({ ...chart, categories: chart.categories?.map((name) => CLASS_NAMES[name] || name) });

const StatusIcon = ({ status }) => status === 'pass' ? <Check size={13}/> : status === 'fail' ? <CircleX size={13}/> : status === 'warn' ? <AlertTriangle size={13}/> : null;

// Simple picture first; the bar chart is the alternative for readers who want the full breakdown.
function ChapterVisual({ chapter }) {
  const hasChart = !!chapter.chart?.chart;
  const [mode, setMode] = useState(chapter.simple ? 'simple' : 'chart');
  if (!chapter.simple && !hasChart) return null;
  const showSimple = chapter.simple && (mode === 'simple' || !hasChart);
  return <figure className="rs-figure">
    <div className="rs-figure-head"><figcaption>{showSimple ? chapter.simpleTitle : chapter.chartTitle}</figcaption>
      {chapter.simple && hasChart && <div className="rs-figure-switch" role="tablist" aria-label="Chart style"><button type="button" role="tab" aria-selected={showSimple} className={showSimple ? 'active' : ''} onClick={() => setMode('simple')}>Simple</button><button type="button" role="tab" aria-selected={!showSimple} className={!showSimple ? 'active' : ''} onClick={() => setMode('chart')}>Bar chart</button></div>}</div>
    {showSimple ? <StoryVisual visual={chapter.simple}/> : <Chart chart={readable(chapter.chart.chart)}/>}
  </figure>;
}

function Chapter({ chapter, index, onOpenStage }) {
  return <section className={`rs-chapter ${chapter.tone || ''}`}>
    <span className="rs-step">{index + 1}</span>
    <div className="rs-chapter-body">
      <h3>{chapter.question}</h3>
      <p className="rs-answer">{chapter.answer}</p>
      {chapter.facts?.length > 0 && <dl className="rs-facts">{chapter.facts.map((fact) => <div key={fact.label} className={fact.status || ''}><dt>{fact.label}</dt><dd><StatusIcon status={fact.status}/>{fact.value}</dd></div>)}</dl>}
      <ChapterVisual chapter={chapter}/>
      {chapter.table && <table className="rs-table"><thead><tr>{chapter.table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{chapter.table.rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>)}</tbody></table>}
      {chapter.list?.length > 0 && <details className="rs-list"><summary>See the open assumptions</summary><ul>{chapter.list.map((item) => <li key={item}>{item}</li>)}</ul></details>}
      <button type="button" className="rs-more" onClick={() => onOpenStage(chapter.nodeId)}>All figures behind this <ChevronRight size={14}/></button>
    </div>
  </section>;
}

export default function RunStory({ metrics, loading, error, runId, runStatus, awaitingApproval, running, onDecide, onOpenStage, onRun }) {
  const story = useMemo(() => buildStory(metrics), [metrics]);
  if (!runId) return <div className="rs-empty"><strong>No portfolio results yet</strong><span>Calculate the portfolio to see what it covers, how much could flood and what it could cost.</span><button type="button" onClick={onRun}><Play size={14}/> Calculate portfolio</button></div>;
  if (loading && !story) return <div className="rs-empty"><Loader2 size={20} className="spin"/><strong>Preparing the summary…</strong></div>;
  if (error && !story) return <div className="rs-empty error"><AlertTriangle size={20}/><strong>Summary unavailable</strong><span>{error}</span></div>;
  if (!story) return null;
  const approved = runStatus === 'approved';
  return <div className="run-story">
    <section className="rs-bottom-line">
      <span className="rs-kicker">The bottom line</span>
      <div className="rs-kpis">{story.headline.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.detail && <small>{item.detail}</small>}</div>)}</div>
      {story.flags.length > 0
        ? <div className="rs-flags"><strong><AlertTriangle size={15}/> {story.flags.length} thing{story.flags.length === 1 ? '' : 's'} to check before you decide</strong><ul>{story.flags.map((flag) => <li key={flag.id} className={flag.severity}><button type="button" onClick={() => onOpenStage(flag.nodeId)}>{flag.text}<ChevronRight size={14}/></button></li>)}</ul></div>
        : <div className="rs-flags clear"><strong><Check size={15}/> No warnings raised by the model checks</strong></div>}
      {awaitingApproval && <div className="rs-quick-decision"><span>Your decision</span><button type="button" disabled={running} onClick={() => onDecide('return')}>Send back</button><button type="button" className="primary" disabled={running} onClick={() => onDecide('approve')}><Check size={14}/> Approve</button></div>}
    </section>
    {story.chapters.map((chapter, index) => <Chapter key={chapter.key} chapter={chapter} index={index} onOpenStage={onOpenStage}/>)}
    <section className={`rs-decision ${approved ? 'approved' : ''}`}>
      <ShieldCheck size={20}/>
      <div><strong>{approved ? 'You approved this run' : awaitingApproval ? 'Your decision' : 'Decision'}</strong><span>{approved ? 'Results are released to the map and reports.' : awaitingApproval ? 'Approve to release these results, or send them back with the assumptions to revise.' : runStatus === 'revision_requested' ? 'This run was returned for revision. Recalculate when the assumptions are updated.' : 'Calculate the portfolio to request a decision.'}</span></div>
      {awaitingApproval && <div className="rs-decision-actions"><button type="button" disabled={running} onClick={() => onDecide('return')}>Return for revision</button><button type="button" className="primary" disabled={running} onClick={() => onDecide('approve')}><Check size={14}/> Approve</button></div>}
    </section>
    <p className="rs-guardrail">Model estimates inform your decision; they do not approve cover. Run {runId}.</p>
  </div>;
}
