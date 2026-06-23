import { describe, it, expect } from 'vitest';
import { computeRefundTax } from '@/lib/services/refund-webhook-payload';

/**
 * Refund VAT breakdown for credit notes (faktura korygująca). Full refund = exact
 * (net_total/tax_total); partial = proportional to the charge. Returns null when the
 * order has no tax snapshot (pre-feature / unavailable) — never fabricate a number.
 * All amounts MINOR units (cents/grosze), matching refund.amount.
 */
describe('computeRefundTax', () => {
  // Order: 100 net + 23 VAT = 123 gross (amount 12300, net 10000, tax 2300).
  const order = { amount: 12300, netTotal: 10000, taxTotal: 2300 };

  it('full refund → exact net_total/tax_total + effective rate', () => {
    expect(computeRefundTax({ refundAmount: 12300, isFullRefund: true, ...order })).toEqual({
      net: 10000, tax: 2300, vatRate: 23,
    });
  });

  it('partial refund → proportional split', () => {
    // refund 6150 (half) → tax = round(6150 * 2300 / 12300) = 1150, net = 5000
    expect(computeRefundTax({ refundAmount: 6150, isFullRefund: false, ...order })).toEqual({
      net: 5000, tax: 1150, vatRate: 23,
    });
  });

  it('no snapshot (net/tax null) → null (no fabricated breakdown)', () => {
    expect(computeRefundTax({ refundAmount: 12300, isFullRefund: true, amount: 12300, netTotal: null, taxTotal: null })).toBeNull();
  });

  it('zero-tax order (exempt / 0%) → tax 0', () => {
    expect(computeRefundTax({ refundAmount: 10000, isFullRefund: true, amount: 10000, netTotal: 10000, taxTotal: 0 })).toEqual({
      net: 10000, tax: 0, vatRate: 0,
    });
  });

  it('partial with non-positive amount → null (guard)', () => {
    expect(computeRefundTax({ refundAmount: 5000, isFullRefund: false, amount: 0, netTotal: 10000, taxTotal: 2300 })).toBeNull();
  });
});
