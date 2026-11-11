/** Permanent order-license revocations, including already revoked dispute licenses.
 * @see supabase/migrations/20261110235906_release_2026_11_0_fulfillment_orders.sql
 */
import type { createAdminClient } from '@/lib/supabase/admin';

/** Why a license stopped working; `dispute` is recorded by the dispute itself.
 * `expired` = its subscription ended unpaid (natural license expiry is license.expired). */
export type LicenseRevocationReason = 'refund' | 'manual' | 'subscription_cancelled' | 'expired';

// license.updated: emit here for any future non-revocation change (tests/unit/license/license-updated-guard.test.ts).
export async function revokeLicensesForOrder(
  admin: ReturnType<typeof createAdminClient>,
  params: { productId: string; orderIds: (string | null | undefined)[]; reason: LicenseRevocationReason },
): Promise<{ revoked: number }> {
  const orders = [...new Set(params.orderIds.filter((o): o is string => typeof o === 'string' && o.length > 0))];
  if (!orders.length) return { revoked: 0 };
  const result = await admin.rpc('revoke_order_licenses', {
    p_product_id: params.productId, p_order_ids: orders, p_reason: params.reason,
  });
  if (result.error) throw new Error('License revocation failed');
  return { revoked: (result.data ?? []).filter(row => row.changed).length };
}
