/** Delivery-only buyer data for the signed webhook queue. @see services/webhook-service.ts */
import { withCustomerLocale } from '@/lib/webhooks/customer-locale';
import { eventMailData } from '@/lib/events/presentation';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function enrichBuyerWebhook(event: string, input: unknown, db: SupabaseClient<Database>): Promise<unknown> {
  if (event === 'license.issued') {
    const data = input as { license?: { id?: string; orderId?: string | null; order?: string }; customer?: object };
    if (!data?.license?.id) throw new Error('License notification identity unavailable');
    const { data: row, error } = await db.from('issued_licenses').select('license_key,order_id').eq('id', data.license.id).single();
    if (error || !row?.license_key) throw new Error('License notification unavailable');
    input = { ...data, license: { ...data.license, ...(data.license.order || row.order_id ? { order: data.license.order ?? row.order_id } : {}) }, licenseKey: row.license_key };
  }
  input = await withCustomerLocale(event, input, db);
  if (event === 'purchase.completed') {
    const purchase = input as { order?: { orderId?: string }; product?: { id?: string }; customer?: { email?: string; locale?: string } };
    if (!purchase?.order?.orderId || !purchase.product?.id || !purchase.customer?.email) return input;
    const locale = purchase.customer.locale as 'pl' | 'en';
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
  return input;
}
