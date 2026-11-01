/** Permanent order-license revocations, including already revoked dispute licenses.
 * @see supabase/migrations/20261101141003_license_dispute_restoration.sql
 */
import type { createAdminClient } from '@/lib/supabase/admin';

export async function revokeLicensesForOrder(
  admin: ReturnType<typeof createAdminClient>,
  params: { productId: string; orderIds: (string | null | undefined)[] },
): Promise<{ revoked: number }> {
  const orders = [...new Set(params.orderIds.filter((o): o is string => typeof o === 'string' && o.length > 0))];
  if (!orders.length) return { revoked: 0 };
  const found = await admin.from('issued_licenses').select('id').eq('product_id', params.productId).in('order_id', orders);
  if (found.error) throw new Error('License revocation failed');
  if (!found.data?.length) return { revoked: 0 };
  const result = await admin.rpc('revoke_issued_licenses', { p_license_ids: found.data.map(row => row.id) });
  if (result.error) throw new Error('License revocation failed');
  return { revoked: (result.data ?? []).filter(row => row.changed).length };
}
