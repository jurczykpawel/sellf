/**
 * Buyer details stored with the order (payment_transactions.order_details.buyer).
 *
 * The one-time checkout form stores them on the pending row before confirmation;
 * backfillBuyerDetails fills missing paid-order details from Stripe metadata.
 *
 * @see supabase/migrations/20261110235902_release_2026_11_0_orders_events.sql
 * @see src/app/api/update-payment-metadata/route.ts
 */

import { sanitizeMetadataField } from '@/lib/stripe/security';
import type { createAdminClient } from '@/lib/supabase/admin';
import type Stripe from 'stripe';

type AdminClient = ReturnType<typeof createAdminClient>;

// `type` (not interface): the value is stored as JSON and must be assignable to Json.
export type BuyerDetails = {
  v: 1;
  first_name: string;
  last_name: string;
  full_name: string;
  needs_invoice: boolean;
  nip: string;
  company_name: string;
  address: string;
  city: string;
  postal_code: string;
  country: string;
  terms_accepted: boolean;
  source: 'checkout' | 'stripe_metadata';
  saved_at: string;
};

export interface RawBuyerInput {
  firstName?: unknown;
  lastName?: unknown;
  fullName?: unknown;
  termsAccepted?: unknown;
  needsInvoice?: unknown;
  nip?: unknown;
  companyName?: unknown;
  address?: unknown;
  city?: unknown;
  postalCode?: unknown;
  country?: unknown;
}

const text = (value: unknown, max: number): string =>
  sanitizeMetadataField(typeof value === 'string' ? value : undefined, max);

export function buildBuyerDetails(input: RawBuyerInput, source: BuyerDetails['source']): BuyerDetails {
  let firstName = text(input.firstName, 100);
  let lastName = text(input.lastName, 100);
  const fullNameInput = text(input.fullName, 200);

  if (fullNameInput && !firstName && !lastName) {
    const [first, ...rest] = fullNameInput.split(/\s+/);
    firstName = first;
    lastName = rest.join(' ');
  }

  return {
    v: 1,
    first_name: firstName,
    last_name: lastName,
    full_name: fullNameInput || `${firstName} ${lastName}`.trim(),
    needs_invoice: input.needsInvoice === true,
    nip: text(input.nip, 20),
    company_name: text(input.companyName, 200),
    address: text(input.address, 300),
    city: text(input.city, 100),
    postal_code: text(input.postalCode, 20),
    country: text(input.country, 100),
    terms_accepted: input.termsAccepted === true,
    source,
    saved_at: new Date().toISOString(),
  };
}

/**
 * Fill order_details.buyer from Stripe data for a stored session or invoice key.
 * Idempotent (the database leaves an existing buyer untouched) and never throws:
 * fulfilment must not depend on it.
 */
export async function backfillBuyerDetails(
  supabase: AdminClient,
  input: {
    sessionId: string;
    metadata: Stripe.Metadata | null | undefined;
    customerDetails: Stripe.Checkout.Session.CustomerDetails | null | undefined;
  },
): Promise<void> {
  try {
    const meta = input.metadata ?? {};
    const details = input.customerDetails;
    const buyer = buildBuyerDetails(
      {
        firstName: meta.first_name,
        lastName: meta.last_name,
        fullName: meta.full_name || details?.name,
        termsAccepted: meta.terms_accepted === 'true',
        needsInvoice: meta.needs_invoice === 'true',
        nip: meta.nip || details?.tax_ids?.[0]?.value,
        companyName: meta.company_name || details?.business_name,
        address: meta.address || details?.address?.line1,
        city: meta.city || details?.address?.city,
        postalCode: meta.postal_code || details?.address?.postal_code,
        country: meta.country || details?.address?.country,
      },
      'stripe_metadata',
    );

    const { error } = await supabase.rpc('set_payment_order_buyer', {
      p_buyer: buyer,
      p_session_id: input.sessionId,
      p_only_if_missing: true,
    });
    if (error) {
      console.error('[backfillBuyerDetails] Failed to save buyer details:', error.message);
    }
  } catch (error) {
    console.error('[backfillBuyerDetails] Failed:', error instanceof Error ? error.message : 'Unknown error');
  }
}
