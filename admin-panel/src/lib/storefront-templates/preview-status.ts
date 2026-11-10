/** Human-readable cause for a rejected private preview. */
export function previewFailureMessage(code: string, issuedAt: number, now = Date.now()): 'previewLinkInvalid' | 'previewExpired' | 'previewDraftChanged' | 'previewInvalidDraft' | 'previewServiceUnavailable' {
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now) return 'previewLinkInvalid';
  if (now >= issuedAt + 600000) return 'previewExpired';
  if (code === 'CONFLICT') return 'previewDraftChanged';
  return code === 'INVALID' || code === 'LIMIT' ? 'previewInvalidDraft' : 'previewServiceUnavailable';
}
