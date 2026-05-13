import { describe, it, expect } from 'vitest';
import {
  formatBillingIntervalLabel,
  formatRecurringProductPrice,
} from '@/lib/product-pricing-display';

describe('formatBillingIntervalLabel', () => {
  describe('pl locale', () => {
    it('returns "dzień" for daily/1', () => {
      expect(formatBillingIntervalLabel('day', 1, 'pl')).toBe('dzień');
    });

    it('returns "tydz." for weekly/1', () => {
      expect(formatBillingIntervalLabel('week', 1, 'pl')).toBe('tydz.');
    });

    it('returns "mies." for monthly/1', () => {
      expect(formatBillingIntervalLabel('month', 1, 'pl')).toBe('mies.');
    });

    it('returns "rok" for yearly/1', () => {
      expect(formatBillingIntervalLabel('year', 1, 'pl')).toBe('rok');
    });

    it('prefixes "co N" for count > 1', () => {
      expect(formatBillingIntervalLabel('month', 3, 'pl')).toBe('co 3 mies.');
      expect(formatBillingIntervalLabel('year', 2, 'pl')).toBe('co 2 rok');
      expect(formatBillingIntervalLabel('week', 4, 'pl')).toBe('co 4 tydz.');
    });

    it('treats missing/zero count as 1', () => {
      expect(formatBillingIntervalLabel('month', null, 'pl')).toBe('mies.');
      expect(formatBillingIntervalLabel('month', undefined, 'pl')).toBe('mies.');
      expect(formatBillingIntervalLabel('month', 0, 'pl')).toBe('mies.');
    });
  });

  describe('en locale', () => {
    it('returns base label for count=1', () => {
      expect(formatBillingIntervalLabel('day', 1, 'en')).toBe('day');
      expect(formatBillingIntervalLabel('month', 1, 'en')).toBe('month');
      expect(formatBillingIntervalLabel('year', 1, 'en')).toBe('year');
    });

    it('pluralizes for count > 1 with "every N labels"', () => {
      expect(formatBillingIntervalLabel('month', 3, 'en')).toBe('every 3 months');
      expect(formatBillingIntervalLabel('year', 2, 'en')).toBe('every 2 years');
      expect(formatBillingIntervalLabel('week', 4, 'en')).toBe('every 4 weeks');
    });
  });

  it('falls back to en pattern for unrecognized locales', () => {
    expect(formatBillingIntervalLabel('month', 1, 'de')).toBe('month');
    expect(formatBillingIntervalLabel('month', 2, 'fr')).toBe('every 2 months');
  });

  it('returns empty string when interval is missing', () => {
    expect(formatBillingIntervalLabel(null, 1, 'pl')).toBe('');
    expect(formatBillingIntervalLabel(undefined, 1, 'pl')).toBe('');
  });
});

describe('formatRecurringProductPrice', () => {
  const baseSub = {
    product_type: 'subscription' as const,
    recurring_price: 49,
    currency: 'PLN',
    billing_interval: 'month' as const,
    billing_interval_count: 1,
  };

  it('returns null for non-subscription products', () => {
    expect(
      formatRecurringProductPrice(
        { ...baseSub, product_type: 'one_time' as const },
        'pl',
      ),
    ).toBeNull();
  });

  it('returns null when recurring_price is missing', () => {
    expect(
      formatRecurringProductPrice(
        { ...baseSub, recurring_price: null },
        'pl',
      ),
    ).toBeNull();
    expect(
      formatRecurringProductPrice(
        { ...baseSub, recurring_price: 0 },
        'pl',
      ),
    ).toBeNull();
  });

  it('returns null when billing_interval is missing', () => {
    expect(
      formatRecurringProductPrice(
        { ...baseSub, billing_interval: null },
        'pl',
      ),
    ).toBeNull();
  });

  it('omits the ISO currency code by default (checkout-facing)', () => {
    const display = formatRecurringProductPrice(baseSub, 'pl');
    // No "PLN" right after the symbol — symbol alone is enough for end users.
    expect(display).not.toContain('PLN');
    // Should still contain the symbol, amount, and interval label.
    expect(display).toMatch(/^zł49[.,]00 \/ mies\.$/);
  });

  it('includes the ISO currency code when explicitly requested (admin contexts)', () => {
    const display = formatRecurringProductPrice(baseSub, 'pl', {
      includeCurrencyCode: true,
    });
    expect(display).toMatch(/^zł49[.,]00 PLN \/ mies\.$/);
  });

  it('respects locale for the interval label', () => {
    expect(formatRecurringProductPrice(baseSub, 'en')).toMatch(/\/ month$/);
    expect(formatRecurringProductPrice(baseSub, 'pl')).toMatch(/\/ mies\.$/);
  });

  it('handles multi-period subscriptions', () => {
    expect(
      formatRecurringProductPrice({ ...baseSub, billing_interval_count: 3 }, 'pl'),
    ).toMatch(/\/ co 3 mies\.$/);
    expect(
      formatRecurringProductPrice(
        { ...baseSub, billing_interval: 'year', billing_interval_count: 2 },
        'en',
      ),
    ).toMatch(/\/ every 2 years$/);
  });
});
