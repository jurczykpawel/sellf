import { describe, expect, it } from 'vitest';
import {
  buildRefundIssuedPayload,
  buildRefundIssuedPayloadFromTransaction,
  shouldEmitRefundWebhook,
} from '@/lib/services/refund-webhook-payload';

/** Mock supabase: products fetch + payment_transactions(net_total,tax_total) fetch. */
function mockSupabaseFor(opts: {
  product?: Record<string, unknown> | null;
  tx?: { net_total: number | null; tax_total: number | null } | null;
}) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: table === 'products' ? (opts.product ?? null) : (opts.tx ?? null),
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const txRow = {
  id: 'pay_1', user_id: null, product_id: 'prod_1', session_id: 'cs_1',
  stripe_payment_intent_id: 'pi_1', amount: 12300, currency: 'PLN',
  status: 'completed', customer_email: 'b@e.com',
};
const productRow = { id: 'prod_1', name: 'C', slug: 'c', price: 100, currency: 'PLN', icon: null };

const product = {
  id: 'prod_123',
  name: 'Refunded Course',
  slug: 'refunded-course',
  price: 19900,
  currency: 'PLN',
  icon: 'R',
};

describe('refund webhook payload', () => {
  it('builds a refund.issued payload consistent with purchase/subscription payloads', () => {
    const payload = buildRefundIssuedPayload({
      customer: {
        email: 'customer@example.com',
        userId: 'user_123',
      },
      product,
      payment: {
        id: 'pay_123',
        amount: 19900,
        currency: 'PLN',
        sessionId: 'cs_test_123',
        paymentIntentId: 'pi_test_123',
        statusBefore: 'completed',
        statusAfter: 'refunded',
      },
      refund: {
        stripeRefundId: 're_test_123',
        amount: 19900,
        currency: 'PLN',
        reason: 'requested_by_customer',
        status: 'succeeded',
        isFullRefund: true,
        totalRefunded: 19900,
        refundedAt: '2026-05-13T07:00:00.000Z',
        initiatedByAdminId: 'admin_123',
        refundRequestId: 'rr_123',
        source: 'api',
      },
    });

    expect(payload).toEqual({
      customer: {
        email: 'customer@example.com',
        userId: 'user_123',
      },
      product,
      payment: {
        id: 'pay_123',
        amount: 19900,
        currency: 'PLN',
        sessionId: 'cs_test_123',
        paymentIntentId: 'pi_test_123',
        statusBefore: 'completed',
        statusAfter: 'refunded',
      },
      refund: {
        stripeRefundId: 're_test_123',
        amount: 19900,
        currency: 'PLN',
        reason: 'requested_by_customer',
        status: 'succeeded',
        isFullRefund: true,
        totalRefunded: 19900,
        refundedAt: '2026-05-13T07:00:00.000Z',
        initiatedByAdminId: 'admin_123',
        refundRequestId: 'rr_123',
        source: 'api',
      },
    });
  });

  it('buildRefundIssuedPayloadFromTransaction: refund.refund carries net/tax/vatRate from the order snapshot (partial)', async () => {
    const payload = await buildRefundIssuedPayloadFromTransaction({
      supabaseClient: mockSupabaseFor({ product: productRow, tx: { net_total: 10000, tax_total: 2300 } }),
      transaction: txRow,
      stripeRefundId: 're_1', refundAmount: 6150,
      previousRefundedAmount: 0, totalRefunded: 6150, isFullRefund: false,
      statusBefore: 'completed', statusAfter: 'completed', refundedAt: '2026-06-23T00:00:00.000Z',
      source: 'admin',
    });
    // partial half-refund of a 100+23 order → net 5000, tax 1150, rate 23 (MINOR units)
    expect(payload.refund).toMatchObject({ amount: 6150, net: 5000, tax: 1150, vatRate: 23 });
  });

  it('buildRefundIssuedPayloadFromTransaction: omits net/tax when the order has no tax snapshot', async () => {
    const payload = await buildRefundIssuedPayloadFromTransaction({
      supabaseClient: mockSupabaseFor({ product: productRow, tx: { net_total: null, tax_total: null } }),
      transaction: txRow,
      stripeRefundId: 're_1', refundAmount: 6150,
      previousRefundedAmount: 0, totalRefunded: 6150, isFullRefund: false,
      statusBefore: 'completed', statusAfter: 'completed', refundedAt: '2026-06-23T00:00:00.000Z',
      source: 'admin',
    });
    expect((payload.refund as { net?: number }).net).toBeUndefined();
    expect((payload.refund as { tax?: number }).tax).toBeUndefined();
  });

  it('emits only when a new refund increases total refunded amount', () => {
    expect(shouldEmitRefundWebhook({ previousRefundedAmount: 0, nextRefundedAmount: 5000 })).toBe(true);
    expect(shouldEmitRefundWebhook({ previousRefundedAmount: 5000, nextRefundedAmount: 8000 })).toBe(true);
    expect(shouldEmitRefundWebhook({ previousRefundedAmount: 8000, nextRefundedAmount: 8000 })).toBe(false);
    expect(shouldEmitRefundWebhook({ previousRefundedAmount: 9000, nextRefundedAmount: 8000 })).toBe(false);
  });
});
