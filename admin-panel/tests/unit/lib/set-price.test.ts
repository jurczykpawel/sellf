import { describe, expect, it } from 'vitest';
import { allocateCouponDiscount } from '@/lib/pricing/coupon-allocation';
import { calculatePricing } from '@/hooks/usePricing';
import { buildCheckoutLineSpecs, buildOrderSnapshotLines } from '@/lib/services/checkout-line-items';

const coupon = { code: 'PRICE30', discount_type: 'set_price' as const, discount_value: 30 };
describe('set price coupon', () => {
  it.each([47, 49, 67])('sets unit price %s to 30 with quantity and unchanged bumps', price => {
    for (const exclude_order_bumps of [true, false]) {
      const result = allocateCouponDiscount({ currency: 'PLN', items: [
        { kind: 'base', price: price * 3, quantity: 3 }, { kind: 'bump', price: 15 },
      ], coupon: { ...coupon, exclude_order_bumps } });
      expect(result.items.map(item => item.finalPrice)).toEqual([90, 15]);
      expect(result.discountAmount).toBe((price - 30) * 3);
      const specs = buildCheckoutLineSpecs({ main: { id: 'main', name: 'Workshop', currency: 'PLN' }, mainPrice: price, quantity: 3,
        bumps: [{ product: { id: 'bump', name: 'Extra', currency: 'PLN' }, price: 15 }], coupon, taxMode: 'local' }).specs;
      expect(buildOrderSnapshotLines(specs, { orderBumpIds: {}, accessOverrides: {} }).map(line => line.discounted_total)).toEqual([90, 15]);
      expect(calculatePricing({ productPrice: price * 3, quantity: 3, productCurrency: 'PLN', coupon }).totalPayable).toBe(90);
    }
  });
  it.each([20, 30])('never raises price %s', price => {
    expect(allocateCouponDiscount({ currency: 'PLN', items: [{ kind: 'base', price }], coupon }).discountAmount).toBe(0);
  });
  it('handles JPY and zero price', () => {
    expect(allocateCouponDiscount({ currency: 'JPY', items: [{ kind: 'base', price: 6700, quantity: 2 }], coupon: { ...coupon, discount_value: 3000 } }).total).toBe(6000);
    expect(allocateCouponDiscount({ currency: 'PLN', items: [{ kind: 'base', price: 49 }], coupon: { ...coupon, discount_value: 0 } }).isFree).toBe(true);
  });
  it('retains product restrictions', () => {
    expect(allocateCouponDiscount({ currency: 'PLN', baseProductId: 'other', items: [{ kind: 'base', price: 49 }],
      coupon: { ...coupon, allowed_product_ids: ['main'] } }).total).toBe(49);
  });
});
