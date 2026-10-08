import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, ChevronLeft, ChevronRight, CircleX, Download, FileJson, FileSpreadsheet, ImageDown, Loader2, Send, Table2, X } from 'lucide-react';
import FormattedText from './FormattedText.jsx';
import { PORTFOLIO_ID, apiRequest } from './api.js';
import './stage-metrics.css';

// Workflow node -> metrics catalogue stage.
export const NODE_STAGE = { hazard: 'ingestion', quality: 'hazard', vulnerability: 'vulnerability', exposure: 'exposure', loss: 'financial', intelligence: 'ai', review: 'trust', publish: 'portfolio' };

// Validated palettes (dataviz validator, light surface): categorical slots 1-3 pass all-pairs; ordinal blue ramp passes.
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const ORDINAL = ['#86b6ef', '#6da7ec', '#5598e7', '#2a78d6', '#1c5cab', '#184f95', '#0d366b'];
const SEQUENTIAL = ['#eef4fc', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const STATUS_COLORS = { error: '#d03b3b', review: '#ec835a', warning: '#fab219', info: '#8a94a0' };
const CLASS_ORDER = ['informal_iron_sheet', 'semi_permanent', 'permanent_masonry'];
const STATUS_META = { pass: [CheckCircle2, 'Pass'], warn: [AlertTriangle, 'Check'], fail: [CircleX, 'Fail'] };
const PRIORITY_TITLE = { P1: 'Headline', P2: 'Supporting', P3: 'Details' };
const W = 560;

function seriesColors(chart) {
  const names = (chart.series || []).map((series) => series.name);
  if (chart.palette === 'status') return names.map((name) => STATUS_COLORS[name] || '#8a94a0');
  if (chart.palette === 'class') return names.map((name) => CATEGORICAL[Math.max(CLASS_ORDER.indexOf(name), 0)]);
  if (chart.palette === 'ordinal' && names.length > 1) return names.map((_, index) => ORDINAL[Math.round(index * (ORDINAL.length - 1) / Math.max(names.length - 1, 1))]);
  return names.map((_, index) => CATEGORICAL[index % CATEGORICAL.length]);
}

function categoryColors(chart, count) {
  if (chart.palette !== 'ordinal') return null;
  return Array.from({ length: count }, (_, index) => ORDINAL[Math.round(index * (ORDINAL.length - 1) / Math.max(count - 1, 1))]);
}

const fmt = (value, unit) => {
  if (value == null || Number.isNaN(value)) return '–';
  const abs = Math.abs(value);
  const text = Number.isInteger(value) || abs >= 100 ? Math.round(value).toLocaleString('en-KE') : abs >= 10 ? value.toFixed(1) : abs >= 1 ? value.toFixed(2) : abs === 0 ? '0' : value.toPrecision(2);
  return unit === '%' ? `${text}%` : unit && unit !== 'ratio' ? `${text} ${unit}` : text;
};
// Axis ticks and direct labels: compact numbers; only % stays inline, other units go in the axis caption.
const short = (value, unit) => fmt(value, unit === '%' ? '%' : null);
const unitCaption = (unit) => (unit && unit !== '%' ? unit : null);

function CategoryLabel({ x, y, text }) {
  const [first, ...rest] = String(text).split(' (');
  const second = rest.length ? `(${rest.join(' (')}` : null;
  const clip = (value) => (value.length > 16 ? `${value.slice(0, 15)}…` : value);
  return <text x={x} y={y} className="sm-label" textAnchor="middle"><tspan x={x} dy="0">{clip(first)}</tspan>{second && <tspan x={x} dy="12" className="sm-sublabel">{clip(second)}</tspan>}</text>;
}

const niceMax = (value) => {
  if (!value || value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((step) => step * power).find((step) => step >= value) || value;
};

function useTooltip() {
  const [tip, setTip] = useState(null);
  const show = (event, text) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect() || event.currentTarget.getBoundingClientRect();
    setTip({ x: event.clientX - box.left, y: event.clientY - box.top, text });
  };
  return [tip, show, () => setTip(null)];
}

function Tooltip({ tip }) {
  if (!tip) return null;
  return <div className="sm-tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text.split('\n').map((line, index) => <span key={index}>{line}</span>)}</div>;
}

function Legend({ names, colors }) {
  if (names.length < 2) return null;
  return <div className="sm-legend">{names.map((name, index) => <span key={name}><i style={{ background: colors[index] }}/>{name}</span>)}</div>;
}

function BarChart({ chart, stacked }) {
  const [tip, show, hide] = useTooltip();
  const categories = chart.categories || [];
  const series = chart.series || [];
  const colors = seriesColors(chart);
  const perCategory = categoryColors(chart, categories.length);
  const horizontal = !!chart.horizontal;
  const totals = categories.map((_, index) => stacked ? series.reduce((sum, s) => sum + (s.values[index] || 0), 0) : Math.max(...series.map((s) => s.values[index] || 0)));
  const max = chart.max || niceMax(Math.max(...totals, 0));
  const directLabels = series.length === 1 && categories.length <= 8;
  if (horizontal) {
    const rowH = 22, labelW = 150, height = categories.length * rowH + 24;
    const plotW = W - labelW - 60;
    return <div className="sm-chart"><svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={chart.series?.[0]?.name}>
      {[0, 0.5, 1].map((t) => <g key={t}><line x1={labelW + t * plotW} x2={labelW + t * plotW} y1={4} y2={height - 18} className="sm-grid"/><text x={labelW + t * plotW} y={height - 4} className="sm-axis" textAnchor="middle">{short(t * max, chart.unit)}</text></g>)}
      {unitCaption(chart.unit) && <text x={W - 2} y={height - 4} className="sm-axis-title" textAnchor="end">{unitCaption(chart.unit)}</text>}
      {categories.map((category, ci) => {
        let offset = 0;
        const y = 6 + ci * rowH;
        return <g key={category}><text x={labelW - 6} y={y + 11} className="sm-label" textAnchor="end">{String(category).slice(0, 24)}</text>
          {series.map((s, si) => {
            const value = s.values[ci] || 0;
            const w = Math.max(0, value / max * plotW);
            const barH = stacked ? 14 : 14 / series.length;
            const x = labelW + (stacked ? offset : 0);
            const yy = stacked ? y : y + si * barH;
            if (stacked) offset += w;
            return w > 0 && <rect key={s.name} x={x} y={yy} width={Math.max(w - (stacked ? 2 : 0), 1)} height={barH - (stacked ? 0 : 1)} rx={2} fill={perCategory?.[ci] || colors[si]} onMouseMove={(event) => show(event, `${category}\n${s.name}: ${fmt(value, chart.unit)}`)} onMouseLeave={hide}/>;
          })}
          {directLabels && <text x={labelW + (series[0].values[ci] || 0) / max * plotW + 4} y={y + 11} className="sm-value">{short(series[0].values[ci], chart.unit)}</text>}
        </g>;
      })}
    </svg><Tooltip tip={tip}/><Legend names={series.map((s) => s.name)} colors={colors}/></div>;
  }
  const height = 214, padL = 40, padB = 40, plotH = height - padB - 22, plotW = W - padL - 10;
  const band = plotW / Math.max(categories.length, 1);
  const groupW = band * 0.7;
  return <div className="sm-chart"><svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={chart.series?.[0]?.name}>
    {unitCaption(chart.unit) && <text x={2} y={8} className="sm-axis-title">{unitCaption(chart.unit)}</text>}
    {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={padL} x2={W - 10} y1={22 + plotH * (1 - t)} y2={22 + plotH * (1 - t)} className="sm-grid"/><text x={padL - 6} y={26 + plotH * (1 - t)} className="sm-axis" textAnchor="end">{short(t * max, chart.unit)}</text></g>)}
    {categories.map((category, ci) => {
      const x0 = padL + ci * band + (band - groupW) / 2;
      let stackTop = 0;
      return <g key={category}>
        {series.map((s, si) => {
          const value = s.values[ci] || 0;
          const h = value / max * plotH;
          const barW = stacked ? groupW : groupW / series.length;
          const x = stacked ? x0 : x0 + si * barW;
          const y = 22 + plotH - (stacked ? stackTop + h : h);
          if (stacked) stackTop += h;
          return h > 0 && <rect key={s.name} x={x + (stacked ? 0 : 1)} y={y} width={Math.max(barW - (stacked ? 0 : 2), 1)} height={Math.max(h - (stacked ? 2 : 0), 1)} rx={3} fill={perCategory?.[ci] || colors[si]} onMouseMove={(event) => show(event, `${category}\n${s.name}: ${fmt(value, chart.unit)}`)} onMouseLeave={hide}/>;
        })}
        {directLabels && <text x={x0 + groupW / 2} y={22 + plotH - (series[0].values[ci] || 0) / max * plotH - 4} className="sm-value" textAnchor="middle">{short(series[0].values[ci], chart.unit)}</text>}
        <CategoryLabel x={x0 + groupW / 2} y={height - padB + 16} text={category}/>
      </g>;
    })}
  </svg><Tooltip tip={tip}/><Legend names={series.map((s) => s.name)} colors={colors}/></div>;
}

