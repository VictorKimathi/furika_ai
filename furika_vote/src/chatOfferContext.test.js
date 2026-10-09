import test from 'node:test';
import assert from 'node:assert/strict';
import { carriedOfferContext, offerContextAfterResponse } from './chatOfferContext.js';

test('pasted offer remains the only source for a follow-up', () => {
  const messages = [{ role: 'user', content: 'A long placement offer' }, { role: 'assistant', content: 'Offer checks' }];
  const current = { kind: 'pasted', messageIndex: 0 };
  assert.deepEqual(carriedOfferContext(current, messages, []), { offerText: 'A long placement offer' });
  assert.deepEqual(carriedOfferContext(current, messages, [{ id: 'csv-1' }]), {});
  assert.deepEqual(carriedOfferContext(current, [], []), { offerText: '' });
});

test('uploaded offer stays attached by ID, while a new explicit source replaces it', () => {
  const source = { id: 'offer-1', name: 'placement.pdf', upload: { extractor: 'pdf' } };
  const active = offerContextAfterResponse({ offerChecks: { stages: [] }, source: 'placement.pdf' }, 'Review this offer', [source], 3, null);
  assert.deepEqual(carriedOfferContext(active, [], []), { offerUploadId: 'offer-1' });
  assert.equal(offerContextAfterResponse({ answer: 'CSV result' }, 'Summarise CSV', [{ id: 'csv-1' }], 4, active), null);
});

test('a newly pasted offer supersedes the previous offer', () => {
  const previous = { kind: 'upload', uploadId: 'old-offer' };
  const next = offerContextAfterResponse({ offerChecks: {}, source: 'Pasted placement offer (contact details redacted)' }, 'Placement reinsurance broker insured value. '.repeat(24), [], 8, previous);
  assert.deepEqual(next, { kind: 'pasted', messageIndex: 8 });
  const followUp = offerContextAfterResponse({ offerChecks: {}, source: 'Pasted placement offer (contact details redacted)' }, 'Please focus on the basement. '.repeat(30), [], 10, next);
  assert.deepEqual(followUp, next);
});
