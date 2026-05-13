export type TransactionRefundProgressState = 'none' | 'partial' | 'full';

export interface TransactionRefundProgress {
  state: TransactionRefundProgressState;
  refundedAmount: number;
  totalAmount: number;
  remainingAmount: number;
}

function normalizeAmount(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function getTransactionRefundProgress(params: {
  amount: number;
  refundedAmount?: number | null;
  status: string;
}): TransactionRefundProgress {
  const totalAmount = normalizeAmount(params.amount);
  const refundedAmount = normalizeAmount(params.refundedAmount);
  const remainingAmount = Math.max(0, totalAmount - refundedAmount);

  if (refundedAmount <= 0) {
    return {
      state: 'none',
      refundedAmount,
      totalAmount,
      remainingAmount: totalAmount,
    };
  }

  if (params.status === 'refunded' || refundedAmount >= totalAmount) {
    return {
      state: 'full',
      refundedAmount,
      totalAmount,
      remainingAmount: 0,
    };
  }

  return {
    state: 'partial',
    refundedAmount,
    totalAmount,
    remainingAmount,
  };
}
