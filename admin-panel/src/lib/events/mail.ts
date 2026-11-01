/** Purchase receipt and entitlement-gated event details. @see @/lib/events/presentation */
import { createAdminClient } from '@/lib/supabase/admin';
import { formatPrice } from '@/lib/constants';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import { eventMailData } from '@/lib/events/presentation';
async function readPurchaseEventMail(email: string, productId: string, sessionId?: string, paymentIntentId?: string, locale = 'en'): Promise<Record<string, string>> {
  const db = createAdminClient();
  let q = db.from('payment_transactions').select('id,amount,currency').eq('product_id', productId).eq('customer_email', email).eq('status', 'completed');
  if (sessionId) q = q.eq('session_id', sessionId);
  else if (paymentIntentId) q = q.eq('stripe_payment_intent_id', paymentIntentId);
  q = q.order('created_at', { ascending: false }).limit(1);
  const { data: tx, error } = await q.maybeSingle(); if (error || !tx) return {};
  const { data: product } = await db.from('products').select('name').eq('id', productId).maybeSingle();
  const receipt: Record<string, string> = product ? { purchase_product: product.name, purchase_amount: formatPrice(fromMinorUnits(tx.amount, tx.currency), tx.currency, locale) } : {};
  // Confirmation can precede content access, including a new subscription buyer.
  const access = await db.rpc('event_mail_access', { p_email: email, p_product_id: productId, p_transaction_id: tx.id });
  if (access.error || access.data !== true) return receipt;
  const { data: rows } = await db.from('seat_reservations').select('event:product_sessions(id,starts_at,timezone,online_url,title)').eq('transaction_id', tx.id).eq('status', 'confirmed');
  return { ...eventMailData((rows ?? []).flatMap(r => r.event ? [r.event] : []), locale),
    ...receipt };
}
/** Wait briefly for payment persistence before composing the first purchase mail. */
export async function purchaseEventMail(email: string, productId: string, sessionId?: string, paymentIntentId?: string, locale = 'en'): Promise<Record<string, string>> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const data = await readPurchaseEventMail(email.trim().toLowerCase(), productId, sessionId, paymentIntentId, locale);
    if (data.purchase_product && data.purchase_amount) {
      if (attempt) console.info(`[purchase-mail] context ready after ${attempt + 1} attempts`);
      return data;
    }
    if (attempt < 9) await new Promise(resolve => setTimeout(resolve, 250));
  }
  console.info('[purchase-mail] context not ready');
  return {};
}
export async function eventMailForSlug(email: string, slug: string, locale = 'en'): Promise<Record<string, string>> {
  const { data } = await createAdminClient().from('products').select('id').eq('slug', slug).maybeSingle();
  return data ? purchaseEventMail(email.trim().toLowerCase(), data.id, undefined, undefined, locale) : {};
}
