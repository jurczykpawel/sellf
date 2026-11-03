/** Online payment of an unpaid transfer order: quote per order state, Stripe session, webhook completion. Stripe events are clones
 * of the recorded checkout.session.completed (fixtures/stripe/checkout_completed_receiver.json) changing only the exercised fields. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const dispatch = vi.hoisted(() => vi.fn());
const fulfill = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orders/bank-transfer-service', () => ({ dispatchTransferEvent: dispatch, fulfillTransfer: fulfill }));
import recorded from '../../fixtures/stripe/checkout_completed_receiver.json';
import quickPay from '../../fixtures/stripe/quick_pay_checkout_completed.json';
import { quoteOrderPayment, createQuickPaySession, handleQuickPayEvent, isQuickPayObject } from '@/lib/orders/quick-pay';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const id = '10000000-0000-4000-8000-000000000001', attemptId = '20000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-02-02T12:00:00Z');
const tx = { id, payment_provider: 'bank_transfer', status: 'awaiting_payment', amount: 8000, currency: 'PLN', product_id: 'p1', coupon_id: null as string | null, order_number: 1001, customer_email: 'buyer@example.com', metadata: { locale: 'pl' } };
const line = { product_id: 'p1', item_type: 'main_product', quantity: 1, unit_price: 80, session_id: 's1' };
const product = { id: 'p1', is_active: true, price: 80, sale_price: null, sale_price_until: null, event_mode: true, name: 'Warsztat' };
const session = (tier: number, extra: Record<string, unknown> = {}) => [{ id: 's1', starts_at: '2099-01-01T00:00:00Z', remaining: 3, sold_out: false, current_tier: { price: tier }, ...extra }];
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
  it('an unpaid order is paid at its saved amount without re-pricing', async () => {
    const { client } = db({ payment_line_items: [{ ...line, unit_price: 50 }] }, { event_availability: session(80) });
    expect(await quoteOrderPayment(client, tx, NOW)).toEqual({ mode: 'settle', amount: 8000, currency: 'PLN' });
  });
  it.each([
    ['promo seats still available at the same price', session(80), {}, null, { mode: 'reopen', amount: 8000, currency: 'PLN' }],
    ['promo sold out, a higher tier applies', session(120), {}, null, { mode: 'unavailable', reason: 'price_changed' }],
    ['session full', session(80, { sold_out: true, remaining: 0 }), {}, null, { mode: 'unavailable', reason: 'sold_out' }],
    ['session already started', session(80, { starts_at: '2026-02-01T00:00:00Z' }), {}, null, { mode: 'unavailable', reason: 'sold_out' }],
    ['product deactivated', session(80), { is_active: false }, null, { mode: 'unavailable', reason: 'product_unavailable' }],
    ['coupon exhausted after release', session(80), {}, { is_active: true, usage_limit_global: 1, current_usage_count: 1, expires_at: null }, { mode: 'unavailable', reason: 'coupon_unavailable' }],
    ['coupon expired', session(80), {}, { is_active: true, usage_limit_global: null, current_usage_count: 0, expires_at: '2026-01-01T00:00:00Z' }, { mode: 'unavailable', reason: 'coupon_unavailable' }],
  ])('cancelled order: %s', async (_, availability, productChange, coupon, expected) => {
    const { client } = db({ payment_line_items: [line], products: { ...product, ...productChange }, invoices: null, coupons: coupon }, { event_availability: availability });
    expect(await quoteOrderPayment(client, { ...tx, status: 'cancelled', coupon_id: coupon ? 'c1' : null }, NOW)).toEqual(expected);
  });
  it('a corrected invoice blocks reopening; a paid order reports paid', async () => {
    const { client } = db({ payment_line_items: [line], products: product, invoices: { status: 'corrected' } }, { event_availability: session(80) });
    expect(await quoteOrderPayment(client, { ...tx, status: 'cancelled' }, NOW)).toEqual({ mode: 'unavailable', reason: 'invoice_corrected' });
    expect(await quoteOrderPayment(client, { ...tx, status: 'completed' }, NOW)).toEqual({ mode: 'paid' });
  });
  it('a regular product follows its current effective price', async () => {
    const plain = { ...line, session_id: null };
    const { client } = db({ payment_line_items: [plain], products: { ...product, event_mode: false, price: 100 }, invoices: null });
    expect(await quoteOrderPayment(client, { ...tx, status: 'cancelled' }, NOW)).toEqual({ mode: 'unavailable', reason: 'price_changed' });
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
  it('reopening announces order.reopened before the purchase', async () => {
    const { client } = db({}, { complete_order_payment_attempt: { result: 'completed', transaction_id: id, reopened: true } });
    await handleQuickPayEvent(client, {} as Stripe, 'checkout.session.completed', event(), NOW);
    expect(dispatch).toHaveBeenCalledWith(client, id, 'order.reopened');
    expect(dispatch.mock.invocationCallOrder[0]).toBeLessThan(fulfill.mock.invocationCallOrder[0]);
  });
  it('a duplicate payment (admin already marked paid) is refunded automatically and once', async () => {
    const { client, rpc } = db({}, { complete_order_payment_attempt: { result: 'duplicate', transaction_id: id } });
    const create = vi.fn(async () => ({ id: 're_dup' }));
    await handleQuickPayEvent(client, { refunds: { create } } as unknown as Stripe, 'checkout.session.completed', event(), NOW);
    expect(create).toHaveBeenCalledWith({ payment_intent: quickPay.data.object.payment_intent, reason: 'duplicate', metadata: { sellf_payment_attempt: attemptId } }, { idempotencyKey: `sellf-dup-refund-${attemptId}` });
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
