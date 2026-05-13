export type RefundRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | string | null;
export type RefundAdminAction = 'approve' | 'reject';

export interface CustomerRefundStateInput {
  status: string;
  refund_request_status: string | null;
  is_refundable: boolean;
  refund_eligible: boolean;
}

export type CustomerRefundAction =
  | { type: 'none' }
  | { type: 'request' }
  | { type: 'not_refundable' }
  | { type: 'period_expired' }
  | { type: 'pending' }
  | { type: 'rejected_contact' };

export function getCustomerRefundAction(purchase: CustomerRefundStateInput): CustomerRefundAction {
  if (purchase.status === 'refunded') return { type: 'none' };
  if (purchase.refund_request_status === 'pending') return { type: 'pending' };
  if (purchase.refund_request_status === 'rejected') return { type: 'rejected_contact' };
  if (!purchase.is_refundable) return { type: 'not_refundable' };
  if (!purchase.refund_eligible) return { type: 'period_expired' };
  return { type: 'request' };
}

export function getAdminRefundActions(status: RefundRequestStatus): RefundAdminAction[] {
  if (status === 'pending') return ['approve', 'reject'];
  if (status === 'rejected') return ['approve'];
  return [];
}

export function canProcessRefundRequest(status: RefundRequestStatus, action: RefundAdminAction): boolean {
  return getAdminRefundActions(status).includes(action);
}

export interface RefundApprovalLogInput {
  refundRequestId: string;
  transactionId: string;
  paymentIntentId: string | null;
  productId: string;
  userId: string | null;
  sessionId: string | null;
  adminId: string;
  currency: string;
  requestedAmount: number;
  transactionAmount: number;
  refundedBefore: number;
  refundedAfter: number;
  isFullRefund: boolean;
  stripeRefundId: string | null;
  stripeRefundStatus: string | null;
  revocation?: {
    mainProductRevoked: boolean;
    mainGuestPurchaseRevoked: boolean;
    bumpProductsRevoked: number;
    warnings: string[];
  } | null;
}

export function buildRefundApprovalLog(input: RefundApprovalLogInput) {
  return {
    event: 'refund_request_approved',
    refund_request_id: input.refundRequestId,
    transaction_id: input.transactionId,
    payment_intent_id: input.paymentIntentId,
    product_id: input.productId,
    user_id: input.userId,
    session_id: input.sessionId,
    admin_id: input.adminId,
    currency: input.currency,
    requested_amount: input.requestedAmount,
    transaction_amount: input.transactionAmount,
    refunded_amount_before: input.refundedBefore,
    refunded_amount_after: input.refundedAfter,
    is_full_refund: input.isFullRefund,
    stripe_refund_id: input.stripeRefundId,
    stripe_refund_status: input.stripeRefundStatus,
    revocation: input.revocation ?? null,
  };
}
