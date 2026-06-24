import type { TaxMode } from '@/lib/actions/shop-config';

/**
 * Warn the seller that, in Stripe Tax mode, their shop-level VAT exemption is IGNORED —
 * Stripe is the sole authority on taxability there, so a domestic "zw." (art. 113) flag does
 * not stop Stripe from charging VAT (e.g. cross-border). Surfaced in StripeTaxSettings so an
 * exempt seller who switches to Stripe Tax understands the change before it bites.
 */
export function shouldWarnExemptIgnoredUnderStripeTax(opts: {
  isVatExempt?: boolean | null;
  taxMode?: TaxMode | null;
}): boolean {
  return !!opts.isVatExempt && opts.taxMode === 'stripe_tax';
}