function LineChart({ chart }) {
  const [tip, show, hide] = useTooltip();
  const xs = chart.x || [];
  const series = chart.series || [];
  const colors = seriesColors(chart);
  const height = 214, padL = 44, padB = 40, plotH = height - padB - 22, plotW = W - padL - 14;
  const numeric = xs.every((x) => typeof x === 'number');
  const xv = xs.map((x, index) => numeric ? (chart.logX ? Math.log(Math.max(x, 1)) : x) : index);
  const minX = Math.min(...xv), maxX = Math.max(...xv);
  const max = niceMax(Math.max(...series.flatMap((s) => s.values.filter((v) => v != null)), 0));
  const px = (index) => padL + (maxX === minX ? 0 : (xv[index] - minX) / (maxX - minX)) * plotW;
  const py = (value) => 22 + plotH - (value || 0) / max * plotH;
  const [hover, setHover] = useState(null);
  const onMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const svgX = (event.clientX - box.left) / box.width * W;
    let nearest = 0;
    xs.forEach((_, index) => { if (Math.abs(px(index) - svgX) < Math.abs(px(nearest) - svgX)) nearest = index; });
    setHover(nearest);
    show({ currentTarget: event.currentTarget, clientX: event.clientX, clientY: event.clientY }, [`${chart.xLabel || 'x'}: ${xs[nearest]}`, ...series.map((s) => `${s.name}: ${fmt(s.values[nearest], chart.unit)}`)].join('\n'));
  };
  const ticks = numeric && chart.logX ? xs.filter((x) => [1, 10, 25, 50, 100, 250].includes(x)) : xs.filter((_, index) => xs.length <= 8 || index % Math.ceil(xs.length / 8) === 0);
  return <div className="sm-chart"><svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={chart.yLabel} onMouseMove={onMove} onMouseLeave={() => { setHover(null); hide(); }}>
    {unitCaption(chart.unit) && <text x={2} y={6} className="sm-axis-title">{chart.yLabel || unitCaption(chart.unit)}</text>}
    {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={padL} x2={W - 14} y1={py(t * max)} y2={py(t * max)} className="sm-grid"/><text x={padL - 6} y={py(t * max) + 4} className="sm-axis" textAnchor="end">{short(t * max, chart.unit)}</text></g>)}
    {ticks.map((x) => { const index = xs.indexOf(x); return <text key={`${x}-${index}`} x={px(index)} y={height - padB + 14} className="sm-axis" textAnchor="middle">{x}</text>; })}
    {chart.xLabel && <text x={padL + plotW / 2} y={height - 6} className="sm-axis-title" textAnchor="middle">{chart.xLabel}</text>}
    {series.map((s, si) => <polyline key={s.name} fill="none" stroke={colors[si]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={s.values.map((value, index) => `${px(index)},${py(value)}`).join(' ')}/>)}
    {hover != null && <line x1={px(hover)} x2={px(hover)} y1={22} y2={22 + plotH} className="sm-crosshair"/>}
    {hover != null && series.map((s, si) => <circle key={s.name} cx={px(hover)} cy={py(s.values[hover])} r="4" fill={colors[si]} stroke="#fff" strokeWidth="2"/>)}
  </svg><Tooltip tip={tip}/><Legend names={series.map((s) => s.name)} colors={colors}/></div>;
}

