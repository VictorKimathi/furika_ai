// One shape for every decision card, whether the subject is a placement offer or a portfolio run:
// the numbers, at most five checks (decision-changing first) and how far to trust them.
import { kes, pct } from './runStory.js';

export const MAX_CHECKS = 5;
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

const dateLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function offerCard(decision) {
  if (!decision) return null;
  const n = decision.numbers || {};
  const days = decision.daysToExpiry;
  return {
    kind: 'offer', subjectRef: decision.subjectRef, subjectLabel: decision.name, name: decision.name, reference: decision.reference,
    deadline: decision.expiry ? { text: days != null && days < 0 ? `Offer expired ${dateLabel(decision.expiry)}` : `Offer expires ${dateLabel(decision.expiry)}`, urgent: days != null && days <= 7 } : null,
    numbers: { loss100Kes: n.loss100Kes, loss250Kes: n.loss250Kes, tivKes: n.tivKes, aalLowKes: n.aalLowKes, aalHighKes: n.aalHighKes, net100Kes: null },
    checks: [...(decision.checks || [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, MAX_CHECKS),
    moreChecks: decision.moreChecks || 0,
    confidence: decision.confidence || { level: 'low', reasons: [] },
  };
}

export function storyCard(story, { runId, portfolioId, status }) {
  if (!story) return null;
  const { numbers, trust } = story;
  const reasons = ['The hazard is a terrain proxy, not measured flood depth.', 'The return period of each flood tier is assumed.'];
  if (trust.termsAssumed) reasons.push('Deductible, limit and reinsurance terms are assumed, not supplied.');
  if (trust.syntheticShare) reasons.push(`${pct(trust.syntheticShare)} of property records are synthetic.`);
  if (trust.openAssumptions) reasons.push(`${trust.openAssumptions} modelling assumptions are still open.`);
  const failing = story.flags.some((flag) => flag.severity === 'fail');
  return {
    kind: 'run', subjectRef: `run:${runId}`, subjectLabel: `Portfolio ${portfolioId} · ${runId}`, name: `Portfolio ${portfolioId}`, reference: runId,
    deadline: status === 'review' ? { text: 'Waiting for your decision', urgent: true } : status === 'approved' ? { text: 'Approved', urgent: false } : null,
    numbers,
    checks: story.flags.map((flag) => ({ severity: flag.severity === 'fail' ? 'high' : 'medium', title: flag.text, detail: null, source: { label: 'Open the figures', nodeId: flag.nodeId } })).slice(0, MAX_CHECKS),
    moreChecks: Math.max(0, story.flags.length - MAX_CHECKS),
    confidence: { level: failing || (trust.syntheticShare ?? 0) >= 0.5 ? 'low' : 'medium', reasons },
  };
}

// What to ask the underwriter for when an answer fails, so a failure is never a dead end.
export function needFromYou(errorText = '') {
  const text = String(errorText).toLowerCase();
  if (/not reachable|network|failed to fetch/.test(text)) return { ask: 'The analysis service is not reachable. Check your connection, then retry.', addFile: false };
  if (/processing|not available yet|no processed|still/.test(text)) return { ask: 'The file is still being read. Wait a moment, then retry, or choose a file that has finished processing.', addFile: true };
  if (/more than five|too many/.test(text)) return { ask: 'Choose at most five files for one question.', addFile: true };
  if (/offer/.test(text)) return { ask: 'Paste the placement offer again, or select the offer document, then retry.', addFile: true };
  if (/not found/.test(text)) return { ask: 'The file or portfolio this question used no longer exists. Choose another file, then retry.', addFile: true };
  if (/empty|required/.test(text)) return { ask: 'Type a question, then send it.', addFile: false };
  return { ask: 'Something went wrong on our side. Retry; if it fails again, ask the question another way.', addFile: false };
}

// A report message for the results Summary, in the same form the chat's PDF builder takes.
export function storyReportMessage(story, { runId, status, portfolioId }) {
  const card = storyCard(story, { runId, portfolioId, status });
  const n = card.numbers;
  const lines = [
    '## Decision summary',
    `- **1-in-100 year loss:** ${kes(n.loss100Kes)}${n.tivKes ? ` (${pct(n.loss100Kes / n.tivKes, 1)} of insured value)` : ''}`,
    `- **1-in-250 year loss:** ${kes(n.loss250Kes)}`,
    n.aalLowKes != null ? `- **Average yearly loss:** ${kes(n.aalLowKes)} to ${kes(n.aalHighKes)}` : null,
    n.net100Kes != null ? `- **1-in-100 net of reinsurance:** ${kes(n.net100Kes)}` : null,
    '', '## Check before deciding',
    ...(card.checks.length ? card.checks.map((check) => `- ${check.title}`) : ['- No warnings raised by the model checks.']),
    '', `## Confidence: ${card.confidence.level}`, ...card.confidence.reasons.map((reason) => `- ${reason}`),
    '', '## What the model found', ...story.chapters.map((chapter) => `- **${chapter.question}** ${chapter.answer}`),
  ].filter((line) => line !== null);
  return { role: 'assistant', question: 'Portfolio results summary', content: lines.join('\n'), workflow: { runId, status }, source: 'Portfolio and workflow database', citations: [{ runId }], createdAt: new Date().toISOString() };
}
