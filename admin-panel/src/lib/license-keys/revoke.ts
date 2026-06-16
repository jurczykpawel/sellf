import type { createAdminClient } from '@/lib/supabase/admin';
import type { RevokedLicenseRow } from '@/lib/services/license-revoke-webhook-payload';

type AdminClient = ReturnType<typeof createAdminClient>;

// Same projection the manual-revoke route returns, so both paths can feed the
// identical `license.revoked` webhook payload builder.
const REVOKED_ROW_COLUMNS =
  'id, product_id, email, order_id, seller_id, license_domain, issuance_source, issued_at, expires_at, revoked_at, products(name, slug, license_tier)';

/**
 * Revoke any issued licenses tied to a product + order (refund / chargeback). Idempotent —
 * only flips rows whose `revoked_at` is still null, so replays are no-ops. Database failures
 * throw so retriable Stripe refund/dispute events are redelivered instead of acknowledging a
 * refund while its offline license remains active. Once revoked, the public CRL publishes the
 * SHA-256 order hash and consumers compare it with SHA-256(token.order).
 *
 * `orderIds` accepts both the payment-intent id and the session id because issuance keys the
 * license on `paymentIntentId || sessionId` — passing both reliably matches the row.
 *
 * Returns the revoked rows (only the ones actually flipped) so the caller can fire the
 * `license.revoked` webhook. The webhook is NOT fired here: notifying integrations must never
 * make this retriable path throw.
 */
export async function revokeLicensesForOrder(
  admin: AdminClient,
  params: { productId: string; orderIds: (string | null | undefined)[] },
): Promise<{ revoked: number; rows: RevokedLicenseRow[] }> {
  const orders = [...new Set(params.orderIds.filter((o): o is string => typeof o === 'string' && o.length > 0))];
  if (orders.length === 0) return { revoked: 0, rows: [] };

  const { data, error } = await admin
    .from('issued_licenses')
    .update({ revoked_at: new Date().toISOString() })
    .eq('product_id', params.productId)
    .in('order_id', orders)
    .is('revoked_at', null)
    .select(REVOKED_ROW_COLUMNS);

  if (error) {
    console.error('[revokeLicensesForOrder] Error:', error.message);
    throw new Error('License revocation failed');
  }
  const rows = (data ?? []) as unknown as RevokedLicenseRow[];
  return { revoked: rows.length, rows };
}
