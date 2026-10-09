import { jsPDF } from 'jspdf';

const NAVY = [4, 29, 59];
const RED = [209, 18, 66];
const INK = [30, 49, 67];
const MUTED = [91, 109, 125];
const RULE = [218, 226, 233];
const MARGIN = 17;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

export function reportText(value) {
  return String(value ?? '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2192/g, 'to')
    .replace(/\u2265/g, '>=')
    .replace(/\u2264/g, '<=')
    .replace(/\u2022/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseReportBlocks(markdown) {
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const raw of String(markdown || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = line.match(/^#{1,6}\s+(.+)$/) || line.match(/^\*\*([^*]+)\*\*:?$/);
    if (heading) { flush(); blocks.push({ type: 'heading', text: heading[1] }); continue; }
    const bullet = line.match(/^[-*\u2022]\s+(.+)$/) || line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet) { flush(); blocks.push({ type: 'bullet', text: bullet[1] }); continue; }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

function citationLabel(citation) {
  if (typeof citation === 'string') return citation;
  const name = citation?.filename || citation?.propertyId || citation?.runId || citation?.name || citation?.portfolioId || citation?.offer;
  if (!name) return null;
  if (citation.page) return `${name}, page ${citation.page}`;
  if (citation.rowRef) return `${name}, row ${citation.rowRef}`;
  return name;
}

export function relevantOfferStages(stages = []) {
  return stages.filter((stage) => ['warning', 'blocked', 'review'].includes(stage.status));
}

const reportSection = (blocks, title) => {
  const start = blocks.findIndex((block) => block.type === 'heading' && block.text.trim().toLowerCase() === title);
  if (start < 0) return [];
  const end = blocks.findIndex((block, index) => index > start && block.type === 'heading');
  return blocks.slice(start + 1, end < 0 ? undefined : end);
};

const concise = (value, maxWords = 34) => {
  const text = reportText(value);
  const words = text.split(/\s+/);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(' ')}…` : text;
};

function drawOfferReport({ message, blocks, heading, paragraph, bullet }) {
  const lead = blocks.find((block) => block.type === 'paragraph');
  if (lead) {
    heading('Decision summary');
    paragraph(concise(lead.text, 55));
  }

  const stages = message.offerChecks?.stages || [];
  const metrics = stages.find((stage) => stage.key === 'financial_loss');
  const hazard = stages.find((stage) => stage.key === 'hazard_intensity');
  if (metrics || hazard) {
    heading('Key flood figures');
    if (hazard) bullet(concise(hazard.summary, 24));
    if (metrics) {
      bullet(concise(metrics.summary, 24));
      for (const item of (metrics.details || []).slice(0, 2)) bullet(concise(item, 20));
    }
  }

  const checks = stages.find((stage) => stage.key === 'underwriting_checks');
  const severityRank = (finding) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[String(finding).match(/^(HIGH|MEDIUM|LOW):/)?.[1]] ?? 3);
  const orderedFindings = [...(checks?.details || [])].sort((left, right) => severityRank(left) - severityRank(right));
  const findings = orderedFindings.slice(0, 5);
  if (findings.length) {
    heading('Priority findings');
    for (const finding of findings) bullet(concise(finding, 36));
    if (orderedFindings.length > findings.length) paragraph(`${orderedFindings.length - findings.length} additional finding(s) omitted. See the offer checks for the full list.`);
  }

  const terms = reportSection(blocks, 'recommended terms').filter((block) => block.type === 'bullet').slice(0, 4);
  if (terms.length) {
    heading('Recommended terms');
    for (const item of terms) bullet(concise(item.text, 28));
  }

  const questions = reportSection(blocks, 'questions for the broker').filter((block) => block.type === 'bullet').slice(0, 3);
  if (questions.length) {
    heading('Questions for the broker');
    for (const item of questions) bullet(concise(item.text, 24));
  }

  const accumulation = stages.find((stage) => stage.key === 'accumulation');
  if (accumulation?.status === 'blocked' && accumulation.summary) {
    heading('Portfolio comparison');
    paragraph(concise(accumulation.summary, 28));
  }
}

export function buildChatReportPdf(message, { logoDataUrl, portfolioId, generatedAt = new Date() }) {
  if (!logoDataUrl) throw new Error('Kenya Re logo is required for the PDF report.');
  if (!message?.content) throw new Error('There is no completed chatbot answer to export.');

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const date = new Date(generatedAt);
  const dateLabel = Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
  let y = 40;

  const pageHeader = () => {
    pdf.setFillColor(...RED);
    pdf.rect(0, 0, PAGE_WIDTH, 3, 'F');
    pdf.addImage(logoDataUrl, 'PNG', MARGIN, 8, 39, 21.7);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.4);
    pdf.setTextColor(...NAVY);
    pdf.text('FURIKA AI', PAGE_WIDTH - MARGIN, 14, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...MUTED);
    pdf.text('CATASTROPHE RISK INTELLIGENCE', PAGE_WIDTH - MARGIN, 19, { align: 'right' });
    pdf.setDrawColor(...RULE);
    pdf.line(MARGIN, 33, PAGE_WIDTH - MARGIN, 33);
  };
  pageHeader();

  const ensureSpace = (height) => {
    if (y + height <= PAGE_HEIGHT - 20) return;
    pdf.addPage();
    pageHeader();
    y = 42;
  };

  const drawLines = (value, { x = MARGIN, width = CONTENT_WIDTH, size = 10, leading = 5.2, color = INK, bold = false } = {}) => {
    const text = reportText(value);
    if (!text) return;
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    for (const line of pdf.splitTextToSize(text, width)) {
      ensureSpace(leading);
      pdf.text(line, x, y);
      y += leading;
    }
  };

  const heading = (value) => {
    ensureSpace(14);
    y += 5;
    pdf.setFillColor(...RED);
    pdf.rect(MARGIN, y - 3.3, 2, 6, 'F');
    drawLines(value, { x: MARGIN + 6, width: CONTENT_WIDTH - 6, size: 12, leading: 6.5, color: NAVY, bold: true });
    y += 2;
  };

  const paragraph = (value) => { drawLines(value); y += 3; };
  const bullet = (value) => {
    ensureSpace(6);
    pdf.setFillColor(...RED);
    pdf.circle(MARGIN + 1.5, y - 1.1, 0.9, 'F');
    drawLines(value, { x: MARGIN + 6, width: CONTENT_WIDTH - 6, size: 9.6, leading: 5 });
    y += 1.5;
  };

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor(...NAVY);
  pdf.text(message.offerChecks ? 'Placement offer review' : 'Chat analysis report', MARGIN, y + 4);
  y += 10;
  pdf.setFontSize(8.5);
  pdf.setTextColor(...RED);
  pdf.text('AI-GENERATED ANALYSIS  |  HUMAN REVIEW REQUIRED', MARGIN, y);
  y += 7;

  pdf.setFillColor(244, 247, 250);
  pdf.roundedRect(MARGIN, y, CONTENT_WIDTH, 21, 2, 2, 'F');
  const metadata = [
    ['PORTFOLIO', portfolioId || 'Not specified'],
    ['GENERATED', dateLabel],
    ['MODEL CONTEXT', message.workflow?.status === 'approved' ? 'Approved run' : message.workflow?.status === 'review' ? 'Draft - awaiting review' : 'Analyst response'],
  ];
  metadata.forEach(([label, value], index) => {
    const x = MARGIN + 5 + index * 58;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(...MUTED);
    pdf.text(label, x, y + 7);
    pdf.setFontSize(8.1);
    pdf.setTextColor(...NAVY);
    pdf.text(pdf.splitTextToSize(reportText(value), 53).slice(0, 2), x, y + 12);
  });
  y += 23;

  if (message.question && !message.offerChecks) {
    heading('Question');
    paragraph(concise(message.question, 45));
  }

  const blocks = parseReportBlocks(message.content);
  if (message.offerChecks) {
    drawOfferReport({ message, blocks, heading, paragraph, bullet });
  } else {
    const lead = blocks[0]?.type === 'paragraph' ? blocks.shift() : null;
    if (lead) { heading('Executive summary'); paragraph(lead.text); }
    if (blocks.length) {
      if (!blocks.some((block) => block.type === 'heading')) heading('Analysis');
      for (const block of blocks) {
        if (block.type === 'heading') heading(block.text);
        else if (block.type === 'bullet') bullet(block.text);
        else paragraph(block.text);
      }
    }
  }

  if (message.workflow?.runId) {
    heading('Workflow status');
    paragraph(`Run ${message.workflow.runId}: ${message.workflow.status || 'status unknown'}. ${message.workflow.status === 'approved' ? 'Approved model results were available in this response.' : 'Results require human review before approval.'}`);
  }

  const sources = [...new Set([
    ...(message.reportAttachments || message.attachments || []),
    message.source,
    ...(message.citations || []).map(citationLabel),
  ].filter(Boolean).map(reportText))].slice(0, 6);
  if (sources.length) {
    heading('Evidence and sources');
    for (const source of sources) bullet(source);
  }

  heading('Important limitations');
  bullet('This is an AI-assisted analytical briefing, not an underwriting decision or coverage approval. Verify figures and cited sources before use.');
  bullet('Flood susceptibility scores and modelled depths are proxies or assumptions unless the cited evidence explicitly says otherwise.');

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(...RULE);
    pdf.line(MARGIN, PAGE_HEIGHT - 16, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 16);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...MUTED);
    pdf.text('KENYA RE  |  FURIKA AI  |  INTERNAL ANALYST BRIEFING', MARGIN, PAGE_HEIGHT - 11);
    pdf.text(`Page ${page} of ${pages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 11, { align: 'right' });
  }
  pdf.setProperties({ title: message.offerChecks ? 'Kenya Re placement offer review' : 'Kenya Re Furika AI chat analysis', subject: 'AI-assisted flood risk analysis', author: 'Kenya Re / Furika AI' });
  return pdf;
}

export function downloadChatReportPdf(message, options) {
  const pdf = buildChatReportPdf(message, options);
  const requestedDate = new Date(options.generatedAt || new Date());
  const stamp = (Number.isNaN(requestedDate.getTime()) ? new Date() : requestedDate).toISOString().slice(0, 10);
  pdf.save(`kenya-re-furika-chat-report-${stamp}.pdf`);
}
