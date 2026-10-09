import React from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Clock3, Loader2, ShieldCheck, UserRound, X } from 'lucide-react';
import StoryVisual from './StoryVisuals.jsx';
import './pipeline.css';

// What each stage does, in one or two plain sentences.
const WHAT = {
  hazard: 'We check every uploaded row: location, building type, value and flood scores. Bad rows stop the run instead of being guessed.',
  quality: 'We turn each location\'s flood scores into a water depth for five flood sizes, from a common 1-in-10 year flood to a rare 1-in-250.',
  vulnerability: 'We estimate how much of a building\'s value is lost at each water depth, depending on how it is built.',
  exposure: 'We match flood depth and building damage to the confirmed properties and their insured values.',
  loss: 'For every building and flood size: depth → damage ratio → × insured value = ground-up loss. Policy terms give the gross loss, reinsurance gives the net. Adding buildings up per flood size gives the EP curve.',
  intelligence: 'We look for concentrated risk and anything unusual, and flag what you should check.',
  review: 'You review the results and assumptions, then approve them or send them back.',
  publish: 'Once approved, results go to the map and reports. Unapproved runs stay drafts.',
};

const STATE_LABEL = { complete: 'Done', running: 'Working…', review: 'Your decision', waiting: 'Waiting', failed: 'Stopped' };

function StateIcon({ state }) {
  if (state === 'complete') return <Check size={14}/>;
  if (state === 'running') return <Loader2 size={14} className="spin"/>;
  if (state === 'review') return <UserRound size={14}/>;
  if (state === 'failed') return <X size={14}/>;
  return <Clock3 size={13}/>;
}

function StagePanel({ node, index, total, state, stage, loading, runId, runStatus, awaitingApproval, busy, onDecide, onSelect, nodes, onOpenDetails, error }) {
  const done = state === 'complete' || (node.id === 'review' && state === 'review');
  return <aside className="pl-panel" key={node.id} aria-live="polite">
    <div className="pl-panel-head"><span>STEP {index + 1} OF {total}</span><em className={state}><StateIcon state={state}/>{STATE_LABEL[state]}</em></div>
    <h3>{node.title}</h3>
    <p className="pl-what">{WHAT[node.id]}</p>
    <section className="pl-result">
      <h4>Result</h4>
      {state === 'failed' ? <p className="pl-error"><AlertTriangle size={14}/> {error || 'This stage stopped the run.'}</p>
        : !done ? <p className="pl-muted">{state === 'running' ? 'Working on this stage…' : 'Not reached yet.'}</p>
        : node.id === 'publish' ? <p>{runStatus === 'approved' ? 'Approved. Results are on the map and in reports.' : 'Waiting for your approval.'}</p>
        : !stage ? <p className="pl-muted">{loading ? <><Loader2 size={13} className="spin"/> Loading results…</> : runId ? 'No results for this stage.' : 'Calculate the portfolio to see results.'}</p>
        : <>
          {stage.result && <p className="pl-sentence">{stage.result}</p>}
          {stage.figures?.length > 0 && <dl className="pl-figures">{stage.figures.map((figure) => <div key={figure.label} className={figure.status || ''}><dt>{figure.label}</dt><dd>{figure.status === 'pass' && <Check size={13}/>}{figure.status === 'warn' && <AlertTriangle size={13}/>}{figure.value}</dd></div>)}</dl>}
          {stage.flags && (stage.flags.length ? <ul className="pl-flags">{stage.flags.map((flag) => <li key={flag.id}><AlertTriangle size={13}/>{flag.text}</li>)}</ul> : <p className="pl-ok"><Check size={14}/> Nothing unusual to flag.</p>)}
          {stage.visual && <div className="pl-visual"><StoryVisual visual={stage.visual}/></div>}
        </>}
    </section>
    {node.id === 'review' && awaitingApproval && <div className="pl-decision"><ShieldCheck size={17}/><strong>Approve these results?</strong><div><button type="button" disabled={busy} onClick={() => onDecide('return')}>Send back</button><button type="button" className="primary" disabled={busy} onClick={() => onDecide('approve')}><Check size={14}/> Approve</button></div></div>}
    <footer>
      <div className="pl-nav"><button type="button" disabled={index === 0} onClick={() => onSelect(nodes[index - 1].id)}><ChevronLeft size={14}/> Back</button><button type="button" disabled={index === total - 1} onClick={() => onSelect(nodes[index + 1].id)}>Next <ChevronRight size={14}/></button></div>
      {runId && done && node.id !== 'publish' && <button type="button" className="pl-details" onClick={() => onOpenDetails(node.id)}>All figures and downloads</button>}
    </footer>
  </aside>;
}

export default function Pipeline({ nodes, stateOf, selectedId, onSelect, story, ...panel }) {
  const index = Math.max(0, nodes.findIndex((node) => node.id === selectedId));
  return <div className="pl-layout">
    <ol className="pl-flow">
      {nodes.map((node) => {
        const state = stateOf(node.id);
        const Icon = node.icon;
        const short = state === 'complete' || state === 'review' ? story?.stages?.[node.id]?.short : null;
        return <li key={node.id} className={`${state} ${selectedId === node.id ? 'selected' : ''}`}>
          <button type="button" onClick={() => onSelect(node.id)} aria-current={selectedId === node.id ? 'step' : undefined}>
            <span className="pl-dot"><StateIcon state={state}/></span>
            <span className="pl-icon"><Icon size={16}/></span>
            <span className="pl-text"><strong>{node.title}</strong><small>{short || (state === 'running' ? 'Working…' : node.subtitle)}</small></span>
            {state === 'running' && <span className="pl-progress" aria-hidden="true"/>}
          </button>
        </li>;
      })}
    </ol>
    <StagePanel node={nodes[index]} index={index} total={nodes.length} state={stateOf(nodes[index].id)} stage={story?.stages?.[nodes[index].id]} nodes={nodes} onSelect={onSelect} {...panel}/>
  </div>;
}
