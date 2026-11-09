/** Shared payment states used by refund processing and remaining-balance controls. */
export const REFUNDABLE_PAYMENT_STATUSES = ['completed', 'partially_refunded'] as const;

export function isRefundablePaymentStatus(status: string): boolean {
  return REFUNDABLE_PAYMENT_STATUSES.some(candidate => candidate === status);
}

export function getPaymentRefundStatus(refundedAmount: number, amount: number): 'completed' | 'partially_refunded' | 'refunded' {
  if (refundedAmount <= 0) return 'completed';
  return refundedAmount >= amount ? 'refunded' : 'partially_refunded';
}

/** Transfer orders paid online retain their original provider. */
export function supportsStripeRefund(transaction: { payment_provider?: string | null; stripe_payment_intent_id?: string | null }): boolean {
  return transaction.payment_provider !== 'bank_transfer' || !!transaction.stripe_payment_intent_id;
}
