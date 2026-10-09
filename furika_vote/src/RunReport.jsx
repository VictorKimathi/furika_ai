import React, { useEffect, useState } from 'react';
import { Download, FileText, Mail } from 'lucide-react';
import { apiGet, apiRequest } from './api.js';
import { Chart } from './StageMetrics.jsx';
import { kes, pct } from './runStory.js';
import './run-report.css';

const STAGE_ORDER = ['ingestion', 'hazard', 'vulnerability', 'exposure', 'financial', 'ai', 'portfolio', 'trust'];
const metric = (report, id) => Object.values(report.stages).flatMap((stage) => stage.metrics).find((item) => item.id === id);

function MetricTile({ item }) {
  return <div className="rr-metric-tile"><span>{item.label}</span><strong>{item.display || 'Not measured'}</strong><small>{item.tag}</small></div>;
}

function StageCard({ stage }) {
  const headline = stage.metrics.find((item) => item.id === stage.headline);
  const visualMetrics = stage.metrics.filter((item) => item.chart && item.priority !== 'P3').slice(0, 2);
  const supporting = stage.metrics.filter((item) => item.value != null && item.id !== stage.headline).slice(0, 4);
  return <section className="rr-stage-card">
    <header><span>{stage.title}</span>{headline && <strong>{headline.display}</strong>}</header>
    {headline && <MetricTile item={headline}/>} 
    {visualMetrics.map((item) => <div className="rr-stage-visual" key={item.id}><div className="rr-visual-label"><span>{item.label}</span><small>{item.display}</small></div><Chart chart={item.chart}/></div>)}
    {supporting.length > 0 && <div className="rr-supporting-metrics">{supporting.map((item) => <MetricTile key={item.id} item={item}/>)}</div>}
    <details><summary>View stage checks</summary><div className="rr-stage-checks">{stage.metrics.map((item) => <div key={item.id}><b>{item.id}</b><span>{item.label}</span><strong>{item.display || 'Not measured'}</strong></div>)}</div></details>
  </section>;
}

