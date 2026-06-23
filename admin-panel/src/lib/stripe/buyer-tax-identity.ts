import type Stripe from 'stripe';

/**
 * The BUYER's tax identity, collected by Sellf's own InvoiceFields (the on-site checkout
 * form). `country` is the buyer's country — NOT the shop's — because Stripe Tax determines
 * the jurisdiction from the customer's location, and EU B2B reverse charge depends on the
 * buyer being in a different EU country than the seller's registration.
 */
export interface BuyerTaxIdentity {
  country?: string | null;
  taxId?: string | null;   // raw NIP / VAT number as typed by the buyer
  address?: string | null; // line1
  city?: string | null;
  postalCode?: string | null;
}

// EU member states (ISO-3166-1 alpha-2). Only these get an `eu_vat` tax id → reverse charge.
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

/**
 * Normalize a raw VAT number to Stripe's `eu_vat` format (country-prefixed, no spaces).
 * Buyers often type just the digits (e.g. a PL NIP "1181697228"); Stripe expects "PL1181697228".
 */
export function toEuVatValue(country: string, rawTaxId: string): string {
  const cc = country.trim().toUpperCase();
  const v = rawTaxId.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{2}/.test(v) ? v : `${cc}${v}`;
}

/**
 * stripe_tax ONLY: push the buyer's tax location + EU VAT-ID onto the Stripe Customer so
 * `automatic_tax` computes the correct jurisdiction (from the buyer's country) and applies
 * EU B2B reverse charge (when a valid EU VAT number from another member state is present).
 *
 * FAIL-SAFE: a bad/duplicate VAT-ID or any Stripe API error must NEVER throw out of the
 * checkout path. On a tax-id failure Stripe simply charges VAT (the correct, safe fallback).
 * Local tax mode never calls this (manual TaxRates carry the tax there).
 */
export async function applyBuyerTaxIdentityToCustomer(params: {
  stripe: Stripe;
  customerId: string;
  identity: BuyerTaxIdentity;
}): Promise<void> {
  const { stripe, customerId, identity } = params;
  const country = identity.country?.trim().toUpperCase() || null;

  // Without a country Stripe Tax has no jurisdiction to work from — nothing useful to set.
  if (!country) return;

  // 1) Buyer address on the Customer (country is the load-bearing field for Stripe Tax).
  try {
    await stripe.customers.update(customerId, {
      address: {
        country,
        line1: identity.address ?? undefined,
        city: identity.city ?? undefined,
        postal_code: identity.postalCode ?? undefined,
      },
    });
  } catch (e) {
    console.error('[buyer-tax-identity] customer address update failed (non-fatal):', e instanceof Error ? e.message : e);
  }

  // 2) EU VAT-ID → reverse charge. EU countries only; idempotent; never throws.
  const rawTaxId = identity.taxId?.trim();
  if (!rawTaxId || !EU_COUNTRIES.has(country)) return;

  const value = toEuVatValue(country, rawTaxId);
  try {
    const existing = await stripe.customers.listTaxIds(customerId, { limit: 100 });
    if (existing.data.some((t) => t.value === value)) return;
    await stripe.customers.createTaxId(customerId, { type: 'eu_vat', value });
  } catch (e) {
    // tax_id_invalid (malformed/unverifiable VAT) or transient API error → log + continue.
    // Stripe then charges VAT instead of reverse charge, which is the safe legal default.
    console.error('[buyer-tax-identity] tax id attach failed (non-fatal, VAT will be charged):', e instanceof Error ? e.message : e);
  }
}
