/** Purchase receipt and entitlement-gated event details. @see @/lib/events/presentation */
import { createAdminClient } from '@/lib/supabase/admin';
import { formatPrice } from '@/lib/constants';
import { fromMinorUnits } from '@/lib/currency/minor-units';
import { eventMailData } from '@/lib/events/presentation';
import { trialMailAmount } from '@/lib/checkout/trial-display';
interface PurchaseMailOptions { allowPending?: boolean; transactionId?: string; /** Poll briefly for a payment still being stored (default); false reads once. */ wait?: boolean }
async function readPurchaseEventMail(email: string, productId: string, sessionId?: string, paymentIntentId?: string, locale = 'en', options: PurchaseMailOptions = {}): Promise<Record<string, string>> {
  const db = createAdminClient();
  let q = db.from('payment_transactions').select('id,amount,currency,subscription_id,session_id,stripe_payment_intent_id,stripe_invoice_id,fulfillment_pending').eq('product_id', productId).eq('customer_email', email).in('status', ['completed', 'partially_refunded']);
  if (options.transactionId) q = q.eq('id', options.transactionId);
  else if (sessionId) q = q.eq('session_id', sessionId);
  else if (paymentIntentId) q = q.eq('stripe_payment_intent_id', paymentIntentId);
  q = q.order('created_at', { ascending: false }).limit(1);
  // A failed read means the purchase is not known yet, not that there is none (W336r P3-2).
  const { data: tx, error } = await q.maybeSingle(); if (error) return { purchase_mail_pending: 'true' }; if (!tx) return {};
  if (tx.fulfillment_pending === true && !options.allowPending) return { purchase_mail_pending: 'true' };
  const { data: product, error: productError } = await db.from('products').select('name').eq('id', productId).maybeSingle();
  // An unreadable product is not a missing purchase: the retry worker would drop the parked link (W351r).
  if (productError) return { purchase_mail_pending: 'true' };
  const receipt: Record<string, string> = product ? { purchase_product: product.name, purchase_amount: formatPrice(fromMinorUnits(tx.amount, tx.currency), tx.currency, locale) } : {};
  if (product && tx.amount === 0 && tx.subscription_id) {
    const { data: subscription } = await db.from('subscriptions').select('status,current_period_start,trial_end').eq('id', tx.subscription_id).eq('product_id', productId).maybeSingle();
    if (subscription?.status === 'trialing') receipt.purchase_amount = trialMailAmount(receipt.purchase_amount, subscription.current_period_start, subscription.trial_end, locale);
  }
  // Fulfillment already sent (or queued) the combined license and sign-in mail.
  const orderIds = [tx.id, tx.session_id, tx.stripe_payment_intent_id, tx.stripe_invoice_id].filter((id): id is string => Boolean(id));
  const licenses = await db.from('issued_licenses').select('id').eq('email', email).in('order_id', orderIds).limit(1);
  if (licenses.error) throw new Error('Purchase mail state unavailable');
  if (licenses.data?.length) receipt.license_mail_managed = 'true';
  // Confirmation can precede content access, including a new subscription buyer.
  const access = await db.rpc('event_mail_access', { p_email: email, p_product_id: productId, p_transaction_id: tx.id });
  if (access.error || access.data !== true) return receipt;
  const { data: rows } = await db.from('seat_reservations').select('event:product_sessions(id,starts_at,timezone,online_url,title)').eq('transaction_id', tx.id).eq('status', 'confirmed');
  return { ...eventMailData((rows ?? []).flatMap(r => r.event ? [r.event] : []), locale),
    ...receipt };
}
/**
 * How long the confirmation page waits for the payment to be stored before composing the first
 * purchase mail. A subscription webhook stores it 2–3 s after the page asks; a shorter wait parked
 * the mail in the retry queue and it arrived minutes later (W351, QA3-G U2).
 */
export const PURCHASE_MAIL_WAIT_MS = 8_000;
const PURCHASE_MAIL_POLL_MS = 250;
/** Wait briefly for payment persistence before composing the first purchase mail. */
export async function purchaseEventMail(email: string, productId: string, sessionId?: string, paymentIntentId?: string, locale = 'en', options: PurchaseMailOptions = {}): Promise<Record<string, string>> {
  const deadline = Date.now() + (options.wait === false ? 0 : PURCHASE_MAIL_WAIT_MS);
  for (let attempt = 1; ; attempt++) {
    const data = await readPurchaseEventMail(email.trim().toLowerCase(), productId, sessionId, paymentIntentId, locale, options);
    if (data.purchase_product && data.purchase_amount) {
      if (attempt > 1) console.info(`[purchase-mail] context ready after ${attempt} attempts`);
      return data;
    }
    const last = Date.now() + PURCHASE_MAIL_POLL_MS > deadline;
    if (last && data.purchase_mail_pending === 'true') return data;
    if (last) break;
    await new Promise(resolve => setTimeout(resolve, PURCHASE_MAIL_POLL_MS));
  }
  console.info('[purchase-mail] context not ready');
  const { data: product, error } = await createAdminClient().from('products').select('issue_license_on_purchase').eq('id', productId).maybeSingle();
  return error || product?.issue_license_on_purchase ? { purchase_mail_pending: 'true' } : {};
}
export async function eventMailForSlug(email: string, slug: string, locale = 'en', options: Pick<PurchaseMailOptions, 'wait'> = {}): Promise<Record<string, string>> {
  const { data, error } = await createAdminClient().from('products').select('id').eq('slug', slug).maybeSingle();
  if (error) return { purchase_mail_pending: 'true' };
  return data ? purchaseEventMail(email.trim().toLowerCase(), data.id, undefined, undefined, locale, options) : {};
}
