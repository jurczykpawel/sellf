/**
 * Online payment of an unpaid transfer order from the signed order link (mail, reminder, webhook payUrl).
 * Unpaid → the saved amount (price and seat stay reserved). Cancelled → the same order at its saved price only when
 * that price is still current and seats remain; otherwise the buyer starts a new checkout at today's price.
 * @see migration 20261103150000_unpaid_order_reservations.sql (open/complete_order_payment_attempt)
 */
import { dispatchTransferEvent, fulfillTransfer } from '@/lib/orders/bank-transfer-service';
import { getEffectiveUnitPrice } from '@/lib/services/omnibus';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type Db = SupabaseClient<Database>;
export interface QuickPayOrder { id: string; payment_provider: string; status: string; amount: number; currency: string; product_id: string; coupon_id: string | null; order_number: number | null; customer_email: string }
export type QuickPayQuote =
  | { mode: 'settle' | 'reopen'; amount: number; currency: string }
  | { mode: 'paid' }
  | { mode: 'unavailable'; reason: 'not_payable' | 'invoice_corrected' | 'product_unavailable' | 'sold_out' | 'price_changed' | 'coupon_unavailable' };
const ATTEMPT_MINUTES = 30;
const unavailable = (reason: Extract<QuickPayQuote, { mode: 'unavailable' }>['reason']): QuickPayQuote => ({ mode: 'unavailable', reason });

export async function quoteOrderPayment(db: Db, tx: QuickPayOrder, now: Date): Promise<QuickPayQuote> {
  if (tx.payment_provider !== 'bank_transfer') return unavailable('not_payable');
  if (tx.status === 'completed' || tx.status === 'partially_refunded') return { mode: 'paid' };
  if (tx.status === 'awaiting_payment') return { mode: 'settle', amount: tx.amount, currency: tx.currency };
  if (tx.status !== 'cancelled') return unavailable('not_payable');
  const invoice = await db.from('invoices').select('status').eq('transaction_id', tx.id).maybeSingle();
  if (invoice.data?.status === 'corrected') return unavailable('invoice_corrected');
  const { data: product } = await db.from('products').select('id,is_active,price,sale_price,sale_price_until,event_mode').eq('id', tx.product_id).single();
  if (!product?.is_active) return unavailable('product_unavailable');
  const { data: lines } = await db.from('payment_line_items').select('product_id,item_type,quantity,unit_price,session_id').eq('transaction_id', tx.id);
  const main = (lines ?? []).find(l => l.item_type === 'main_product');
  if (!main) return unavailable('not_payable');
  if (main.session_id) {
    const { data } = await db.rpc('event_availability', { p_product_id: tx.product_id, p_at: now.toISOString() });
    const session = (data as Array<{ id: string; starts_at: string; remaining: number | null; sold_out: boolean; current_tier: { price: number } | null }> | null)?.find(s => s.id === main.session_id);
    if (!session || session.sold_out || Date.parse(session.starts_at) <= now.getTime() || (session.remaining !== null && session.remaining < main.quantity) || !session.current_tier) return unavailable('sold_out');
    if (Number(session.current_tier.price) !== Number(main.unit_price)) return unavailable('price_changed');
  } else if (Number(getEffectiveUnitPrice(product)) !== Number(main.unit_price)) return unavailable('price_changed');
  if (tx.coupon_id) {
    const { data: coupon } = await db.from('coupons').select('is_active,usage_limit_global,current_usage_count,expires_at').eq('id', tx.coupon_id).maybeSingle();
    if (!coupon?.is_active || (coupon.expires_at && Date.parse(coupon.expires_at) <= now.getTime())
      || (coupon.usage_limit_global !== null && coupon.current_usage_count >= coupon.usage_limit_global)) return unavailable('coupon_unavailable');
  }
  return { mode: 'reopen', amount: tx.amount, currency: tx.currency };
}

