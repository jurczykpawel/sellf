import { describe, expect, it } from 'vitest';
import { computeLocalOrderTax, snapshotFromRows } from '@/lib/orders/local-tax';

const gross = { product_id: 'main', item_type: 'main_product' as const, discounted_total: 123, currency: 'PLN', vat_rate: 23, tax_behavior: 'inclusive' as const, vat_exempt: false };

describe('local order tax', () => {
  it.each([
    [gross, 10000, 2300, 12300],
    [{ ...gross, discounted_total: 100, tax_behavior: 'exclusive' as const }, 10000, 2300, 12300],
    [{ ...gross, vat_exempt: true }, 12300, 0, 12300],
    [{ ...gross, vat_rate: 0 }, 12300, 0, 12300],
    [{ ...gross, currency: 'JPY' }, 100, 23, 123],
    [{ ...gross, discounted_total: 0.03, tax_behavior: 'exclusive' as const }, 3, 1, 4],
  ])('computes line tax and rounds in minor units %#', (line, net, tax, payable) => {
    const result = computeLocalOrderTax([line]);
    expect(result.netTotal).toBe(net);
    expect(result.taxTotal).toBe(tax);
    expect(result.lines[0].grossAmount).toBe(payable);
    expect(result.status).toBe('local');
  });

  it('sums rounded lines independently', () => {
    const line = { ...gross, discounted_total: 0.03, tax_behavior: 'exclusive' as const };
    const result = computeLocalOrderTax([line, line]);
    expect([result.netTotal, result.taxTotal]).toEqual([6, 2]);
  });

  it('reconstructs the persisted snapshot without recalculating current tax rates', () => {
    const result = snapshotFromRows([{ ...gross, net_amount: 9999, tax_amount: 2301 }]);
    expect(result.lines[0]).toMatchObject({ productId: 'main', netAmount: 9999, taxAmount: 2301, grossAmount: 12300 });
    expect([result.netTotal, result.taxTotal]).toEqual([9999, 2301]);
  });
});
