/**
 * Different invoice recipient stored with a pending order (order_details.recipient), in the same
 * format the profile checkout writes, so invoices and webhooks read one shape.
 *
 * @see ../checkout-modules/recipient.ts (profile checkout format)
 * @see ../services/webhook-payload.ts (invoice.recipient)
 * @see ../invoicing/input.ts
 */

import type { createAdminClient } from '@/lib/supabase/admin';
import type { InvoiceParty } from '@/lib/checkout/invoice-section';
import type { Json } from '@/types/database';

export type StoredRecipient = { v: 1; differs: false } | ({ v: 1; differs: true } & InvoiceParty);
type AdminClient = Pick<ReturnType<typeof createAdminClient>, 'from'>;

export function toStoredRecipient(party: InvoiceParty | null): StoredRecipient {
  return party ? { v: 1, differs: true, ...party } : { v: 1, differs: false };
}

/** Write the recipient on the pending row only; a completed order is never rewritten. */
export async function saveOrderRecipient(
  admin: AdminClient,
  match: { session_id: string } | { stripe_payment_intent_id: string },
  recipient: StoredRecipient,
): Promise<{ ok: boolean }> {
  try {
    const { data: row, error } = await admin.from('payment_transactions')
      .select('id, order_details').match(match).eq('status', 'pending').maybeSingle();
    if (error) {
      console.error('[saveOrderRecipient] Read failed:', error.message);
      return { ok: false };
    }
    // Subscriptions can have no pending row yet; nothing to attach the recipient to.
    if (!row) return { ok: true };
    const current = row.order_details && typeof row.order_details === 'object' && !Array.isArray(row.order_details) ? row.order_details : {};
    const { error: updateError } = await admin.from('payment_transactions')
      .update({ order_details: { ...current, recipient } as unknown as Json, updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'pending');
    if (updateError) console.error('[saveOrderRecipient] Update failed:', updateError.message);
    return { ok: !updateError };
  } catch (error) {
    console.error('[saveOrderRecipient] Failed:', error instanceof Error ? error.message : 'Unknown error');
    return { ok: false };
  }
}