function Heatmap({ chart }) {
  const [tip, show, hide] = useTooltip();
  const rows = chart.rows || [], cols = chart.cols || [], values = chart.values || [];
  const max = Math.max(...values.flat().filter((v) => v != null), 0) || 1;
  const labelW = 150, cellH = 26, cellW = (W - labelW - 6) / Math.max(cols.length, 1), height = rows.length * cellH + 26;
  return <div className="sm-chart"><svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="heatmap">
    {cols.map((col, ci) => <text key={col} x={labelW + ci * cellW + cellW / 2} y={14} className="sm-axis" textAnchor="middle">{col}</text>)}
    {rows.map((row, ri) => <g key={row}><text x={labelW - 6} y={22 + ri * cellH + cellH / 2} className="sm-label" textAnchor="end">{String(row).slice(0, 24)}</text>
      {cols.map((col, ci) => {
        const value = values[ri]?.[ci];
        const step = value == null ? 0 : Math.min(SEQUENTIAL.length - 1, Math.round(value / max * (SEQUENTIAL.length - 1)));
        return <g key={col} onMouseMove={(event) => show(event, `${row} · ${col}\n${fmt(value, chart.unit)}`)} onMouseLeave={hide}>
          <rect x={labelW + ci * cellW + 1} y={20 + ri * cellH + 1} width={cellW - 2} height={cellH - 2} rx={3} fill={SEQUENTIAL[step]}/>
          <text x={labelW + ci * cellW + cellW / 2} y={20 + ri * cellH + cellH / 2 + 4} className={step >= 4 ? 'sm-cell light' : 'sm-cell'} textAnchor="middle">{short(value, chart.unit)}</text>
        </g>;
      })}</g>)}
  </svg><Tooltip tip={tip}/></div>;
}

