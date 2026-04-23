import { describe, expect, it } from 'vitest';

import { allocateCouponDiscount } from '@/lib/pricing/coupon-allocation';

describe('allocateCouponDiscount', () => {
  it('applies global percentage coupon to base product and all bumps', () => {
    const result = allocateCouponDiscount({
      items: [
        { kind: 'base', id: 'main-product', price: 100 },
        { kind: 'bump', id: 'bump-a', price: 20 },
        { kind: 'bump', id: 'bump-b', price: 30 },
      ],
      baseProductId: 'main-product',
      coupon: {
        code: 'SAVE20',
        discount_type: 'percentage',
        discount_value: 20,
        exclude_order_bumps: false,
        allowed_product_ids: [],
      },
    });

    expect(result.subtotal).toBe(150);
    expect(result.discountAmount).toBe(30);
    expect(result.total).toBe(120);
    expect(result.items.map((item) => item.finalPrice)).toEqual([80, 16, 24]);
  });

  it('applies global percentage coupon only to base product when exclude_order_bumps is true', () => {
    const result = allocateCouponDiscount({
      items: [
        { kind: 'base', id: 'main-product', price: 100 },
        { kind: 'bump', id: 'bump-a', price: 20 },
        { kind: 'bump', id: 'bump-b', price: 30 },
      ],
      baseProductId: 'main-product',
      coupon: {
        code: 'SAVE20',
        discount_type: 'percentage',
        discount_value: 20,
        exclude_order_bumps: true,
        allowed_product_ids: [],
      },
    });

    expect(result.discountAmount).toBe(20);
    expect(result.total).toBe(130);
    expect(result.items.map((item) => item.finalPrice)).toEqual([80, 20, 30]);
  });

  it('distributes global fixed coupon across all eligible items', () => {
    const result = allocateCouponDiscount({
      items: [
        { kind: 'base', id: 'main-product', price: 100 },
        { kind: 'bump', id: 'bump-a', price: 20 },
        { kind: 'bump', id: 'bump-b', price: 30 },
      ],
      baseProductId: 'main-product',
      coupon: {
        code: 'FLAT40',
        discount_type: 'fixed',
        discount_value: 40,
        exclude_order_bumps: false,
        allowed_product_ids: [],
      },
    });

    expect(result.discountAmount).toBe(40);
    expect(result.total).toBe(110);
    expect(result.items.map((item) => item.finalPrice)).toEqual([73.33, 14.67, 22]);
  });

  it('does not discount bumps for product-scoped coupon unless bump ids are allowed', () => {
    const result = allocateCouponDiscount({
      items: [
        { kind: 'base', id: 'main-product', price: 100 },
        { kind: 'bump', id: 'bump-a', price: 20 },
        { kind: 'bump', id: 'bump-b', price: 30 },
      ],
      baseProductId: 'main-product',
      coupon: {
        code: 'COURSE10',
        discount_type: 'percentage',
        discount_value: 10,
        exclude_order_bumps: false,
        allowed_product_ids: ['main-product'],
      },
    });

    expect(result.discountAmount).toBe(10);
    expect(result.total).toBe(140);
    expect(result.items.map((item) => item.finalPrice)).toEqual([90, 20, 30]);
  });

  it('never discounts bumps for product-scoped coupon even if bump ids appear in allowed_product_ids', () => {
    const result = allocateCouponDiscount({
      items: [
        { kind: 'base', id: 'main-product', price: 100 },
        { kind: 'bump', id: 'bump-a', price: 20 },
        { kind: 'bump', id: 'bump-b', price: 30 },
      ],
      baseProductId: 'main-product',
      coupon: {
        code: 'COURSE15',
        discount_type: 'percentage',
        discount_value: 10,
        exclude_order_bumps: false,
        allowed_product_ids: ['main-product', 'bump-a'],
      },
    });

    expect(result.discountAmount).toBe(10);
    expect(result.total).toBe(140);
    expect(result.items.map((item) => item.finalPrice)).toEqual([90, 20, 30]);
  });

  it('applies Stripe minimum floor after coupon without changing eligibility rules', () => {
    const result = allocateCouponDiscount({
      items: [
        { kind: 'base', id: 'main-product', price: 0.4 },
        { kind: 'bump', id: 'bump-a', price: 0.4 },
      ],
      baseProductId: 'main-product',
      coupon: {
        code: 'HALF',
        discount_type: 'percentage',
        discount_value: 50,
        exclude_order_bumps: false,
        allowed_product_ids: [],
      },
      applyMinimumFloor: true,
      minimumAmount: 0.5,
    });

    expect(result.discountAmount).toBe(0.3);
    expect(result.total).toBe(0.5);
    expect(result.items.map((item) => item.finalPrice)).toEqual([0.3, 0.2]);
  });

  // ==========================================================================
  // isFree flag — callers (grant-access, free-access UI) branch on this to
  // route to the free-grant path instead of Stripe. A bug here would let
  // "100% off" checkouts fall through to Stripe with amount=0 and vice versa.
  // ==========================================================================

  it('returns isFree=true for a 100% percentage coupon on a single base item', () => {
    const result = allocateCouponDiscount({
      items: [{ kind: 'base', id: 'main-product', price: 99 }],
      baseProductId: 'main-product',
      coupon: {
        code: 'VIP100',
        discount_type: 'percentage',
        discount_value: 100,
        exclude_order_bumps: false,
        allowed_product_ids: [],
      },
    });

    expect(result.isFree).toBe(true);
    expect(result.total).toBe(0);
    expect(result.items[0].finalPrice).toBe(0);
    expect(result.discountAmount).toBe(99);
  });

  it('returns isFree=true for a fixed coupon that covers the full subtotal', () => {
    const result = allocateCouponDiscount({
      items: [
        { kind: 'base', id: 'main-product', price: 100 },
        { kind: 'bump', id: 'bump-a', price: 50 },
      ],
      baseProductId: 'main-product',
      coupon: {
        code: 'FLAT150',
        discount_type: 'fixed',
        discount_value: 150,
        exclude_order_bumps: false,
        allowed_product_ids: [],
      },
      // disable min-floor so total can legitimately reach 0
      applyMinimumFloor: false,
    });

    expect(result.isFree).toBe(true);
    expect(result.total).toBe(0);
    expect(result.items.every((item) => item.finalPrice === 0)).toBe(true);
  });

  it('returns isFree=false when a product-scoped 100% coupon still leaves bump price to pay', () => {
    // Main + bump in cart; 100% coupon scoped to main only. After the policy
    // tightening, product-scoped coupons never discount bumps, so bump price
    // must still be charged and the checkout cannot be routed to the
    // free-grant path. Guards against "free access with coupon" abuse through
    // a mixed cart.
    const result = allocateCouponDiscount({
      items: [
        { kind: 'base', id: 'main-product', price: 100 },
        { kind: 'bump', id: 'bump-a', price: 50 },
      ],
      baseProductId: 'main-product',
      coupon: {
        code: 'VIP100MAIN',
        discount_type: 'percentage',
        discount_value: 100,
        exclude_order_bumps: false,
        allowed_product_ids: ['main-product'],
      },
      applyMinimumFloor: false,
    });

    expect(result.isFree).toBe(false);
    expect(result.total).toBe(50);
    expect(result.items[0].finalPrice).toBe(0);   // main: fully discounted
    expect(result.items[1].finalPrice).toBe(50);  // bump: not discounted
    expect(result.items[1].eligible).toBe(false);
    expect(result.discountAmount).toBe(100);
  });
});
