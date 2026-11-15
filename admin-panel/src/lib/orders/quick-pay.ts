/**
 * Online payment of an unpaid transfer order from the signed order link (mail, reminder, webhook payUrl): the saved
 * amount, price and seat stay reserved. A cancelled order is never payable by the buyer (W254, owner 14/15.11.2026),
 * whatever the reason; only the administrator can accept a late transfer (see late-transfer-preview.ts). Past the
 * reservation deadline no new online payment starts (W254b); the order waits for the release job.
 * @see migration 20261115110000_cancelled_order_no_payment.sql (open/complete_order_payment_attempt)
 */
import { fulfillTransfer } from '@/lib/orders/bank-transfer-service';
import { expireOrderPaymentSessions } from '@/lib/orders/payment-attempt-sessions';
import { stripeInstanceMetadata } from '@/lib/stripe/instance-marker';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type Db = SupabaseClient<Database>;
export interface QuickPayOrder { id: string; payment_provider: string; status: string; amount: number; currency: string; product_id: string | null; coupon_id: string | null; order_number: number | null; customer_email: string }
export type QuickPayQuote =
  | { mode: 'settle'; amount: number; currency: string }
  | { mode: 'paid' }
  | { mode: 'unavailable'; reason: 'not_payable' | 'order_cancelled' | 'product_unavailable' | 'payment_window_closed' };
const ATTEMPT_MINUTES = 30;
const unavailable = (reason: Extract<QuickPayQuote, { mode: 'unavailable' }>['reason']): QuickPayQuote => ({ mode: 'unavailable', reason });

export function quoteOrderPayment(tx: Pick<QuickPayOrder, 'payment_provider' | 'status' | 'amount' | 'currency' | 'product_id'> & { release_at?: string | null },
  now: Date = new Date()): QuickPayQuote {
  if (tx.payment_provider !== 'bank_transfer') return unavailable('not_payable');
  if (tx.status === 'completed' || tx.status === 'partially_refunded') return { mode: 'paid' };
  if (tx.status === 'cancelled') return unavailable('order_cancelled');
  if (!tx.product_id) return unavailable('product_unavailable');
  // Same rule as open_order_payment_attempt; the server refuses a new attempt either way.
  if (tx.status === 'awaiting_payment' && tx.release_at && Date.parse(tx.release_at) <= now.getTime()) return unavailable('payment_window_closed');
  if (tx.status === 'awaiting_payment') return { mode: 'settle', amount: tx.amount, currency: tx.currency };
  return unavailable('not_payable');
}

export async function createQuickPaySession(db: Db, stripe: Stripe, tx: QuickPayOrder, quote: Extract<QuickPayQuote, { amount: number }>,
  opts: { baseUrl: string; returnUrl: string; now: Date; productName: string }): Promise<{ url: string }> {
  const expires = new Date(opts.now.getTime() + ATTEMPT_MINUTES * 60000);
  const { data, error } = await db.rpc('open_order_payment_attempt', { p_id: tx.id, p_kind: quote.mode, p_amount: quote.amount, p_currency: quote.currency,
    p_expires_at: expires.toISOString(), p_now: opts.now.toISOString() });
  const attempt = data as { id: string; reused: boolean; status: string; checkout_url?: string | null } | null;
  if (error || !attempt) throw new Error('Payment attempt unavailable');
  if (attempt.reused && attempt.checkout_url) return { url: attempt.checkout_url };
  const metadata = { sellf_payment_attempt: attempt.id, sellf_order: tx.id, ...(await stripeInstanceMetadata()) };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment', customer_email: tx.customer_email, expires_at: Math.floor(expires.getTime() / 1000),
    line_items: [{ quantity: 1, price_data: { currency: quote.currency.toLowerCase(), unit_amount: quote.amount,
      product_data: { name: `${opts.productName} — #${tx.order_number ?? ''}`.slice(0, 250) } } }],
    metadata, payment_intent_data: { metadata },
    success_url: opts.returnUrl, cancel_url: opts.returnUrl,
  }, { idempotencyKey: `sellf-quickpay-${attempt.id}` });
  if (!session.url) throw new Error('Checkout URL missing');
  const attached = await db.rpc('attach_order_payment_session', { p_attempt: attempt.id, p_session_id: session.id, p_url: session.url });
  if (attached.error) {
    // The order was closed (cancelled or paid) while the session was being created: never show this page.
    await expireOrderPaymentSessions(async () => stripe, [session.id]);
    throw new Error('Payment attempt state unavailable');
  }
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
  const result = data as { result: 'completed' | 'already' | 'duplicate'; transaction_id: string; refund_id?: string | null } | null;
  if (error || !result) throw new Error('Quick pay completion unavailable');
  if (result.result === 'duplicate') {
    if (!result.refund_id) {
      const refund = await stripe.refunds.create({ payment_intent: paymentIntent, reason: 'duplicate', metadata: { sellf_payment_attempt: attemptId, ...(await stripeInstanceMetadata()) } },
        { idempotencyKey: `sellf-dup-refund-${attemptId}` });
      const saved = await db.rpc('record_order_payment_refund', { p_attempt: attemptId, p_refund_id: refund.id });
      if (saved.error) throw new Error('Duplicate refund state unavailable');
      console.error('[quick-pay] Duplicate payment refunded:', result.transaction_id, refund.id);
    }
    return { processed: true, message: 'Quick pay duplicate refunded' };
  }
  if (result.result === 'completed') await fulfillTransfer(db, result.transaction_id);
  return { processed: true, message: `Quick pay ${result.result}` };
}