function TornadoPanel({ params, panel, unit, show, hide }) {
  const { low: lo, high: hi, base = 0, measure } = panel;
  const span = Math.max(...params.map((_, index) => Math.max(Math.abs(base - lo[index]), Math.abs(hi[index] - base))), 1e-9);
  const labelW = 150, rowH = 28, plotW = W - labelW - 20, centre = labelW + plotW / 2, height = params.length * rowH + 30;
  const x = (value) => centre + (value - base) / span * (plotW / 2);
  return <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`sensitivity of ${measure}`}>
    <line x1={centre} x2={centre} y1={4} y2={height - 20} className="sm-crosshair"/>
    <text x={centre} y={height - 6} className="sm-axis" textAnchor="middle">{measure}: base {fmt(base, unit)}</text>
    {params.map((param, index) => { const y = 6 + index * rowH; const flat = Math.abs(hi[index] - lo[index]) < 1e-9; return <g key={param}>
      <text x={labelW - 8} y={y + 15} className="sm-label" textAnchor="end">{param}</text>
      {flat ? <text x={centre + 6} y={y + 15} className="sm-axis">no change</text> : <>
        <rect x={Math.min(x(lo[index]), centre)} y={y + 4} width={Math.max(Math.abs(centre - x(lo[index])), 1)} height={16} rx={3} fill={CATEGORICAL[0]} onMouseMove={(event) => show(event, `${param}\n${measure} at low setting: ${fmt(lo[index], unit)}`)} onMouseLeave={hide}/>
        <rect x={Math.min(x(hi[index]), centre)} y={y + 4} width={Math.max(Math.abs(x(hi[index]) - centre), 1)} height={16} rx={3} fill={CATEGORICAL[7]} onMouseMove={(event) => show(event, `${param}\n${measure} at high setting: ${fmt(hi[index], unit)}`)} onMouseLeave={hide}/>
      </>}
    </g>; })}
  </svg>;
}

