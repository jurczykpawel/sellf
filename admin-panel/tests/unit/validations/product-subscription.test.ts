/**
 * Subscription validation cases for validateCreateProduct / validateUpdateProduct
 * and sanitizeProductData. Covers the Phase 4 admin-form validation path that
 * the API enforces independently of the React form.
 */

import { describe, it, expect } from 'vitest';
import {
  validateCreateProduct,
  validateUpdateProduct,
  sanitizeProductData,
} from '@/lib/validations/product';

const baseValid = {
  name: 'Sub',
  slug: 'sub',
  description: 'desc',
  price: 0,
  currency: 'PLN',
};

describe('Product validation — subscription fields', () => {
  describe('validateCreateProduct', () => {
    it('accepts a fully-configured subscription product', () => {
      const result = validateCreateProduct({
        ...baseValid,
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 49,
        trial_days: 14,
      });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects subscription without recurring_price', () => {
      const result = validateCreateProduct({
        ...baseValid,
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/recurring_price/);
    });

    it('rejects subscription with recurring_price <= 0', () => {
      const result = validateCreateProduct({
        ...baseValid,
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 0,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/recurring_price/);
    });

    it('rejects subscription with invalid billing_interval', () => {
      const result = validateCreateProduct({
        ...baseValid,
        product_type: 'subscription',
        billing_interval: 'fortnight',
        billing_interval_count: 1,
        recurring_price: 49,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/billing_interval/);
    });

    it('rejects subscription with billing_interval_count < 1', () => {
      const result = validateCreateProduct({
        ...baseValid,
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 0,
        recurring_price: 49,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/billing_interval_count/);
    });

    it('rejects trial_days outside [0..730]', () => {
      const tooHigh = validateCreateProduct({
        ...baseValid,
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 49,
        trial_days: 731,
      });
      expect(tooHigh.isValid).toBe(false);
      expect(tooHigh.errors.join(' ')).toMatch(/trial_days/);

      const negative = validateCreateProduct({
        ...baseValid,
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 49,
        trial_days: -1,
      });
      expect(negative.isValid).toBe(false);
    });

    it('rejects unknown product_type values', () => {
      const result = validateCreateProduct({
        ...baseValid,
        product_type: 'donation',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/product_type/);
    });

    it('rejects recurring_price on a one-time product', () => {
      const result = validateCreateProduct({
        ...baseValid,
        price: 99,
        product_type: 'one_time',
        recurring_price: 49,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/recurring_price/);
    });

    it('rejects billing_interval on a one-time product', () => {
      const result = validateCreateProduct({
        ...baseValid,
        price: 99,
        product_type: 'one_time',
        billing_interval: 'month',
      });
      expect(result.isValid).toBe(false);
    });

    it('does not run subscription validation on a plain one-time create', () => {
      const result = validateCreateProduct({ ...baseValid, price: 99 });
      expect(result.isValid).toBe(true);
    });
  });

  describe('validateUpdateProduct', () => {
    it('accepts changing only trial_days when product is already a subscription', () => {
      const result = validateUpdateProduct({
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 99,
        trial_days: 7,
      });
      expect(result.isValid).toBe(true);
    });

    it('skips subscription validation entirely when no subscription field is provided', () => {
      const result = validateUpdateProduct({ name: 'New Name' });
      expect(result.isValid).toBe(true);
    });

    it('rejects partial flip to subscription without required fields', () => {
      const result = validateUpdateProduct({ product_type: 'subscription' });
      expect(result.isValid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/recurring_price|billing_interval/);
    });
  });

  describe('sanitizeProductData', () => {
    it('clears recurring fields when product_type=one_time', () => {
      const out = sanitizeProductData({
        ...baseValid,
        product_type: 'one_time',
        billing_interval: 'month',
        billing_interval_count: 3,
        recurring_price: 49,
        trial_days: 14,
      });
      expect(out.product_type).toBe('one_time');
      expect(out.billing_interval).toBeNull();
      expect(out.billing_interval_count).toBeNull();
      expect(out.recurring_price).toBeNull();
      expect(out.trial_days).toBeNull();
    });

    it('coerces numeric strings on subscription products', () => {
      const out = sanitizeProductData({
        ...baseValid,
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: '2',
        recurring_price: '49.50',
        trial_days: '14',
      });
      expect(out.billing_interval_count).toBe(2);
      expect(out.recurring_price).toBe(49.5);
      expect(out.trial_days).toBe(14);
    });

    it('normalizes empty trial_days to null', () => {
      const out = sanitizeProductData({
        ...baseValid,
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 49,
        trial_days: '',
      });
      expect(out.trial_days).toBeNull();
    });

    it('defaults billing_interval_count to 1 on subscription create', () => {
      const out = sanitizeProductData(
        {
          ...baseValid,
          product_type: 'subscription',
          billing_interval: 'month',
          recurring_price: 49,
        },
        true
      );
      expect(out.billing_interval_count).toBe(1);
    });

    it('defaults missing product_type to one_time on create', () => {
      const out = sanitizeProductData({ ...baseValid, price: 99 }, true);
      expect(out.product_type).toBe('one_time');
    });
  });
});
