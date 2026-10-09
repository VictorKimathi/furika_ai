// Keep a single placement offer as the active chat subject. Portfolio uploads
// are never carried into an offer follow-up unless the user selects them anew.
const OFFER_TERMS = /placement|reinsurance|underwrit|broker|insured|\btiv\b|sum insured|deductible|premium|facultative|cedant|memorandum|coverage|loss history/gi;

function isNewPastedOffer(text) {
  return text.length >= 800 && new Set([...text.matchAll(OFFER_TERMS)].map((match) => match[0].toLowerCase())).size >= 4;
}

export function carriedOfferContext(activeOffer, messages, selectedSources) {
  if (!activeOffer || selectedSources.length) return {};
  if (activeOffer.kind === 'upload') return { offerUploadId: activeOffer.uploadId || '' };
  if (activeOffer.kind === 'pasted') {
    const text = messages[activeOffer.messageIndex]?.content;
    return { offerText: typeof text === 'string' ? text : '' };
  }
  return { offerText: '' };
}

export function offerContextAfterResponse(response, question, selectedSources, messageIndex, current) {
  if (!response.offerChecks) return selectedSources.length ? null : current;
  if (response.source?.startsWith('Pasted placement offer') && (!current || isNewPastedOffer(question))) {
    return { kind: 'pasted', messageIndex };
  }
  const source = selectedSources.length === 1 ? selectedSources[0] : null;
  if (source && ['pdf', 'docx', 'text'].includes(source.upload?.extractor)) {
    return { kind: 'upload', uploadId: source.id, name: source.name };
  }
  return current;
}
