/** Delivery-only buyer data for the signed webhook queue. @see services/webhook-service.ts */
import { eventMailData } from '@/lib/events/presentation';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function enrichBuyerWebhook(event: string, input: unknown, db: SupabaseClient<Database>): Promise<unknown> {
  if (event === 'purchase.completed') {
    const purchase = input as { order?: { orderId?: string }; product?: { id?: string }; customer?: { email?: string; locale?: string } };
    if (!purchase?.order?.orderId || !purchase.product?.id || !purchase.customer?.email) return input;
    let locale = purchase.customer.locale;
    if (locale !== 'pl' && locale !== 'en') {
      const { data: tx, error } = await db.from('payment_transactions').select('metadata').eq('id', purchase.order.orderId).single();
      if (error || !tx) throw new Error('Purchase notification unavailable');
      locale = (tx.metadata as Record<string, unknown> | null)?.locale === 'pl' ? 'pl' : 'en';
    }
    const access = await db.rpc('event_mail_access', { p_email: purchase.customer.email, p_product_id: purchase.product.id, p_transaction_id: purchase.order.orderId });
    if (access.error) throw new Error('Purchase notification access unavailable');
    let buyerMail: Record<string, string> = {};
    if (access.data === true) {
      const { data: rows, error: sessionsError } = await db.from('seat_reservations')
        .select('event:product_sessions(id,starts_at,timezone,online_url,title)').eq('transaction_id', purchase.order.orderId).eq('status', 'confirmed');
      if (sessionsError) throw new Error('Purchase notification sessions unavailable');
      buyerMail = eventMailData((rows ?? []).flatMap((row) => row.event ? [row.event] : []), locale);
    }
    return { ...purchase, customer: { ...purchase.customer, locale }, buyerMail };
  }
  if (event !== 'license.issued') return input;
  const data = input as { license?: { id?: string } };
  if (!data?.license?.id) throw new Error('License notification identity unavailable');
  const { data: row, error } = await db.from('issued_licenses').select('license_key').eq('id', data.license.id).single();
  if (error || !row?.license_key) throw new Error('License notification unavailable');
  return { ...data, licenseKey: row.license_key };
}
