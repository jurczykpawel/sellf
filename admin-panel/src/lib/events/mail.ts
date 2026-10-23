/** Event details for a verified purchase email. @see @/lib/events/presentation */
import { createAdminClient } from '@/lib/supabase/admin';
import { eventMailData } from '@/lib/events/presentation';
export async function purchaseEventMail(email: string, productId: string, sessionId?: string, paymentIntentId?: string): Promise<Record<string, string>> {
  const db = createAdminClient();
  let q = db.from('payment_transactions').select('id').eq('product_id', productId).eq('customer_email', email).eq('status', 'completed');
  if (sessionId) q = q.eq('session_id', sessionId);
  else if (paymentIntentId) q = q.eq('stripe_payment_intent_id', paymentIntentId);
  q = q.order('created_at', { ascending: false }).limit(1);
  const { data: tx, error } = await q.maybeSingle(); if (error || !tx) return {};
  const access = await db.rpc('event_mail_access', { p_email: email, p_product_id: productId, p_transaction_id: tx.id });
  if (access.error || access.data !== true) return {};
  const { data: rows } = await db.from('seat_reservations').select('event:product_sessions(id,starts_at,timezone,online_url,title)').eq('transaction_id', tx.id).eq('status', 'confirmed');
  return eventMailData((rows ?? []).flatMap(r => r.event ? [r.event] : []));
}
export async function eventMailForSlug(email: string, slug: string): Promise<Record<string, string>> {
  const { data } = await createAdminClient().from('products').select('id').eq('slug', slug).eq('event_mode', true).maybeSingle();
  return data ? purchaseEventMail(email.trim().toLowerCase(), data.id) : {};
}
