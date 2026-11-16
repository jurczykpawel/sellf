import type { TaxMode } from '@/lib/actions/shop-config';

/**
 * Tax-mode decision shared by both checkouts and the server. The invoice rules themselves
 * (what a company invoice needs, tax id formats) live in ./invoice-section.ts.
 *
 * Field routing:
 *  - to the ORDER / faktura (always, both tax modes): needs_invoice, nip, company_name,
 *    address, city, postal_code, country — stored with the order and surfaced on the
 *    purchase.completed webhook + /api/v1/payments.
 *  - to STRIPE for tax (stripe_tax mode only): the buyer's country + EU VAT-ID, applied to
 *    the Stripe Customer so automatic_tax computes jurisdiction + B2B reverse charge.
 */

/**
 * Whether to forward the buyer's tax identity (country + EU VAT-ID) to Stripe. Stripe Tax mode
 * only — in local mode the manual TaxRate carries the tax and the buyer's identity is not sent
 * to Stripe (it still goes to the order/faktura metadata).
 */
export function shouldForwardTaxIdentityToStripe(taxMode: TaxMode | null | undefined): boolean {
  return taxMode === 'stripe_tax';
}