export async function createQuickPaySession(db: Db, stripe: Stripe, tx: QuickPayOrder, quote: Extract<QuickPayQuote, { amount: number }>,
  opts: { baseUrl: string; returnUrl: string; now: Date; productName: string }): Promise<{ url: string }> {
  const expires = new Date(opts.now.getTime() + ATTEMPT_MINUTES * 60000);
  const { data, error } = await db.rpc('open_order_payment_attempt', { p_id: tx.id, p_kind: quote.mode, p_amount: quote.amount, p_currency: quote.currency,
    p_expires_at: expires.toISOString(), p_now: opts.now.toISOString() });
  const attempt = data as { id: string; reused: boolean; status: string; checkout_url?: string | null } | null;
  if (error || !attempt) throw new Error('Payment attempt unavailable');
  if (attempt.reused && attempt.checkout_url) return { url: attempt.checkout_url };
  const metadata = { sellf_payment_attempt: attempt.id, sellf_order: tx.id };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', customer_email: tx.customer_email, expires_at: Math.floor(expires.getTime() / 1000),
    line_items: [{ quantity: 1, price_data: { currency: quote.currency.toLowerCase(), unit_amount: quote.amount,
      product_data: { name: `${opts.productName} — #${tx.order_number ?? ''}`.slice(0, 250) } } }],
    metadata, payment_intent_data: { metadata },
    success_url: opts.returnUrl, cancel_url: opts.returnUrl,
  }, { idempotencyKey: `sellf-quickpay-${attempt.id}` });
  if (!session.url) throw new Error('Checkout URL missing');
  const attached = await db.rpc('attach_order_payment_session', { p_attempt: attempt.id, p_session_id: session.id, p_url: session.url });
  if (attached.error) throw new Error('Payment attempt state unavailable');
  return { url: session.url };
}

export function isQuickPayObject(object: { metadata?: Stripe.Metadata | null }): boolean {
  return typeof object.metadata?.sellf_payment_attempt === 'string' && object.metadata.sellf_payment_attempt.length > 0;
}

/** Webhook entry for quick-pay objects. Throws on a transient failure so Stripe redelivers. */
export async function handleQuickPayEvent(db: Db, stripe: Stripe, type: string, object: Stripe.Checkout.Session | Stripe.PaymentIntent, now: Date): Promise<{ processed: boolean; message: string }> {
  // Completion is driven by the Checkout session; the PaymentIntent event of the same payment is only acknowledged.
  if (object.object !== 'checkout.session') return { processed: true, message: 'Quick pay: handled by checkout session' };
  const session = object as Stripe.Checkout.Session;
  const attemptId = session.metadata!.sellf_payment_attempt;
  if (type === 'checkout.session.expired') {
    await db.rpc('expire_order_payment_attempt', { p_session_id: session.id });
    return { processed: true, message: 'Quick pay attempt expired' };
  }
  if (session.payment_status !== 'paid') return { processed: true, message: 'Quick pay: payment not yet paid' };
  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntent || session.amount_total === null) return { processed: false, message: 'Quick pay: payment details missing' };
  const { data, error } = await db.rpc('complete_order_payment_attempt', { p_attempt: attemptId, p_session_id: session.id, p_payment_intent: paymentIntent,
    p_amount: session.amount_total, p_now: now.toISOString() });
  const result = data as { result: 'completed' | 'already' | 'duplicate'; transaction_id: string; reopened?: boolean; refund_id?: string | null } | null;
  if (error || !result) throw new Error('Quick pay completion unavailable');
  if (result.result === 'duplicate') {
    if (!result.refund_id) {
      const refund = await stripe.refunds.create({ payment_intent: paymentIntent, reason: 'duplicate', metadata: { sellf_payment_attempt: attemptId } },
        { idempotencyKey: `sellf-dup-refund-${attemptId}` });
      const saved = await db.rpc('record_order_payment_refund', { p_attempt: attemptId, p_refund_id: refund.id });
      if (saved.error) throw new Error('Duplicate refund state unavailable');
      console.error('[quick-pay] Duplicate payment refunded:', result.transaction_id, refund.id);
    }
    return { processed: true, message: 'Quick pay duplicate refunded' };
  }
  if (result.result === 'completed' && result.reopened) await dispatchTransferEvent(db, result.transaction_id, 'order.reopened');
  if (result.result === 'completed') await fulfillTransfer(db, result.transaction_id);
  return { processed: true, message: `Quick pay ${result.result}` };
}