function Tornado({ chart }) {
  const [tip, show, hide] = useTooltip();
  const panels = chart.panels || [{ measure: chart.measure, low: chart.low, high: chart.high, base: chart.base }];
  return <div className="sm-chart sm-tornado">{panels.map((panel) => <TornadoPanel key={panel.measure} params={chart.params || []} panel={panel} unit={chart.unit} show={show} hide={hide}/>)}<Tooltip tip={tip}/><Legend names={['low setting', 'high setting']} colors={[CATEGORICAL[0], CATEGORICAL[7]]}/></div>;
}

function Scatter({ chart }) {
  const [tip, show, hide] = useTooltip();
  const points = chart.points || [];
  const height = 230, padL = 56, padB = 40, plotH = height - padB - 10, plotW = W - padL - 16;
  const maxX = niceMax(Math.max(...points.map((p) => p.x || 0), 0));
  const maxY = niceMax(Math.max(...points.map((p) => p.y || 0), 0));
  const maxS = Math.max(...points.map((p) => p.size || 0), 1);
  return <div className="sm-chart"><svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="scatter">
    {[0, 0.5, 1].map((t) => <g key={t}><line x1={padL} x2={W - 16} y1={10 + plotH * (1 - t)} y2={10 + plotH * (1 - t)} className="sm-grid"/><text x={padL - 6} y={14 + plotH * (1 - t)} className="sm-axis" textAnchor="end">{fmt(t * maxY)}</text><text x={padL + t * plotW} y={height - padB + 14} className="sm-axis" textAnchor="middle">{fmt(t * maxX, '%')}</text></g>)}
    <text x={padL + plotW / 2} y={height - 6} className="sm-axis-title" textAnchor="middle">{chart.xLabel} · size = {chart.sizeLabel}</text>
    {points.map((p) => <circle key={p.label} cx={padL + (p.x || 0) / maxX * plotW} cy={10 + plotH - (p.y || 0) / maxY * plotH} r={5 + 14 * Math.sqrt((p.size || 0) / maxS)} fill={CATEGORICAL[0]} fillOpacity=".55" stroke="#fff" strokeWidth="2" onMouseMove={(event) => show(event, `${p.label}\nflood probability ${fmt(p.x, '%')}\nTIV ${fmt(p.y, 'KES m')}\n1 in 100 loss ${fmt(p.size, 'KES m')}`)} onMouseLeave={hide}/>)}
  </svg><Tooltip tip={tip}/></div>;
}

function Chart({ chart }) {
  if (chart.type === 'bar') return <BarChart chart={chart}/>;
  if (chart.type === 'stacked') return <BarChart chart={chart} stacked/>;
  if (chart.type === 'line') return <LineChart chart={chart}/>;
  if (chart.type === 'heatmap') return <Heatmap chart={chart}/>;
  if (chart.type === 'tornado') return <Tornado chart={chart}/>;
  if (chart.type === 'scatter') return <Scatter chart={chart}/>;
  return null;
}

// ---------- export helpers ----------

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const toCsv = (rows) => rows.map((row) => row.map(csvCell).join(',')).join('\n');

