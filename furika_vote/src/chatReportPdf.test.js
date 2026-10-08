import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildChatReportPdf, parseReportBlocks, reportText } from './chatReportPdf.js';

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

test('Kenya Re chat PDF embeds the logo and paginates a long structured offer report', () => {
  const message = {
    question: 'What is the flood risk?',
    content: `A provisional finding based on the selected offer.\n\n## Hazard intensity\n${'- Proxy score requires human review.\n'.repeat(90)}`,
    reportAttachments: ['placement-offer.pdf'],
    source: 'placement-offer.pdf (contact details redacted)',
    citations: [{ filename: 'placement-offer.pdf', page: 2 }],
    offerChecks: { stages: [
      { title: 'Vulnerability', status: 'warning', summary: 'Basement plant is not modelled.', details: ['Confirm critical equipment location.'] },
      { title: 'Financial loss', status: 'blocked', summary: 'Insured value is missing.', details: ['Obtain a confirmed sum insured.'] },
    ] },
  };
  const pdf = buildChatReportPdf(message, { logoDataUrl, portfolioId: 'SYN-PORT-142', generatedAt: '2026-10-08T10:00:00Z' });
  const bytes = Buffer.from(pdf.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.getNumberOfPages() > 1);
  assert.match(bytes.toString('latin1'), /\/Subtype \/Image/);
});

test('report requires both a completed answer and the Kenya Re logo', () => {
  assert.throws(() => buildChatReportPdf({ content: 'Answer' }, { portfolioId: 'P' }), /logo is required/);
  assert.throws(() => buildChatReportPdf({ content: '' }, { logoDataUrl }), /no completed chatbot answer/);
});
