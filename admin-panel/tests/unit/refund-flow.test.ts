import { describe, expect, it } from 'vitest';
import {
  buildRefundApprovalLog,
  canProcessRefundRequest,
  getAdminRefundActions,
  getCustomerRefundAction,
} from '@/lib/refunds/flow';

describe('refund flow rules', () => {
  it('hides the customer refund request button after a rejection', () => {
    expect(getCustomerRefundAction({
      status: 'completed',
      refund_request_status: 'rejected',
      is_refundable: true,
      refund_eligible: true,
    })).toEqual({ type: 'rejected_contact' });
  });

  it('keeps the customer refund request button for refundable purchases without a request', () => {
    expect(getCustomerRefundAction({
      status: 'completed',
      refund_request_status: null,
      is_refundable: true,
      refund_eligible: true,
    })).toEqual({ type: 'request' });
  });

  it('allows admins to approve a rejected refund request', () => {
    expect(getAdminRefundActions('rejected')).toEqual(['approve']);
    expect(canProcessRefundRequest('rejected', 'approve')).toBe(true);
  });

  it('does not allow admins to reject an already rejected refund request again', () => {
    expect(canProcessRefundRequest('rejected', 'reject')).toBe(false);
  });

  it('allows both actions for pending requests and none for approved requests', () => {
    expect(getAdminRefundActions('pending')).toEqual(['approve', 'reject']);
    expect(getAdminRefundActions('approved')).toEqual([]);
  });

  it('builds a financial audit log for approved refunds', () => {
    expect(buildRefundApprovalLog({
      refundRequestId: 'refund-1',
      transactionId: 'tx-1',
      paymentIntentId: 'pi_123',
      productId: 'product-1',
      userId: 'user-1',
      sessionId: 'pi_123',
      adminId: 'admin-1',
      currency: 'PLN',
      requestedAmount: 1500,
      transactionAmount: 1500,
      refundedBefore: 0,
      refundedAfter: 1500,
      isFullRefund: true,
      stripeRefundId: 'pyr_123',
      stripeRefundStatus: 'succeeded',
      revocation: {
        mainProductRevoked: true,
        mainGuestPurchaseRevoked: true,
        bumpProductsRevoked: 0,
        warnings: [],
      },
    })).toEqual({
      event: 'refund_request_approved',
      refund_request_id: 'refund-1',
      transaction_id: 'tx-1',
      payment_intent_id: 'pi_123',
      product_id: 'product-1',
      user_id: 'user-1',
      session_id: 'pi_123',
      admin_id: 'admin-1',
      currency: 'PLN',
      requested_amount: 1500,
      transaction_amount: 1500,
      refunded_amount_before: 0,
      refunded_amount_after: 1500,
      is_full_refund: true,
      stripe_refund_id: 'pyr_123',
      stripe_refund_status: 'succeeded',
      revocation: {
        mainProductRevoked: true,
        mainGuestPurchaseRevoked: true,
        bumpProductsRevoked: 0,
        warnings: [],
      },
    });
  });
});
