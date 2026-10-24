/** Buyer-facing checkout request errors. @see app/[locale]/checkout/[slug]/components/CustomPaymentForm.tsx */
export function getCheckoutRequestError(status: number, message: string | undefined, fallback: string, rateLimit: string): string {
  return status === 429 ? rateLimit : message || fallback;
}