function downloadJson(report) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `furika-model-report-${report.runId}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function RunReport({ runId, approved }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [pdfError, setPdfError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailError, setMailError] = useState('');
  useEffect(() => {
    if (!runId || !approved) return undefined;
    let active = true;
    setReport(null); setError('');
    apiGet(`/model-runs/${encodeURIComponent(runId)}/report`)
      .then((value) => { if (active) setReport(value); })
      .catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [runId, approved]);

  if (!approved) return <div className="rr-empty">Approve the model run to publish its report.</div>;
  if (error) return <div className="rr-empty" role="alert">Report unavailable: {error}</div>;
  if (!report) return <div className="rr-empty">Preparing approved report…</div>;

  const ep = metric(report, 'FIN-14');
  const finance = report.financial;
  const summary = report.summary;
  const assumptions = metric(report, 'FIN-21')?.table?.rows || [];
  const downloadPdf = async () => {
    setPdfBusy(true); setPdfError('');
    try { const { downloadRunReportPdf } = await import('./runReportPdf.js'); downloadRunReportPdf(report); }
    catch (failure) { setPdfError(failure.message || 'Could not create PDF report.'); }
    finally { setPdfBusy(false); }
  };
  const emailOwner = async () => {
    setMailBusy(true); setMailError('');
    try {
      const result = await apiRequest(`/model-runs/${encodeURIComponent(runId)}/report/email`, { method: 'POST' });
      setReport((current) => ({ ...current, emailDelivery: result.reportDelivery }));
    } catch (failure) { setMailError(failure.message || 'Could not email the report.'); }
    finally { setMailBusy(false); }
  };
  const delivery = report.emailDelivery;
  const epChart = metric(report, 'FIN-04')?.chart || ep?.chart;
  return <article className="rr-report">
    <header className="rr-header"><div><span>APPROVED MODEL REPORT · {report.runId}</span><h1>Nairobi flood portfolio</h1><p>{report.portfolioId} · {summary.propertyCount?.toLocaleString('en-KE') ?? '—'} modelled properties · synthetic/redacted exposure</p></div><div className="rr-actions"><button type="button" disabled={pdfBusy} onClick={downloadPdf}><FileText size={15}/> {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}</button><button type="button" onClick={() => downloadJson(report)}><Download size={15}/> Download data</button>{pdfError && <small role="alert">{pdfError}</small>}</div></header>
    <div className={`rr-email-status ${delivery?.status || 'pending'}`} role="status"><Mail size={16}/><span>{delivery?.status === 'sent' ? `Report emailed to ${delivery.recipient}.` : delivery?.status === 'failed' ? `Email to ${delivery.recipient} failed. The approved report is still available here.` : delivery?.status === 'not_configured' ? 'Email delivery is not configured. Set SMTP settings and retry.' : 'This approved report has not been emailed yet.'}</span>{delivery?.status !== 'sent' && <button type="button" onClick={emailOwner} disabled={mailBusy}>{mailBusy ? 'Sending…' : 'Email owner'}</button>}{mailError && <small role="alert">{mailError}</small>}</div>
    <section className="rr-card"><h2>Executive results</h2><div className="rr-kpis"><div><span>Total insured value</span><strong>{kes(summary.totalTivKes)}</strong></div><div><span>Central ground-up AAL</span><strong>{kes(finance.aalRangeKes.central)}</strong><small>Range {kes(finance.aalRangeKes.low)}–{kes(finance.aalRangeKes.high)}</small></div><div><span>1-in-100 ground-up loss</span><strong>{kes(report.epCurve.find((row) => row.returnPeriodYears === 100)?.groundUpKes)}</strong><small>{pct(finance.lossRatio100, 1)} of insured value</small></div><div><span>1-in-100 net loss</span><strong>{kes(report.epCurve.find((row) => row.returnPeriodYears === 100)?.netKes)}</strong><small>Illustrative assumed terms</small></div></div></section>
    <section className="rr-card rr-ep-card"><div className="rr-card-heading"><div><span className="rr-kicker">LOSS AGAINST RARITY</span><h2>Exceedance probability curve</h2></div><small>Assumed return periods</small></div>{epChart && <Chart chart={epChart}/>} 
      <div className="rr-scroll"><table><thead><tr><th>Return period</th><th>Annual chance</th><th>Ground-up</th><th>Gross after policy</th><th>Net after reinsurance</th></tr></thead><tbody>{report.epCurve.map((row) => <tr key={row.returnPeriodYears}><td>1 in {row.returnPeriodYears}</td><td>{pct(row.annualExceedanceProbability, row.returnPeriodYears >= 100 ? 1 : 0)}</td><td>{kes(row.groundUpKes)}</td><td>{kes(row.grossKes)}</td><td>{kes(row.netKes)}</td></tr>)}</tbody></table></div>
      <p className="rr-note">Loss increases with return period. Return-period assignments are assumptions, not observed flood frequencies.</p></section>
    <section className="rr-card"><h2>Financial engine</h2><div className="rr-kpis"><div><span>1-in-250 ground-up loss</span><strong>{kes(report.epCurve.find((row) => row.returnPeriodYears === 250)?.groundUpKes)}</strong></div><div><span>Properties flooded, rarest scenario</span><strong>{finance.affectedProperties250 ?? '—'}</strong></div>{Object.entries(finance.aalByLayerKes || {}).map(([layer, value]) => <div key={layer}><span>{layer.replaceAll('_', ' ')} AAL</span><strong>{kes(value)}</strong></div>)}</div>
      <p>Damage ratio × insured value gives ground-up loss. Building deductibles and limits give gross insured loss; assumed reinsurance terms give net retained loss.</p>
      <div className="rr-scroll"><table><thead><tr><th>Flood</th><th>Ground-up</th><th>Owners keep</th><th>Above limit</th><th>Gross</th><th>Quota share</th><th>Cat XL</th><th>Net</th></tr></thead><tbody>{finance.lossWaterfall.map((row) => <tr key={row.rp}><td>1 in {row.rp}</td><td>{kes(row.groundUpKes)}</td><td>{kes(row.ownerKeepsKes)}</td><td>{kes(row.aboveLimitKes)}</td><td>{kes(row.grossKes)}</td><td>{kes(row.quotaShareKes)}</td><td>{kes(row.catXlKes)}</td><td>{kes(row.netKes)}</td></tr>)}</tbody></table></div></section>
    <section className="rr-card"><div className="rr-card-heading"><div><span className="rr-kicker">MODEL OUTPUTS</span><h2>Metrics by stage</h2></div><small>Charts first, checks on demand</small></div><div className="rr-stages">{STAGE_ORDER.map((key) => { const stage = report.stages[key]; return stage ? <StageCard key={key} stage={stage}/> : null; })}</div></section>
    <section className="rr-card"><h2>Assumptions and limits</h2><div className="rr-scroll"><table><tbody>{assumptions.map(([name, value]) => <tr key={name}><th>{name}</th><td>{value}</td></tr>)}</tbody></table></div><ul>{report.limitations.map((text) => <li key={text}>{text}</li>)}</ul><p className="rr-note">{report.note} This prototype is for decision support, not observed flood or claims validation.</p></section>
  </article>;
}
