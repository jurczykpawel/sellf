/**
 * Completed-order defaults and recoverable fulfillment without a database.
 * @see tests/unit/payment/verify-payment-onetime.behavioral.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fulfillPaidOrder } from '@/lib/services/fulfill-paid-order';
import { verifyPaymentSession } from '@/lib/payment/verify-payment';
import type { User } from '@supabase/supabase-js';
import type Stripe from 'stripe';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(), getStripeServer: vi.fn(),
  issueLicenses: vi.fn(), trigger: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock('@/lib/stripe/server', () => ({ getStripeServer: mocks.getStripeServer }));
vi.mock('@/lib/services/bundle-order', () => ({
  resolveComponentProductIds: vi.fn(async () => []), issueLicensesForOrder: mocks.issueLicenses,
}));
vi.mock('@/lib/services/tax-snapshot', () => ({ captureAndPersistOrderTax: vi.fn(async () => null) }));
vi.mock('@/lib/services/webhook-payload', () => ({ buildPurchaseWebhookPayload: vi.fn(async () => ({ product: {} })) }));
vi.mock('@/lib/services/webhook-service', () => ({ WebhookService: { trigger: mocks.trigger } }));
vi.mock('@/lib/services/product-validation', () => ({ ProductValidationService: { validateEmail: vi.fn(async () => true) } }));

const buyer = { id: 'buyer', email: 'buyer@example.com' } as User;
let transaction: Record<string, unknown>;

function makeClient() {
  return {
    from: vi.fn((table: string) => {
      let selected = '';
      const query = {
        select: vi.fn((columns: string) => { selected = columns; return query; }),
        eq: vi.fn(() => query),
        update: vi.fn((values: Record<string, unknown>) => { Object.assign(transaction, values); return query; }),
        single: vi.fn(async () => ({ data: transaction, error: null })),
        maybeSingle: vi.fn(async () => ({
          data: table === 'payment_transactions'
            ? { ...Object.fromEntries(selected.split(',').map(key => [key.trim(), null])), ...transaction }
            : { id: 'access', access_expires_at: null },
          error: null,
        })),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return query;
    }),
    rpc: vi.fn(async (name: string) => ({
      data: name === 'process_stripe_payment_completion_with_bump'
        ? { success: true, access_granted: true, transaction_id: transaction.id }
        : { has_oto: false },
      error: null,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  transaction = {
    id: 'transaction', session_id: 'cs_order', product_id: 'product',
    customer_email: buyer.email, user_id: buyer.id, amount: 1000, currency: 'usd',
    status: 'completed', fulfillment_pending: false, metadata: {}, created_at: '2026-01-01T00:00:00Z',
  };
  mocks.createAdminClient.mockReturnValue(makeClient());
  mocks.getStripeServer.mockResolvedValue({ checkout: { sessions: { retrieve: vi.fn(async () => ({
    id: 'cs_order', mode: 'payment', status: 'complete', payment_status: 'paid',
    amount_total: 1000, currency: 'usd', payment_intent: 'pi_order',
    customer_details: { email: buyer.email }, metadata: { product_id: 'product' },
  })) } } });
  mocks.issueLicenses.mockResolvedValue([]);
  mocks.trigger.mockResolvedValue(undefined);
});

function fulfill() {
  return fulfillPaidOrder({
    supabase: mocks.createAdminClient(), stripe: {} as Stripe,
    sessionId: 'cs_order', paymentIntentId: 'pi_order', productId: 'product',
    customerEmail: buyer.email!, amount: 1000, currency: 'usd',
  });
}

describe('completed-order fulfillment defaults', () => {
  it('reports a default completed order as granted without Stripe or purchase delivery', async () => {
    const result = await verifyPaymentSession('cs_order', buyer);
    expect(result.access_granted).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mocks.getStripeServer).not.toHaveBeenCalled();
    await fulfill();
    expect(mocks.issueLicenses).not.toHaveBeenCalled();
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it('fulfills an explicitly pending order once and serves subsequent verification from cache', async () => {
    transaction.fulfillment_pending = true;
    expect((await verifyPaymentSession('cs_order', buyer)).access_granted).toBe(true);
    expect(transaction.fulfillment_pending).toBe(false);
    expect(mocks.issueLicenses).toHaveBeenCalledTimes(1);
    expect(mocks.trigger).toHaveBeenCalledExactlyOnceWith('purchase.completed', expect.anything(), expect.anything(), ['product']);
    await fulfill();
    expect((await verifyPaymentSession('cs_order', buyer)).access_granted).toBe(true);
    expect(mocks.getStripeServer).toHaveBeenCalledTimes(1);
    expect(mocks.trigger).toHaveBeenCalledTimes(1);
  });

  it('retains pending state until license issuance and durable delivery preparation succeed', async () => {
    transaction.fulfillment_pending = true;
    mocks.issueLicenses.mockRejectedValueOnce(new Error('License service unavailable'));
    await expect(fulfill()).rejects.toThrow('License service unavailable');
    expect(transaction.fulfillment_pending).toBe(true);
    expect(mocks.trigger).not.toHaveBeenCalled();
    mocks.trigger.mockRejectedValueOnce(new Error('Delivery queue unavailable'));
    await expect(fulfill()).rejects.toThrow('Delivery queue unavailable');
    expect(transaction.fulfillment_pending).toBe(true);
    await fulfill();
    expect(transaction.fulfillment_pending).toBe(false);
    await fulfill();
    expect(mocks.trigger).toHaveBeenCalledTimes(2);
  });
});
