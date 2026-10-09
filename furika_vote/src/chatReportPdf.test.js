import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildChatReportPdf, parseReportBlocks, relevantOfferStages, reportText } from './chatReportPdf.js';

const logoDataUrl = `data:image/png;base64,${readFileSync(new URL('./assets/kenya-re-logo-light.png', import.meta.url)).toString('base64')}`;

test('report parser keeps answer sections, paragraphs, and findings separate', () => {
  assert.deepEqual(parseReportBlocks('Direct answer.\n\n## Hazard\n- **High** risk\n- Second point'), [
    { type: 'paragraph', text: 'Direct answer.' },
    { type: 'heading', text: 'Hazard' },
    { type: 'bullet', text: '**High** risk' },
    { type: 'bullet', text: 'Second point' },
  ]);
  assert.equal(reportText('**KES 1M** → review'), 'KES 1M to review');
});

test('generated reports keep only offer checks that need attention', () => {
  assert.deepEqual(relevantOfferStages([
    { title: 'Data extraction', status: 'complete' },
    { title: 'Vulnerability', status: 'warning' },
    { title: 'Financial loss', status: 'blocked' },
    { title: 'Human review', status: 'review' },
  ]).map((stage) => stage.title), ['Vulnerability', 'Financial loss', 'Human review']);
});

test('Kenya Re chat PDF embeds the logo and paginates a long structured offer report', () => {
  const message = {
    question: 'What is the flood risk?',
    content: `A provisional finding based on the selected offer.\n\n## Hazard intensity\n${'- Proxy score requires human review.\n'.repeat(90)}`,
    reportAttachments: ['placement-offer.pdf'],
    source: 'placement-offer.pdf (contact details redacted)',
    citations: [{ filename: 'placement-offer.pdf', page: 2 }],
  };
  const pdf = buildChatReportPdf(message, { logoDataUrl, portfolioId: 'SYN-PORT-142', generatedAt: '2026-10-08T10:00:00Z' });
  const bytes = Buffer.from(pdf.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.getNumberOfPages() > 1);
  assert.match(bytes.toString('latin1'), /\/Subtype \/Image/);
});

test('placement-offer reports omit the pasted offer and repeated analysis', () => {
  const message = {
    question: 'CONFIDENTIAL OFFER: '.repeat(500),
    content: [
      'Flood review: 10 findings, including 3 high priority.',
      '', '## Flood model view', '- Repeated model text. '.repeat(80),
      '', '## Recommended terms', '- Apply a flood deductible pending review.', '- Require basement flood defenses.',
      '', '## Questions for the broker', '- Provide a verified elevation survey.', '- Confirm basement plant values.',
      '', '## Additional AI interpretation', 'Repeated analysis. '.repeat(300),
    ].join('\n'),
    offerChecks: { stages: [
      { key: 'hazard_intensity', status: 'complete', summary: 'Annual flood probability is 2%; depths are model proxies.' },
      { key: 'financial_loss', status: 'complete', summary: 'AAL KES 100,000; 1-in-100 loss KES 4,000,000.', details: ['AAL range: KES 80,000 to KES 120,000.', '1-in-250 loss: KES 12,000,000.'] },
      { key: 'underwriting_checks', status: 'warning', summary: '3 findings; 2 high priority.', details: [
        'LOW: Minor notation issue — verify coordinates.', 'HIGH: Basement exposure — plant is not modelled.',
        'MEDIUM: Hazard estimate is approximate — nearest point is distant.', 'HIGH: Elevation claim — request a survey.',
        'LOW: Deadline — offer expires soon.', 'MEDIUM: Further check — confirm drainage.',
      ] },
      { key: 'accumulation', status: 'blocked', summary: 'Not assessed for this single offer.' },
    ] },
    source: 'placement-offer.pdf (contact details redacted)',
    citations: [{ filename: 'placement-offer.pdf', page: 1 }],
  };
  const pdf = buildChatReportPdf(message, { logoDataUrl, portfolioId: 'SYN-PORT-142', generatedAt: '2026-10-08T10:00:00Z' });
  assert.ok(pdf.getNumberOfPages() <= 2);
});

test('report requires both a completed answer and the Kenya Re logo', () => {
  assert.throws(() => buildChatReportPdf({ content: 'Answer' }, { portfolioId: 'P' }), /logo is required/);
  assert.throws(() => buildChatReportPdf({ content: '' }, { logoDataUrl }), /no completed chatbot answer/);
});