function chartRows(chart) {
  if (!chart) return null;
  if (chart.type === 'bar' || chart.type === 'stacked') return [['category', ...chart.series.map((s) => s.name)], ...chart.categories.map((category, index) => [category, ...chart.series.map((s) => s.values[index])])];
  if (chart.type === 'line') return [[chart.xLabel || 'x', ...chart.series.map((s) => s.name)], ...chart.x.map((x, index) => [x, ...chart.series.map((s) => s.values[index])])];
  if (chart.type === 'heatmap') return [['', ...chart.cols], ...chart.rows.map((row, index) => [row, ...chart.values[index]])];
  if (chart.type === 'tornado') {
    const panels = chart.panels || [{ measure: 'value', low: chart.low, high: chart.high, base: chart.base }];
    return [['parameter', ...panels.flatMap((panel) => [`${panel.measure} low`, `${panel.measure} high`, `${panel.measure} base`])], ...chart.params.map((param, index) => [param, ...panels.flatMap((panel) => [panel.low[index], panel.high[index], panel.base])])];
  }
  if (chart.type === 'scatter') return [['cluster', chart.xLabel, chart.yLabel, chart.sizeLabel], ...chart.points.map((p) => [p.label, p.x, p.y, p.size])];
  return null;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PNG_STYLE = '.sm-grid{stroke:#e3e8ee;stroke-width:1}.sm-crosshair{stroke:#041d3b;stroke-width:1;stroke-dasharray:3 3}text{font-family:Inter,Arial,sans-serif;fill:#3d4f63}.sm-axis,.sm-axis-title,.sm-sublabel{font-size:10px;fill:#6b7a8b}.sm-label{font-size:10.5px}.sm-value{font-size:10px;font-weight:600;fill:#041d3b}.sm-cell{font-size:10px;fill:#041d3b}.sm-cell.light{fill:#fff}';

function svgImage(svg) {
  const clone = svg.cloneNode(true);
  const box = svg.viewBox.baseVal;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', box.width);
  clone.setAttribute('height', box.height);
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = PNG_STYLE;
  clone.insertBefore(style, clone.firstChild);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, width: box.width, height: box.height });
    image.onerror = reject;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  });
}

// Every chart panel in the card, stacked under a title, on a white background, at 2x.
async function exportPng(svgs, filename, title) {
  const images = await Promise.all([...svgs].map(svgImage));
  const scale = 2, header = 28, gap = 10;
  const width = Math.max(...images.map((item) => item.width));
  const height = header + images.reduce((sum, item) => sum + item.height + gap, 0);
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#041d3b';
  context.font = '600 13px Inter, Arial, sans-serif';
  context.fillText(title, 8, 18);
  let y = header;
  for (const item of images) {
    context.drawImage(item.image, 0, y, item.width, item.height);
    y += item.height + gap;
  }
  canvas.toBlob((blob) => blob && download(blob, filename), 'image/png');
}

// ---------- cards ----------

