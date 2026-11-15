/** Online payment of an unpaid transfer order: quote per order state, Stripe session, webhook completion. Stripe events are clones
 * of the recorded checkout.session.completed (fixtures/stripe/checkout_completed_receiver.json) changing only the exercised fields. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const dispatch = vi.hoisted(() => vi.fn());
const fulfill = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orders/bank-transfer-service', () => ({ dispatchTransferEvent: dispatch, fulfillTransfer: fulfill }));
import recorded from '../../fixtures/stripe/checkout_completed_receiver.json';
import quickPay from '../../fixtures/stripe/quick_pay_checkout_completed.json';
import { quoteOrderPayment, createQuickPaySession, handleQuickPayEvent, isQuickPayObject } from '@/lib/orders/quick-pay';
import { expireOrderPaymentSessions } from '@/lib/orders/payment-attempt-sessions';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const id = '10000000-0000-4000-8000-000000000001', attemptId = '20000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-02-02T12:00:00Z');
const tx = { id, payment_provider: 'bank_transfer', status: 'awaiting_payment', amount: 8000, currency: 'PLN', product_id: 'p1', coupon_id: null as string | null, order_number: 1001, customer_email: 'buyer@example.com', metadata: { locale: 'pl' } };
function db(tables: Record<string, unknown>, rpcs: Record<string, unknown> = {}) {
  const rpc = vi.fn(async (name: string) => ({ data: typeof rpcs[name] === 'function' ? (rpcs[name] as () => unknown)() : rpcs[name] ?? null, error: null }));
  const from = vi.fn((table: string) => {
    const result = { data: tables[table] ?? null, error: null };
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) q[m] = () => q;
    q.single = async () => ({ ...result, data: Array.isArray(result.data) ? result.data[0] : result.data });
    q.maybeSingle = q.single;
    q.then = (resolve: (v: unknown) => void) => resolve(result);
    return q;
  });
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, rpc };
}

beforeEach(() => { vi.clearAllMocks(); dispatch.mockResolvedValue(undefined); fulfill.mockResolvedValue(undefined); });

describe('quote', () => {
  it('an unpaid order is paid at its saved amount without re-pricing', () => {
    expect(quoteOrderPayment(tx)).toEqual({ mode: 'settle', amount: 8000, currency: 'PLN' });
  });
  // W254 (owner 14/15.11): a cancelled order is never payable by the buyer, whatever the reason and even when price,
  // seats and coupon are unchanged. Only the administrator can accept a late transfer.
  it.each([
    ['released by the reservation timer', 'payment_window_expired'],
    ['cancelled by the administrator', 'admin'],
  ])('cancelled order (%s) is refused although price and seats are unchanged', (_, cancelReason) => {
    expect(quoteOrderPayment({ ...tx, status: 'cancelled', cancel_reason: cancelReason } as typeof tx)).toEqual({ mode: 'unavailable', reason: 'order_cancelled' });
  });
  it('a paid order reports paid', () => {
    expect(quoteOrderPayment({ ...tx, status: 'completed' })).toEqual({ mode: 'paid' });
  });
});

describe('session', () => {
  it('opens one attempt and a 30 minute Stripe Checkout session for the exact amount with an idempotency key', async () => {
    const { client, rpc } = db({}, { open_order_payment_attempt: { id: attemptId, reused: false, status: 'opening' } });
    const create = vi.fn(async () => ({ id: 'cs_quick', url: 'https://checkout.stripe.com/c/pay/cs_quick' }));
    const stripe = { checkout: { sessions: { create } } } as unknown as Stripe;
    const result = await createQuickPaySession(client, stripe, tx, { mode: 'settle', amount: 8000, currency: 'PLN' }, { baseUrl: 'https://shop.example', returnUrl: 'https://shop.example/pl/order/x/transfer?token=t', now: NOW, productName: 'Warsztat' });
    expect(result).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_quick' });
    expect(rpc).toHaveBeenCalledWith('open_order_payment_attempt', expect.objectContaining({ p_id: id, p_kind: 'settle', p_amount: 8000, p_currency: 'PLN', p_expires_at: '2026-02-02T12:30:00.000Z' }));
    const [params, options] = create.mock.calls[0] as unknown as [Stripe.Checkout.SessionCreateParams, Stripe.RequestOptions];
    expect(params).toMatchObject({ mode: 'payment', customer_email: 'buyer@example.com', expires_at: Math.floor(NOW.getTime() / 1000) + 1800,
      metadata: { sellf_payment_attempt: attemptId, sellf_order: id }, payment_intent_data: { metadata: { sellf_payment_attempt: attemptId, sellf_order: id } } });
    expect(params.line_items?.[0]).toMatchObject({ quantity: 1, price_data: { currency: 'pln', unit_amount: 8000 } });
    expect(options).toEqual({ idempotencyKey: `sellf-quickpay-${attemptId}` });
    expect(rpc).toHaveBeenCalledWith('attach_order_payment_session', { p_attempt: attemptId, p_session_id: 'cs_quick', p_url: 'https://checkout.stripe.com/c/pay/cs_quick' });
  });
  it('a session created after the order was cancelled meanwhile is expired at once and never shown to the buyer', async () => {
    const { client } = db({}, { open_order_payment_attempt: { id: attemptId, reused: false, status: 'opening' } });
    (client.rpc as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (name: string) => name === 'attach_order_payment_session'
      ? { data: null, error: { message: 'Attempt not opening' } } : { data: { id: attemptId, reused: false, status: 'opening' }, error: null });
    const create = vi.fn(async () => ({ id: 'cs_late', url: 'https://checkout.stripe.com/c/pay/cs_late' })), expire = vi.fn(async () => ({}));
    await expect(createQuickPaySession(client, { checkout: { sessions: { create, expire } } } as unknown as Stripe, tx, { mode: 'settle', amount: 8000, currency: 'PLN' },
      { baseUrl: 'https://shop.example', returnUrl: 'https://shop.example/r', now: NOW, productName: 'W' })).rejects.toThrow();
    expect(expire).toHaveBeenCalledWith('cs_late');
  });
  it('closing payment attempts expires every named Stripe session; one failure does not stop the others', async () => {
    const expire = vi.fn(async (sid: string) => { if (sid === 'cs_done') throw new Error('Session already complete'); return {}; });
    const stripe = { checkout: { sessions: { expire } } } as unknown as Stripe;
    await expect(expireOrderPaymentSessions(async () => stripe, ['cs_done', 'cs_open'])).resolves.toEqual({ expired: ['cs_open'], failed: ['cs_done'] });
    expect(expire).toHaveBeenCalledTimes(2);
    const lazy = vi.fn(async () => stripe);
    await expireOrderPaymentSessions(lazy, []); expect(lazy).not.toHaveBeenCalled();
  });
  it('a second click reuses the open session', async () => {
    const { client } = db({}, { open_order_payment_attempt: { id: attemptId, reused: true, status: 'open', checkout_url: 'https://checkout.stripe.com/c/pay/cs_old' } });
    const create = vi.fn();
    expect(await createQuickPaySession(client, { checkout: { sessions: { create } } } as unknown as Stripe, tx, { mode: 'settle', amount: 8000, currency: 'PLN' },
      { baseUrl: 'https://shop.example', returnUrl: 'https://shop.example/r', now: NOW, productName: 'W' })).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_old' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('webhook completion', () => {
  // Real quick-pay checkout.session.completed (test mode, 170 PLN); only payment_status varies per case.
  const event = (status = 'paid') => ({ ...quickPay.data.object, payment_status: status }) as unknown as Stripe.Checkout.Session;
  it('only Sellf quick-pay objects are routed here', () => {
    expect(isQuickPayObject(recorded.data.object as unknown as Stripe.Checkout.Session)).toBe(false);
    expect(isQuickPayObject(event())).toBe(true);
  });
  it('a paid session completes the order and runs the normal purchase delivery', async () => {
    const { client, rpc } = db({}, { complete_order_payment_attempt: { result: 'completed', transaction_id: id, reopened: false } });
    expect(await handleQuickPayEvent(client, {} as Stripe, 'checkout.session.completed', event(), NOW)).toMatchObject({ processed: true });
    expect(rpc).toHaveBeenCalledWith('complete_order_payment_attempt', { p_attempt: attemptId, p_session_id: quickPay.data.object.id, p_payment_intent: quickPay.data.object.payment_intent, p_amount: 17000, p_now: NOW.toISOString() });
    expect(fulfill).toHaveBeenCalledWith(client, id); expect(dispatch).not.toHaveBeenCalled();
  });
  it('a duplicate payment (order already paid by the admin, or cancelled meanwhile) is refunded automatically and once', async () => {
    const { client, rpc } = db({}, { complete_order_payment_attempt: { result: 'duplicate', transaction_id: id } });
    const create = vi.fn(async () => ({ id: 're_dup' }));
    await handleQuickPayEvent(client, { refunds: { create } } as unknown as Stripe, 'checkout.session.completed', event(), NOW);
    expect(create).toHaveBeenCalledWith({ payment_intent: quickPay.data.object.payment_intent, reason: 'duplicate', metadata: { sellf_payment_attempt: attemptId, sellf_instance: expect.any(String) } }, { idempotencyKey: `sellf-dup-refund-${attemptId}` });
    expect(rpc).toHaveBeenCalledWith('record_order_payment_refund', { p_attempt: attemptId, p_refund_id: 're_dup' });
    expect(fulfill).not.toHaveBeenCalled();
  });
  it('an unpaid (async) session waits; an expired one frees the attempt', async () => {
    const { client, rpc } = db({}, { expire_order_payment_attempt: true });
    expect(await handleQuickPayEvent(client, {} as Stripe, 'checkout.session.completed', event('unpaid'), NOW)).toMatchObject({ processed: true });
    expect(rpc).not.toHaveBeenCalled();
    await handleQuickPayEvent(client, {} as Stripe, 'checkout.session.expired', event('unpaid'), NOW);
    expect(rpc).toHaveBeenCalledWith('expire_order_payment_attempt', { p_session_id: quickPay.data.object.id });
  });
  it('payment_intent.succeeded for a quick-pay session is acknowledged without a second completion', async () => {
    const { client, rpc } = db({});
    const pi = { id: 'pi_quick', object: 'payment_intent', metadata: { sellf_payment_attempt: attemptId, sellf_order: id } } as unknown as Stripe.PaymentIntent;
    expect(isQuickPayObject(pi)).toBe(true);
    expect(await handleQuickPayEvent(client, {} as Stripe, 'payment_intent.succeeded', pi, NOW)).toMatchObject({ processed: true });
    expect(rpc).not.toHaveBeenCalled();
  });
});
