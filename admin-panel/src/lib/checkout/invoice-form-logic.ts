import { classifyTaxId, taxIdTypeForCountry } from '@/lib/validation/tax-id';
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

/**
 * True when the buyer entered a tax id valid for the company country (PL NIP checksum, EU VAT
 * country format, any identifier elsewhere) → treat the order as a faktura request.
 * Same rule as the profile checkout (@see ../validation/tax-id.ts).
 */
export function hasValidTaxId(nip: string | null | undefined, country: string): boolean {
  return !!nip && nip.trim().length > 0 && classifyTaxId(nip, country).valid;
}

/** `needs_invoice` flag sent to the backend. Identical to {@link hasValidTaxId} — named for intent. */
export function shouldRequestInvoice(nip: string | null | undefined, country: string): boolean {
  return hasValidTaxId(nip, country);
}

/** Error code (checkout.profile.errors.*) for an invalid tax id in the given country. */
export function taxIdErrorCode(country: string): 'invalid_nip' | 'invalid_eu_vat' | 'invalid_tax_id' {
  const type = taxIdTypeForCountry(country);
  return type === 'pl_nip' ? 'invalid_nip' : type === 'eu_vat' ? 'invalid_eu_vat' : 'invalid_tax_id';
}

/**
 * Show the company/address group. Appears once a full PL NIP (10 chars) or any foreign number is
 * typed, GUS data has been fetched, or a company name is already present (e.g. restored from profile pre-fill).
 */
export function shouldShowCompanyFields(opts: {
  nip?: string | null;
  country?: string;
  hasGusData?: boolean;
  companyName?: string | null;
}): boolean {
  const nip = opts.nip ?? '';
  const typed = (opts.country ?? 'PL') === 'PL' ? nip.length === 10 : nip.trim().length > 0;
  return typed || !!opts.hasGusData || !!opts.companyName;
}

/**
 * Whether to forward the buyer's tax identity (country + EU VAT-ID) to Stripe. Stripe Tax mode
 * only — in local mode the manual TaxRate carries the tax and the buyer's identity is not sent
 * to Stripe (it still goes to the order/faktura metadata).
 */
export function shouldForwardTaxIdentityToStripe(taxMode: TaxMode | null | undefined): boolean {
  return taxMode === 'stripe_tax';
}
