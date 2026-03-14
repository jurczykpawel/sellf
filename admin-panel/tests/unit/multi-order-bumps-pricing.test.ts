/**
 * TDD: Multi Order Bumps - Pricing Tests
 *
 * Tests for the new multi-bump pricing calculation.
 * The new PricingInput replaces single bumpPrice/bumpSelected
 * with a bumps[] array of { price, selected } objects.
 *
 * Written BEFORE implementation (Red phase).
 */

import { describe, it, expect } from 'vitest';
import { calculatePricing, STRIPE_MINIMUM_AMOUNT } from '@/hooks/usePricing';
import type { PricingInput } from '@/hooks/usePricing';

describe('calculatePricing — multi order bumps', () => {
  const baseCurrency = 'USD';

  // ─── Backward compatibility: single bump via legacy fields ───

  describe('backward compatibility (single bump via legacy fields)', () => {
    it('should still work with single bumpPrice + bumpSelected', () => {
      const result = calculatePricing({
        productPrice: 50,
        productCurrency: baseCurrency,
        bumpPrice: 10,
        bumpSelected: true,
      });

      expect(result.basePrice).toBe(50);
      expect(result.bumpAmount).toBe(10);
      expect(result.subtotal).toBe(60);
      expect(result.totalGross).toBe(60);
      expect(result.hasBump).toBe(true);
    });

    it('should ignore unselected single bump', () => {
      const result = calculatePricing({
        productPrice: 50,
        productCurrency: baseCurrency,
        bumpPrice: 10,
        bumpSelected: false,
      });

      expect(result.bumpAmount).toBe(0);
      expect(result.subtotal).toBe(50);
      expect(result.hasBump).toBe(false);
    });
  });

  // ─── Multi-bump via bumps[] array ───

  describe('multi-bump via bumps[] array', () => {
    it('should calculate total with multiple selected bumps', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: baseCurrency,
        bumps: [
          { price: 20, selected: true },
          { price: 30, selected: true },
        ],
      });

      expect(result.basePrice).toBe(100);
      expect(result.bumpAmount).toBe(50);
      expect(result.subtotal).toBe(150);
      expect(result.totalGross).toBe(150);
      expect(result.hasBump).toBe(true);
    });

    it('should only sum selected bumps', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: baseCurrency,
        bumps: [
          { price: 20, selected: true },
          { price: 30, selected: false },
          { price: 15, selected: true },
        ],
      });

      expect(result.bumpAmount).toBe(35); // 20 + 15
      expect(result.subtotal).toBe(135);
      expect(result.hasBump).toBe(true);
    });

    it('should return zero bump amount when no bumps selected', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: baseCurrency,
        bumps: [
          { price: 20, selected: false },
          { price: 30, selected: false },
        ],
      });

      expect(result.bumpAmount).toBe(0);
      expect(result.subtotal).toBe(100);
      expect(result.hasBump).toBe(false);
    });

    it('should handle empty bumps array', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: baseCurrency,
        bumps: [],
      });

      expect(result.bumpAmount).toBe(0);
      expect(result.subtotal).toBe(100);
      expect(result.hasBump).toBe(false);
    });

    it('should handle single bump in array', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: baseCurrency,
        bumps: [{ price: 25, selected: true }],
      });

      expect(result.bumpAmount).toBe(25);
      expect(result.subtotal).toBe(125);
      expect(result.hasBump).toBe(true);
    });
  });

  // ─── Multi-bump + coupons ───

  describe('multi-bump + coupon interaction', () => {
    it('should apply percentage coupon to entire subtotal (including bumps)', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: baseCurrency,
        bumps: [
          { price: 20, selected: true },
          { price: 30, selected: true },
        ],
        coupon: {
          discount_type: 'percentage',
          discount_value: 10,
          code: 'SAVE10',
        },
      });

      // subtotal = 100 + 20 + 30 = 150
      // discount = 150 * 10% = 15
      expect(result.subtotal).toBe(150);
      expect(result.discountAmount).toBe(15);
      expect(result.totalGross).toBe(135);
    });

    it('should apply percentage coupon only to base price when exclude_order_bumps is true', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: baseCurrency,
        bumps: [
          { price: 20, selected: true },
          { price: 30, selected: true },
        ],
        coupon: {
          discount_type: 'percentage',
          discount_value: 10,
          code: 'SAVE10',
          exclude_order_bumps: true,
        },
      });

      // subtotal = 100 + 20 + 30 = 150
      // discount = 100 * 10% = 10 (only base price)
      expect(result.subtotal).toBe(150);
      expect(result.discountAmount).toBe(10);
      expect(result.totalGross).toBe(140);
    });

    it('should apply fixed coupon to subtotal including bumps', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: baseCurrency,
        bumps: [
          { price: 20, selected: true },
        ],
        coupon: {
          discount_type: 'fixed',
          discount_value: 25,
          code: 'FLAT25',
        },
      });

      // subtotal = 100 + 20 = 120
      // discount = min(25, 120) = 25
      expect(result.subtotal).toBe(120);
      expect(result.discountAmount).toBe(25);
      expect(result.totalGross).toBe(95);
    });

    it('should apply fixed coupon only to base price when exclude_order_bumps is true', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: baseCurrency,
        bumps: [
          { price: 20, selected: true },
        ],
        coupon: {
          discount_type: 'fixed',
          discount_value: 25,
          code: 'FLAT25',
          exclude_order_bumps: true,
        },
      });

      // subtotal = 100 + 20 = 120
      // discount = min(25, 100) = 25 (only base price)
      expect(result.subtotal).toBe(120);
      expect(result.discountAmount).toBe(25);
      expect(result.totalGross).toBe(95);
    });

    it('should enforce Stripe minimum amount after coupon on multi-bump', () => {
      const result = calculatePricing({
        productPrice: 5,
        productCurrency: baseCurrency,
        bumps: [{ price: 5, selected: true }],
        coupon: {
          discount_type: 'percentage',
          discount_value: 99,
          code: 'ALMOST_FREE',
        },
      });

      // subtotal = 10, discount = 9.90, total = 0.10 → clamped to STRIPE_MINIMUM_AMOUNT
      expect(result.totalGross).toBe(STRIPE_MINIMUM_AMOUNT);
      expect(result.isFreeWithCoupon).toBe(false);
    });

    it('100% percentage coupon sets totalGross to 0 and isFreeWithCoupon to true', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: baseCurrency,
        coupon: {
          discount_type: 'percentage',
          discount_value: 100,
          code: 'FULL100',
        },
      });

      expect(result.discountAmount).toBe(100);
      expect(result.totalGross).toBe(0);
      expect(result.isFreeWithCoupon).toBe(true);
    });

    it('fixed coupon equal to price sets totalGross to 0 and isFreeWithCoupon to true', () => {
      const result = calculatePricing({
        productPrice: 49,
        productCurrency: baseCurrency,
        coupon: {
          discount_type: 'fixed',
          discount_value: 49,
          code: 'GIFT49',
        },
      });

      expect(result.discountAmount).toBe(49);
      expect(result.totalGross).toBe(0);
      expect(result.isFreeWithCoupon).toBe(true);
    });

    it('fixed coupon exceeding price sets totalGross to 0 (no negative total)', () => {
      const result = calculatePricing({
        productPrice: 10,
        productCurrency: baseCurrency,
        coupon: {
          discount_type: 'fixed',
          discount_value: 999,
          code: 'OVERSHOOT',
        },
      });

      expect(result.totalGross).toBe(0);
      expect(result.isFreeWithCoupon).toBe(true);
    });

    it('isFreeWithCoupon is false when no coupon is applied', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: baseCurrency,
      });

      expect(result.isFreeWithCoupon).toBe(false);
    });

    it('100% coupon on multi-bump makes entire order free', () => {
      const result = calculatePricing({
        productPrice: 50,
        productCurrency: baseCurrency,
        bumps: [
          { price: 20, selected: true },
          { price: 30, selected: true },
        ],
        coupon: {
          discount_type: 'percentage',
          discount_value: 100,
          code: 'ALLFREE',
        },
      });

      // subtotal = 100, discount = 100, total = 0 — NOT clamped to STRIPE_MINIMUM_AMOUNT
      expect(result.subtotal).toBe(100);
      expect(result.totalGross).toBe(0);
      expect(result.isFreeWithCoupon).toBe(true);
    });
  });

  // ─── Multi-bump + PWYW ───

  describe('multi-bump + Pay What You Want', () => {
    it('should use custom amount as base with multi bumps', () => {
      const result = calculatePricing({
        productPrice: 50,
        productCurrency: baseCurrency,
        customAmount: 75,
        bumps: [
          { price: 10, selected: true },
          { price: 20, selected: true },
        ],
      });

      expect(result.basePrice).toBe(75);
      expect(result.bumpAmount).toBe(30);
      expect(result.subtotal).toBe(105);
      expect(result.isPwyw).toBe(true);
      expect(result.hasBump).toBe(true);
    });
  });

  // ─── Multi-bump + VAT ───

  describe('multi-bump + VAT', () => {
    it('should calculate VAT on total including multi bumps', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: 'PLN',
        productVatRate: 23,
        priceIncludesVat: true,
        bumps: [
          { price: 20, selected: true },
          { price: 30, selected: true },
        ],
      });

      // totalGross = 150, net = 150 / 1.23 ≈ 121.95
      expect(result.totalGross).toBe(150);
      expect(result.totalNet).toBeCloseTo(121.95, 1);
      expect(result.vatAmount).toBeCloseTo(28.05, 1);
    });
  });

  // ─── bumps[] takes precedence over legacy bumpPrice/bumpSelected ───

  describe('precedence: bumps[] over legacy fields', () => {
    it('should use bumps[] when both bumps[] and bumpPrice are provided', () => {
      const result = calculatePricing({
        productPrice: 100,
        productCurrency: baseCurrency,
        // Legacy fields (should be ignored when bumps[] is present)
        bumpPrice: 999,
        bumpSelected: true,
        // New multi-bump field
        bumps: [
          { price: 10, selected: true },
          { price: 20, selected: true },
        ],
      });

      expect(result.bumpAmount).toBe(30); // From bumps[], NOT 999
      expect(result.subtotal).toBe(130);
    });
  });
});
