/** Shared payment states used by refund processing and remaining-balance controls. */
export const REFUNDABLE_PAYMENT_STATUSES = ['completed', 'partially_refunded'] as const;

export function isRefundablePaymentStatus(status: string): boolean {
  return REFUNDABLE_PAYMENT_STATUSES.some(candidate => candidate === status);
}

export function getPaymentRefundStatus(refundedAmount: number, amount: number): 'completed' | 'partially_refunded' | 'refunded' {
  if (refundedAmount <= 0) return 'completed';
  return refundedAmount >= amount ? 'refunded' : 'partially_refunded';
}