function MetricCard({ metric, runId }) {
  const [showTable, setShowTable] = useState(false);
  const chartRef = useRef(null);
  const [StatusIcon, statusLabel] = STATUS_META[metric.status] || [];
  const rows = chartRows(metric.chart);
  const base = `${runId}-${metric.id}`;
  const exportCsv = () => {
    const table = metric.table ? [metric.table.columns, ...metric.table.rows] : rows;
    if (table) download(new Blob([toCsv(table)], { type: 'text/csv' }), `${base}.csv`);
  };
  return <article className={`sm-card ${metric.priority.toLowerCase()} ${metric.value == null && !metric.chart && !metric.table ? 'unmeasured' : ''}`}>
    <header>
      <div><span className="sm-id">{metric.id}</span><strong>{metric.label}</strong></div>
      <div className="sm-badges"><span className={`sm-tag tag-${metric.tag.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{metric.tag}</span><span className="sm-priority">{metric.priority}</span></div>
    </header>
    <div className="sm-headline"><span className="sm-display">{metric.display}</span>{StatusIcon && <span className={`sm-status ${metric.status}`}><StatusIcon size={13}/>{statusLabel}</span>}</div>
    {metric.plain && <p className="sm-plain">{metric.plain}</p>}
    {metric.note && <p className="sm-note">{metric.note}</p>}
    {metric.chart && <div ref={chartRef}><Chart chart={metric.chart}/></div>}
    {metric.table && (showTable || !metric.chart) && <div className="sm-table-wrap"><table className="sm-table"><thead><tr>{metric.table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{metric.table.rows.map((row, index) => <tr key={index}>{row.map((cell, ci) => <td key={ci} className={cell === 'pass' ? 'pass' : cell === 'fail' ? 'fail' : cell === 'warn' ? 'warn' : undefined}>{cell}</td>)}</tr>)}</tbody></table></div>}
    {(metric.chart || metric.table) && <footer>
      {metric.chart && <button onClick={() => { const svgs = chartRef.current?.querySelectorAll('svg'); if (svgs?.length) exportPng(svgs, `${base}.png`, `${metric.id} ${metric.label}`); }}><ImageDown size={13}/> PNG</button>}
      <button onClick={exportCsv}><FileSpreadsheet size={13}/> CSV</button>
      {metric.chart && rows && <button className={showTable ? 'active' : ''} onClick={() => setShowTable(!showTable)}><Table2 size={13}/> {showTable ? 'Hide table' : 'Table'}</button>}
    </footer>}
    {metric.chart && rows && showTable && !metric.table && <div className="sm-table-wrap"><table className="sm-table"><thead><tr>{rows[0].map((column, index) => <th key={index}>{column}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, index) => <tr key={index}>{row.map((cell, ci) => <td key={ci}>{typeof cell === 'number' ? fmt(cell) : cell}</td>)}</tr>)}</tbody></table></div>}
  </article>;
}

function StageAgent({ runId, stageKey, stageTitle }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const thread = useRef(null);
  useEffect(() => { setMessages([]); }, [stageKey, runId]);
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);
  const ask = async (text = input) => {
    const question = text.trim();
    if (!question || busy) return;
    setInput('');
    setMessages((current) => [...current, { role: 'user', content: question }]);
    setBusy(true);
    try {
      const data = await apiRequest('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question, mode: 'analysis', context: { portfolioId: PORTFOLIO_ID, uploadIds: [], runId, stage: stageKey } }) });
      setMessages((current) => [...current, { role: 'assistant', content: data.answer, model: data.provider !== 'none' ? `${data.provider} · ${data.model}` : 'data-only summary' }]);
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', content: error.message, model: 'error' }]);
    } finally { setBusy(false); }
  };
  return <section className="sm-agent">
    <header><Bot size={15}/><strong>Ask the agent about {stageTitle}</strong></header>
    <div className="sm-agent-thread" ref={thread}>
      {!messages.length && <div className="sm-agent-prompts">{['Explain these metrics in plain language', 'What needs attention in this stage?', 'Which assumptions drive these numbers?'].map((prompt) => <button key={prompt} onClick={() => ask(prompt)}>{prompt}</button>)}</div>}
      {messages.map((message, index) => <div key={index} className={`sm-agent-message ${message.role}`}>{message.role === 'assistant' ? <><FormattedText text={message.content}/><small>{message.model}</small></> : <p>{message.content}</p>}</div>)}
      {busy && <div className="sm-agent-message assistant"><p className="sm-thinking"><Loader2 size={13} className="spin"/> Reading this stage's metrics…</p></div>}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); ask(); }}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder={`Ask about ${stageTitle}…`}/><button disabled={!input.trim() || busy}><Send size={14}/></button></form>
  </section>;
}

export default function StageDrawer({ node, nodes, onSelect, onClose, runId, runStatus, metrics, loading, error }) {
  const stageKey = NODE_STAGE[node.id];
  const stage = metrics?.stages?.[stageKey];
  const index = nodes.findIndex((item) => item.id === node.id);
  const groups = useMemo(() => ['P1', 'P2', 'P3'].map((priority) => [priority, (stage?.metrics || []).filter((item) => item.priority === priority)]).filter(([, items]) => items.length), [stage]);
  const preferred = stage?.metrics.find((item) => item.id === stage.headline);
  const headline = preferred && preferred.value != null ? preferred : stage?.metrics.find((item) => item.priority === 'P1' && item.value != null) || preferred;
  const substituted = headline && preferred && headline.id !== preferred.id ? `${preferred.id} ${preferred.label} is not measured yet` : null;
  const downloadStage = (format) => {
    if (!stage) return;
    if (format === 'json') download(new Blob([JSON.stringify({ runId, status: runStatus, stage }, null, 2)], { type: 'application/json' }), `${runId}-${stageKey}-metrics.json`);
    else download(new Blob([toCsv([['id', 'label', 'tag', 'priority', 'display', 'value', 'status', 'note'], ...stage.metrics.map((item) => [item.id, item.label, item.tag, item.priority, item.display, item.value, item.status, item.note])])], { type: 'text/csv' }), `${runId}-${stageKey}-metrics.csv`);
  };
  const downloadAll = () => metrics && download(new Blob([JSON.stringify(metrics, null, 2)], { type: 'application/json' }), `${runId}-all-metrics.json`);
  return <aside className="stage-drawer" role="dialog" aria-label={`${node.title} metrics`}>
    <header className="sd-head">
      <div className="sd-title"><span>STAGE {stage?.title || node.step} · {runId || 'no run yet'}{runStatus ? ` · ${runStatus.toUpperCase()}` : ''}</span><h2>{node.title}</h2><p>{stage ? <>{stage.input} <ChevronRight size={12}/> {stage.output}</> : node.detail}</p></div>
      <div className="sd-actions">
        <button disabled={!stage} onClick={() => downloadStage('csv')} title="Download this stage's metrics as CSV"><FileSpreadsheet size={14}/> CSV</button>
        <button disabled={!stage} onClick={() => downloadStage('json')} title="Download this stage's metrics as JSON"><FileJson size={14}/> JSON</button>
        <button disabled={!metrics} onClick={downloadAll} title="Download every stage's metrics"><Download size={14}/> All stages</button>
        <button className="sd-close" onClick={onClose} title="Close"><X size={17}/></button>
      </div>
      {headline && <div className="sd-headline"><span>{headline.id} · {headline.label}</span><strong>{headline.display}</strong>{(headline.plain || substituted) && <small>{[headline.plain, substituted && `(${substituted}; showing ${headline.id})`].filter(Boolean).join(' ')}</small>}</div>}
      <nav className="sd-steps">{nodes.map((item) => <button key={item.id} className={item.id === node.id ? 'active' : ''} onClick={() => onSelect(item.id)}>{item.step} {item.title}</button>)}</nav>
    </header>
    <div className="sd-body">
      <div className="sd-metrics">
        {!runId && <div className="sd-empty"><strong>No model run yet</strong><span>Run the workflow (or ask a loss question in chat) to calculate this stage's metrics.</span></div>}
        {runId && loading && <div className="sd-empty"><Loader2 size={18} className="spin"/><strong>Calculating metrics…</strong></div>}
        {runId && error && <div className="sd-empty error"><AlertTriangle size={18}/><strong>Metrics unavailable</strong><span>{error}</span></div>}
        {stage && groups.map(([priority, items]) => <section key={priority} className="sd-group"><h3>{PRIORITY_TITLE[priority]} <em>{priority} · {items.length}</em></h3><div className={`sd-grid ${priority.toLowerCase()}`}>{items.map((item) => <MetricCard key={item.id} metric={item} runId={runId}/>)}</div></section>)}
        <div className="sd-nav"><button disabled={index <= 0} onClick={() => onSelect(nodes[index - 1].id)}><ChevronLeft size={13}/> Previous stage</button><span>{index + 1} of {nodes.length}</span><button disabled={index >= nodes.length - 1} onClick={() => onSelect(nodes[index + 1].id)}>Next stage <ChevronRight size={13}/></button></div>
      </div>
      {runId && <StageAgent runId={runId} stageKey={stageKey} stageTitle={node.title}/>}
    </div>
  </aside>;
}
