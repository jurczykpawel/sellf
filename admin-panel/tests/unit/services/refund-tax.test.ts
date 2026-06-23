import { describe, it, expect } from 'vitest';
import { computeRefundTax } from '@/lib/services/refund-webhook-payload';

/**
 * Refund VAT breakdown for credit notes (faktura korygująca). Tax of a refund delta =
 * cumulative tax up to totalRefunded minus tax already credited up to previousRefundedAmount.
 * Stays correct across a sequence of partial refunds (sums to taxTotal at full). Returns
 * null when the order has no tax snapshot. MINOR units; net + tax == refundAmount.
 */
describe('computeRefundTax', () => {
  // Order: 100 net + 23 VAT = 123 gross (amount 12300, net 10000, tax 2300).
  const order = { amount: 12300, netTotal: 10000, taxTotal: 2300 };

  it('single full refund → exact net_total/tax_total + effective rate', () => {
    expect(computeRefundTax({ refundAmount: 12300, previousRefundedAmount: 0, totalRefunded: 12300, ...order })).toEqual({
      net: 10000, tax: 2300, vatRate: 23,
    });
  });

  it('single partial refund → proportional split', () => {
    expect(computeRefundTax({ refundAmount: 6150, previousRefundedAmount: 0, totalRefunded: 6150, ...order })).toEqual({
      net: 5000, tax: 1150, vatRate: 23,
    });
  });

  it('partial THEN completing-to-full → each delta gets only its incremental tax (sums to taxTotal)', () => {
    // refund #1: 0 → 6150
    const r1 = computeRefundTax({ refundAmount: 6150, previousRefundedAmount: 0, totalRefunded: 6150, ...order })!;
    // refund #2: 6150 → 12300 (completes). Must be 1150, NOT the whole 2300.
    const r2 = computeRefundTax({ refundAmount: 6150, previousRefundedAmount: 6150, totalRefunded: 12300, ...order })!;
    expect(r1.tax).toBe(1150);
    expect(r2.tax).toBe(1150);
    expect(r1.tax + r2.tax).toBe(2300); // total credited VAT == order VAT (no over-credit)
    expect(r2.net).toBe(5000);
    expect(r1.net + r1.tax).toBe(6150); // net+tax == delta
    expect(r2.net + r2.tax).toBe(6150);
  });

  it('uneven partial deltas still sum to taxTotal at full', () => {
    const r1 = computeRefundTax({ refundAmount: 5000, previousRefundedAmount: 0, totalRefunded: 5000, ...order })!;
    const r2 = computeRefundTax({ refundAmount: 7300, previousRefundedAmount: 5000, totalRefunded: 12300, ...order })!;
    expect(r1.tax + r2.tax).toBe(2300);
  });

  it('no snapshot (net/tax null) → null', () => {
    expect(computeRefundTax({ refundAmount: 12300, previousRefundedAmount: 0, totalRefunded: 12300, amount: 12300, netTotal: null, taxTotal: null })).toBeNull();
  });

  it('zero-tax order (exempt / 0%) → tax 0', () => {
    expect(computeRefundTax({ refundAmount: 10000, previousRefundedAmount: 0, totalRefunded: 10000, amount: 10000, netTotal: 10000, taxTotal: 0 })).toEqual({
      net: 10000, tax: 0, vatRate: 0,
    });
  });

  it('non-positive amount → null (guard)', () => {
    expect(computeRefundTax({ refundAmount: 5000, previousRefundedAmount: 0, totalRefunded: 5000, amount: 0, netTotal: 10000, taxTotal: 2300 })).toBeNull();
  });
});
