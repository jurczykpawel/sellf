import { describe, expect, it } from 'vitest';
import {
  buildRefundIssuedPayload,
  shouldEmitRefundWebhook,
} from '@/lib/services/refund-webhook-payload';

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

  it('emits only when a new refund increases total refunded amount', () => {
    expect(shouldEmitRefundWebhook({ previousRefundedAmount: 0, nextRefundedAmount: 5000 })).toBe(true);
    expect(shouldEmitRefundWebhook({ previousRefundedAmount: 5000, nextRefundedAmount: 8000 })).toBe(true);
    expect(shouldEmitRefundWebhook({ previousRefundedAmount: 8000, nextRefundedAmount: 8000 })).toBe(false);
    expect(shouldEmitRefundWebhook({ previousRefundedAmount: 9000, nextRefundedAmount: 8000 })).toBe(false);
  });
});
