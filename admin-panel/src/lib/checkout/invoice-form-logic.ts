import { validateTaxId } from '@/lib/validation/nip';
import type { TaxMode } from '@/lib/actions/shop-config';

/**
 * Pure decision logic for the on-site checkout invoice/company fields. Extracted from the
 * React components so every condition (visibility, required-vs-optional, what goes to the
 * order vs to Stripe) is covered by unit tests rather than buried in JSX.
 *
 * Field routing (single source of truth):
 *  - to the ORDER / faktura (always, both tax modes): needs_invoice, nip, company_name,
 *    address, city, postal_code, country — stored in Stripe metadata and surfaced on the
 *    purchase.completed webhook + /api/v1/payments.
 *  - to STRIPE for tax (stripe_tax mode only): the buyer's country + EU VAT-ID, applied to
 *    the Stripe Customer so automatic_tax computes jurisdiction + B2B reverse charge.
 *
 * Required vs optional: the NIP/tax-id is OPTIONAL. An invoice (faktura) is "requested" iff a
 * structurally valid tax id was entered; the company/address fields are optional supporting data.
 */

/** True when the buyer entered a structurally valid tax id → treat the order as a faktura request. */
export function hasValidTaxId(nip: string | null | undefined): boolean {
  return !!nip && nip.trim().length > 0 && validateTaxId(nip, false).isValid;
}

/** `needs_invoice` flag sent to the backend. Identical to {@link hasValidTaxId} — named for intent. */
export function shouldRequestInvoice(nip: string | null | undefined): boolean {
  return hasValidTaxId(nip);
}

/**
 * Show the company/address group. Appears once a full PL NIP (10 chars) is typed, GUS data has
 * been fetched, or a company name is already present (e.g. restored from profile pre-fill).
 */
export function shouldShowCompanyFields(opts: {
  nip?: string | null;
  hasGusData?: boolean;
  companyName?: string | null;
}): boolean {
  const nip = opts.nip ?? '';
  return nip.length === 10 || !!opts.hasGusData || !!opts.companyName;
}

/**
 * Show the buyer-country selector. Only meaningful under Stripe Tax, where the buyer's country
 * drives the jurisdiction + EU B2B reverse charge. In Fixed-Rate (local) mode the rate is flat,
 * so the selector is hidden to keep the form minimal.
 */
export function shouldCollectBuyerCountry(taxMode: TaxMode | null | undefined): boolean {
  return taxMode === 'stripe_tax';
}

/**
 * Whether to forward the buyer's tax identity (country + EU VAT-ID) to Stripe. Stripe Tax mode
 * only — in local mode the manual TaxRate carries the tax and the buyer's identity is not sent
 * to Stripe (it still goes to the order/faktura metadata).
 */
export function shouldForwardTaxIdentityToStripe(taxMode: TaxMode | null | undefined): boolean {
  return taxMode === 'stripe_tax';
}
