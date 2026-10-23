/** Pricing snapshots retain list prices and allocate each coupon once per order. */
import { describe, expect, it, vi } from 'vitest';
import { buildCheckoutLineSpecs, buildOrderSnapshotLines, buildStripeLineItems } from '@/lib/services/checkout-line-items';
import { toMinorUnits } from '@/lib/currency/minor-units';
import type { BuildLineSpecsParams } from '@/lib/services/checkout-line-items';
const main = { id: 'main', name: 'Main', currency: 'PLN', vatRate: 23, priceIncludesVat: true };
const bump = { id: 'bump', name: 'Extra', currency: 'PLN', vatRate: 8, priceIncludesVat: false };
const base: BuildLineSpecsParams = { main, mainPrice: 10, quantity: 3, bumps: [{ product: bump, price: 5 }], coupon: null, taxMode: 'local' };
const options = { orderBumpIds: { bump: 'binding' }, accessOverrides: { bump: 30 } };
const scenarios: Array<[string, Partial<BuildLineSpecsParams>, number]> = [
  ['quantity times unit price and one bump', {}, 3500],
  ['percentage on all line totals', { coupon: { code: 'PCT', discount_type: 'percentage', discount_value: 20 } }, 2800],
  ['fixed discount once per order', { coupon: { code: 'FIX', discount_type: 'fixed', discount_value: 7 } }, 2800],
  ['excluded bumps', { coupon: { code: 'EXC', discount_type: 'percentage', discount_value: 20, exclude_order_bumps: true } }, 2900],
  ['minimum on the main line', { mainPrice: 0.1, quantity: 1, bumps: [], coupon: { code: 'MIN', discount_type: 'percentage', discount_value: 50 } }, 50],
  ['JPY whole units', { main: { ...main, currency: 'JPY' }, bumps: [], mainPrice: 101, coupon: { code: 'JPY', discount_type: 'fixed', discount_value: 50 } }, 253],
  ['resolved PWYW unit', { mainPrice: 17.33 }, 5699],
  ['resolved sale price', { mainPrice: 7.99 }, 2897],
];
describe('order snapshot lines', () => {
  it.each(scenarios)('%s', (_name, overrides, total) => {
    const result = buildCheckoutLineSpecs({ ...base, ...overrides });
    const lines = buildOrderSnapshotLines(result.specs, options);
    expect(result.totalMinor).toBe(total);
    expect(lines.reduce((s, l) => s + toMinorUnits(l.discounted_total, l.currency), 0)).toBe(total);
    expect(lines[0].quantity).toBe(overrides.quantity ?? 3);
    expect(toMinorUnits(lines[0].total_price, lines[0].currency)).toBe(lines[0].quantity * toMinorUnits(lines[0].unit_price, lines[0].currency));
    expect(lines[0].discounted_total).toBeGreaterThanOrEqual(0);
    if (lines[1]) expect(lines[1]).toMatchObject({ quantity: 1, unit_price: 5, total_price: 5, order_bump_id: 'binding', access_duration_override: 30 });
  });
  it('retains list totals before coupon', () => {
    const { specs } = buildCheckoutLineSpecs({ ...base, coupon: { code: 'FIX', discount_type: 'fixed', discount_value: 7 } });
    expect(specs[0]).toMatchObject({ quantity: 3, listAmountMinor: 3000, unitAmountMinor: 2400 });
    expect(buildOrderSnapshotLines(specs, options)[0]).toMatchObject({ unit_price: 10, total_price: 30, discounted_total: 24 });
  });
  it('applies the minimum adjustment only to the main line', () => {
    const { specs } = buildCheckoutLineSpecs({ ...base, mainPrice: 0.1, quantity: 1, bumps: [{ product: bump, price: 0.1 }], coupon: { code: 'MIN', discount_type: 'percentage', discount_value: 50 } });
    expect(specs.map(s => s.unitAmountMinor)).toEqual([45, 5]);
  });
  it.each([0, -1, 1.5, 101, NaN])('rejects invalid quantity %s', quantity => {
    expect(() => buildCheckoutLineSpecs({ ...base, quantity })).toThrow();
  });
  it('rejects mixed currencies', () => {
    const { specs } = buildCheckoutLineSpecs({ ...base, bumps: [{ product: { ...bump, currency: 'EUR' }, price: 5 }] });
    expect(() => buildOrderSnapshotLines(specs, options)).toThrow();
  });
  it('charges the saved whole line once with quantity three and a fixed coupon', async () => {
    const { specs, totalMinor } = buildCheckoutLineSpecs({ ...base, coupon: { code: 'FIX', discount_type: 'fixed', discount_value: 7.01 } });
    const lines = buildOrderSnapshotLines(specs, options);
    const items = await buildStripeLineItems(specs, { resolveTaxRate: vi.fn(async () => 'txr_test') });
    expect(items[0]).toMatchObject({ quantity: 1, price_data: { unit_amount: toMinorUnits(lines[0].discounted_total, 'PLN'), product_data: { name: 'Main × 3' } } });
    expect(items.reduce((sum, item) => sum + (item.price_data as { unit_amount: number }).unit_amount, 0)).toBe(totalMinor);
  });
});
