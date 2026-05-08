import { describe, expect, it } from 'vitest';
import { getTransactionRefundProgress } from '@/lib/refunds/transaction-refund-progress';

describe('transaction refund progress', () => {
  it('marks a refund as partial when only part of the amount was returned', () => {
    expect(getTransactionRefundProgress({
      amount: 7998,
      refundedAmount: 2000,
      status: 'completed',
    })).toEqual({
      state: 'partial',
      refundedAmount: 2000,
      totalAmount: 7998,
      remainingAmount: 5998,
    });
  });

  it('marks a refund as full when the transaction is fully refunded', () => {
    expect(getTransactionRefundProgress({
      amount: 7998,
      refundedAmount: 7998,
      status: 'refunded',
    })).toEqual({
      state: 'full',
      refundedAmount: 7998,
      totalAmount: 7998,
      remainingAmount: 0,
    });
  });
});
