/** Coupons that bring a paid total under the Stripe minimum (W146 B6 follow-up). @see src/lib/payment/minimum-charge.ts */
import { describe, expect, it } from 'vitest';
import { isStripeAmountTooSmall, discountedBelowMinimum } from '@/lib/payment/minimum-charge';
import { allocateCouponDiscount } from '@/lib/pricing/coupon-allocation';

const coupon = (discount_value: number) => ({ code: 'X', discount_type: 'percentage' as const, discount_value });

describe('minimum charge helpers', () => {
  it('recognises the recorded Stripe amount_too_small error', () => {
    expect(isStripeAmountTooSmall({ type: 'StripeInvalidRequestError', code: 'amount_too_small', message: "The Checkout Session's total amount due must add up to at least 2.00 zł PLN" })).toBe(true);
    expect(isStripeAmountTooSmall({ code: 'card_declined' })).toBe(false);
    expect(isStripeAmountTooSmall(null)).toBe(false);
  });
  it('tells whether a coupon pushes a product price into the (0, minimum) gap', () => {
    expect(discountedBelowMinimum(2, 'PLN', 'percentage', 80)).toBe(true);
    expect(discountedBelowMinimum(2, 'PLN', 'percentage', 100)).toBe(false);
    expect(discountedBelowMinimum(2, 'PLN', 'percentage', 0)).toBe(false);
    expect(discountedBelowMinimum(10, 'PLN', 'fixed', 9)).toBe(true);
    expect(discountedBelowMinimum(10, 'PLN', 'fixed', 10)).toBe(false);
    expect(discountedBelowMinimum(10, 'PLN', 'set_price', 1)).toBe(true);
    expect(discountedBelowMinimum(0, 'PLN', 'percentage', 50)).toBe(false);
  });
});

describe('coupon allocation floor (measured: 2 PLN + 80% → Stripe session for 2.00 PLN)', () => {
  it('raises a sub-minimum total to the PLN minimum and reports it', () => {
    const r = allocateCouponDiscount({ items: [{ kind: 'base', price: 2 }], currency: 'PLN', coupon: coupon(80) });
    expect(r.total).toBe(2);
    expect(r.minimumApplied).toBe(true);
  });
  it('keeps a 100% coupon free and does not report a floor', () => {
    const r = allocateCouponDiscount({ items: [{ kind: 'base', price: 2 }], currency: 'PLN', coupon: coupon(100) });
    expect(r).toMatchObject({ total: 0, isFree: true, minimumApplied: false });
  });
  it('does not report a floor for a chargeable discount', () => {
    expect(allocateCouponDiscount({ items: [{ kind: 'base', price: 10 }], currency: 'PLN', coupon: coupon(50) }).minimumApplied).toBe(false);
  });
});

describe('coupon editor warning', () => {
  it('lists products the coupon would push under the minimum, honouring scope and currency', async () => {
    const { productsBelowMinimumWithCoupon } = await import('@/lib/payment/minimum-charge');
    const products = [
      { id: 'a', name: 'Mini', price: 2, currency: 'PLN', product_type: 'one_time' },
      { id: 'b', name: 'Duży', price: 100, currency: 'PLN', product_type: 'one_time' },
      { id: 'c', name: 'Darmowy', price: 0, currency: 'PLN', product_type: 'one_time' },
      { id: 'd', name: 'Dollar', price: 1, currency: 'USD', product_type: 'one_time' },
    ];
    expect(productsBelowMinimumWithCoupon(products, { discount_type: 'percentage', discount_value: 80, currency: null, allowed_product_ids: [] })).toEqual(['Mini', 'Dollar']);
    expect(productsBelowMinimumWithCoupon(products, { discount_type: 'percentage', discount_value: 80, currency: null, allowed_product_ids: ['b'] })).toEqual([]);
    expect(productsBelowMinimumWithCoupon(products, { discount_type: 'percentage', discount_value: 100, currency: null, allowed_product_ids: [] })).toEqual([]);
    expect(productsBelowMinimumWithCoupon(products, { discount_type: 'fixed', discount_value: 99, currency: 'PLN', allowed_product_ids: [] })).toEqual(['Duży']);
  });
});
