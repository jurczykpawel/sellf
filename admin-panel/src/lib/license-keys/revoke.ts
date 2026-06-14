import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Revoke any issued licenses tied to a product + order (refund / chargeback). Idempotent —
 * only flips rows whose `revoked_at` is still null, so replays are no-ops. Fail-safe: logs and
 * returns 0 on error so it can never break the payment webhook. Once revoked, the public CRL
 * (`/api/licenses/revoked`) publishes the order id and offline consumers refuse the token on
 * their next refresh.
 *
 * `orderIds` accepts both the payment-intent id and the session id because issuance keys the
 * license on `paymentIntentId || sessionId` — passing both reliably matches the row.
 */
export async function revokeLicensesForOrder(
  admin: AdminClient,
  params: { productId: string; orderIds: (string | null | undefined)[] },
): Promise<{ revoked: number }> {
  const orders = [...new Set(params.orderIds.filter((o): o is string => typeof o === 'string' && o.length > 0))];
  if (orders.length === 0) return { revoked: 0 };

  const { data, error } = await admin
    .from('issued_licenses')
    .update({ revoked_at: new Date().toISOString() })
    .eq('product_id', params.productId)
    .in('order_id', orders)
    .is('revoked_at', null)
    .select('id');

  if (error) {
    console.error('[revokeLicensesForOrder] Error:', error.message);
    return { revoked: 0 };
  }
  return { revoked: data?.length ?? 0 };
}
