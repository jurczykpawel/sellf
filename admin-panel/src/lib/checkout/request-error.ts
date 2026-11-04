/**
 * Buyer-facing message for a failed checkout request. Server texts are English, so a
 * 5xx always falls back to the localized message and known error codes use their
 * localized text (W146 B6: a buyer saw "Failed to create payment intent").
 */
export function getCheckoutRequestError(
  status: number,
  message: string | undefined,
  fallback: string,
  rateLimit: string,
  known?: { code?: string; messages: Record<string, string> },
): string {
  if (status === 429) return rateLimit;
  if (known?.code && known.messages[known.code]) return known.messages[known.code];
  if (status >= 500) return fallback;
  return message || fallback;
}
