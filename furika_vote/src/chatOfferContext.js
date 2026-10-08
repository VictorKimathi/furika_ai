// Keep a single placement offer as the active chat subject. Portfolio uploads
// are never carried into an offer follow-up unless the user selects them anew.
export function carriedOfferContext(activeOffer, messages, selectedSources) {
  if (!activeOffer || selectedSources.length) return {};
  if (activeOffer.kind === 'upload') return { offerUploadId: activeOffer.uploadId };
  if (activeOffer.kind === 'pasted') {
    const text = messages[activeOffer.messageIndex]?.content;
    return typeof text === 'string' && text ? { offerText: text } : {};
  }
  return {};
}

export function offerContextAfterResponse(response, question, selectedSources, messageIndex, current) {
  if (!response.offerChecks) return selectedSources.length ? null : current;
  if (question.length >= 800 && response.source?.startsWith('Pasted placement offer')) {
    return { kind: 'pasted', messageIndex };
  }
  const source = selectedSources.length === 1 ? selectedSources[0] : null;
  if (source && ['pdf', 'docx', 'text'].includes(source.upload?.extractor)) {
    return { kind: 'upload', uploadId: source.id, name: source.name };
  }
  return current;
}
