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

  it('mixed-rate order → blended effective rate; deltas still sum to taxTotal at full (documented approximation)', () => {
    // 10000 net @23% (2300) + 5000 net @8% (400) → net 15000, tax 2700, gross 17700.
    const mixed = { amount: 17700, netTotal: 15000, taxTotal: 2700 };
    const full = computeRefundTax({ refundAmount: 17700, previousRefundedAmount: 0, totalRefunded: 17700, ...mixed })!;
    expect(full).toEqual({ net: 15000, tax: 2700, vatRate: 18 }); // blended 2700/15000 = 18%
    // a partial then completing still credits exactly taxTotal — no over/under-credit
    const r1 = computeRefundTax({ refundAmount: 8850, previousRefundedAmount: 0, totalRefunded: 8850, ...mixed })!;
    const r2 = computeRefundTax({ refundAmount: 8850, previousRefundedAmount: 8850, totalRefunded: 17700, ...mixed })!;
    expect(r1.tax + r2.tax).toBe(2700);
    expect(r1.net + r2.net).toBe(15000);
  });

  it('brutto order whose net_total column holds GROSS → vatRate still correct (derived from amount-taxTotal)', () => {
    // Inclusive/legacy: net_total may store the gross (12300). vatRate must derive from the
    // true net (amount - taxTotal = 10000), giving 23% — NOT 2300/12300 = 18.7%.
    const r = computeRefundTax({ refundAmount: 12300, previousRefundedAmount: 0, totalRefunded: 12300, amount: 12300, netTotal: 12300, taxTotal: 2300 })!;
    expect(r.vatRate).toBe(23);
    expect(r.tax).toBe(2300);
    expect(r.net).toBe(10000);
  });

  it('non-positive amount → null (guard)', () => {
    expect(computeRefundTax({ refundAmount: 5000, previousRefundedAmount: 0, totalRefunded: 5000, amount: 0, netTotal: 10000, taxTotal: 2300 })).toBeNull();
  });
});
