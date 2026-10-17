/** Stripe return URLs for public checkout. @see app/payment/success/page.tsx */
interface CheckoutReturnInput { origin: string; productId: string; productSlug: string; locale?: string; successUrl?: string }
export function buildCheckoutReturnUrl(input: CheckoutReturnInput): string {
  const locale = input.locale === 'pl' ? 'pl' : 'en';
  return `${input.origin}/payment/success?session_id={CHECKOUT_SESSION_ID}&product_id=${encodeURIComponent(input.productId)}&product=${encodeURIComponent(input.productSlug)}&locale=${locale}${input.successUrl ? `&success_url=${encodeURIComponent(input.successUrl)}` : ''}`;
}
