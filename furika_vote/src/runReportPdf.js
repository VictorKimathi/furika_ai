import { jsPDF } from 'jspdf';
import { kes, pct } from './runStory.js';

const LEFT = 16;
const RIGHT = 194;
const BOTTOM = 280;
const ORDER = ['ingestion', 'hazard', 'vulnerability', 'exposure', 'financial', 'ai', 'portfolio', 'trust'];

export function buildRunReportPdf(report) {
  const pdf = new jsPDF();
  let y = 18;
  const page = () => { pdf.addPage(); y = 18; };
  const ensure = (height = 8) => { if (y + height > BOTTOM) page(); };
  const text = (value, size = 10, bold = false, gap = 5.5) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    const printable = String(value ?? '-').replaceAll('→', 'to').replaceAll('×', 'x').replaceAll('–', '-').replaceAll('—', '-').replaceAll('·', '|').replaceAll('•', '-');
    const lines = pdf.splitTextToSize(printable, RIGHT - LEFT);
    ensure(lines.length * gap + 2);
    pdf.text(lines, LEFT, y);
    y += lines.length * gap + 2;
  };
  const heading = (value) => { ensure(14); y += 3; pdf.setTextColor(4, 29, 59); text(value, 14, true, 7); pdf.setTextColor(20, 40, 60); };

  pdf.setTextColor(4, 29, 59);
  text('FURIKA AI · APPROVED MODEL REPORT', 10, true);
  text(`Nairobi flood portfolio · ${report.runId}`, 18, true, 9);
  text(`${report.portfolioId} · ${report.summary.propertyCount ?? '—'} modelled properties · synthetic/redacted exposure`);
  heading('Executive results');
  text(`Total insured value: ${kes(report.summary.totalTivKes)}`);
  text(`Ground-up AAL: ${kes(report.financial.aalRangeKes.central)} (range ${kes(report.financial.aalRangeKes.low)}–${kes(report.financial.aalRangeKes.high)})`);
  const at100 = report.epCurve.find((row) => row.returnPeriodYears === 100);
  text(`1-in-100 loss: ${kes(at100?.groundUpKes)} ground-up, ${kes(at100?.grossKes)} gross, ${kes(at100?.netKes)} net; ${pct(report.financial.lossRatio100, 1)} of insured value ground-up.`);

  heading('Exceedance probability (EP) curve');
  text('Return periods and annual exceedance chances are assumed scenario mappings, not observed flood frequencies.', 9);
  const rows = report.epCurve;
  if (rows.length > 1) {
    ensure(62);
    const x0 = 25, y0 = y + 49, width = 155, height = 43;
    const maxLoss = Math.max(...rows.map((row) => row.groundUpKes || 0), 1);
    const minRp = Math.log(rows[0].returnPeriodYears), maxRp = Math.log(rows[rows.length - 1].returnPeriodYears);
    const x = (row) => x0 + (Math.log(row.returnPeriodYears) - minRp) / (maxRp - minRp) * width;
    const py = (value) => y0 - (value || 0) / maxLoss * height;
    pdf.setDrawColor(165, 180, 195); pdf.line(x0, y0, x0 + width, y0); pdf.line(x0, y0, x0, y0 - height);
    const series = [['groundUpKes', [42, 120, 214]], ['grossKes', [235, 104, 52]], ['netKes', [27, 175, 122]]];
    series.forEach(([key, color]) => { pdf.setDrawColor(...color); pdf.setLineWidth(0.65); for (let i = 1; i < rows.length; i++) pdf.line(x(rows[i - 1]), py(rows[i - 1][key]), x(rows[i]), py(rows[i][key])); });
    pdf.setFontSize(8); pdf.setTextColor(75, 95, 115);
    rows.forEach((row) => pdf.text(String(row.returnPeriodYears), x(row), y0 + 5, { align: 'center' }));
    pdf.text('Loss (KES) by return period in years', x0, y0 - height - 2);
    y = y0 + 12;
    text('Blue: ground-up · orange: gross · green: net', 8);
  }
  rows.forEach((row) => text(`1 in ${row.returnPeriodYears} (${pct(row.annualExceedanceProbability, row.returnPeriodYears >= 100 ? 1 : 0)} annually): ground-up ${kes(row.groundUpKes)} · gross ${kes(row.grossKes)} · net ${kes(row.netKes)}`, 9));

  heading('Financial engine and loss waterfall');
  text(`Affected properties in rarest scenario: ${report.financial.affectedProperties250 ?? '—'}.`);
  Object.entries(report.financial.aalByLayerKes || {}).forEach(([layer, value]) => text(`${layer.replaceAll('_', ' ')} AAL: ${kes(value)}`));
  report.financial.lossWaterfall.forEach((row) => text(`1 in ${row.rp}: damage ${kes(row.groundUpKes)} - owners ${kes(row.ownerKeepsKes)} - above limit ${kes(row.aboveLimitKes)} = gross ${kes(row.grossKes)}; quota share ${kes(row.quotaShareKes)}, cat XL ${kes(row.catXlKes)} => net ${kes(row.netKes)}`, 9));

  heading('Results at every model step');
  ORDER.forEach((key) => {
    const stage = report.stages[key];
    if (!stage) return;
    heading(stage.title);
    text(`Input: ${stage.input}. Output: ${stage.output}.`, 9);
    stage.metrics.forEach((item) => text(`${item.id} ${item.label} [${item.tag}]: ${item.display}${item.note ? ` — ${item.note}` : ''}`, 8.5));
  });
  heading('Assumptions and limitations');
  const financialMetrics = report.stages.financial?.metrics || [];
  financialMetrics.find((item) => item.id === 'FIN-21')?.table?.rows?.forEach(([name, value]) => text(`${name}: ${value}`, 9));
  report.limitations.forEach((limit) => text(`• ${limit}`, 9));
  text(report.note, 9);
  const count = pdf.getNumberOfPages();
  for (let number = 1; number <= count; number++) {
    pdf.setPage(number); pdf.setFontSize(8); pdf.setTextColor(105, 120, 135);
    pdf.text(`${report.runId} · Page ${number} of ${count}`, RIGHT, 290, { align: 'right' });
  }
  return pdf;
}

export function downloadRunReportPdf(report) {
  buildRunReportPdf(report).save(`furika-model-report-${report.runId}.pdf`);
}
