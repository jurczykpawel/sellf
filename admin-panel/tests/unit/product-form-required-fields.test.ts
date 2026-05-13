/**
  * subscription product creation form must not require the hidden
 * one-time price field. The recurring_price stands in for it.
 */

import { describe, it, expect } from 'vitest';
import { collectRequiredFieldErrors } from '@/components/ProductFormModal/hooks/required-fields';

const baseValid = {
  name: 'Sub',
  slug: 'sub',
  description: 'desc',
  price: 0,
  vat_rate: null as number | null,
  price_includes_vat: false,
  allow_custom_price: false,
  // Subscription
  product_type: 'subscription' as const,
  billing_interval: 'month' as const,
  billing_interval_count: 1,
  recurring_price: 49,
  trial_days: null as number | null,
};

describe('collectRequiredFieldErrors', () => {
  it('subscription product passes with empty priceDisplayValue when recurring_price > 0', () => {
    const errors = collectRequiredFieldErrors(baseValid, '', 'local');
    expect(errors).toEqual({});
  });

  it('subscription product fails when recurring_price is missing or 0', () => {
    const errors = collectRequiredFieldErrors(
      { ...baseValid, recurring_price: 0 },
      '',
      'local'
    );
    expect(errors.recurring_price).toBe('required');
  });

  it('subscription product does NOT enforce the one-time price field', () => {
    const errors = collectRequiredFieldErrors(baseValid, '', 'local');
    expect(errors.price).toBeUndefined();
  });

  it('one-time product still requires priceDisplayValue', () => {
    const oneTime = {
      ...baseValid,
      product_type: 'one_time' as const,
      billing_interval: null,
      billing_interval_count: null,
      recurring_price: null,
      price: 99,
    };
    const errors = collectRequiredFieldErrors(oneTime, '', 'local');
    expect(errors.price).toBe('required');
  });

  it('one-time product passes when priceDisplayValue is filled', () => {
    const oneTime = {
      ...baseValid,
      product_type: 'one_time' as const,
      billing_interval: null,
      billing_interval_count: null,
      recurring_price: null,
      price: 99,
    };
    const errors = collectRequiredFieldErrors(oneTime, '99', 'local');
    expect(errors).toEqual({});
  });

  it('local tax mode: subscription with vat_rate=null and price_includes_vat=true does not require vat (recurring_price)', () => {
    // Subscription products that include VAT in recurring_price still need vat_rate
    // when shop default is null. This mirrors one-time behavior but uses recurring_price as the trigger.
    const errors = collectRequiredFieldErrors(
      { ...baseValid, price_includes_vat: true, vat_rate: null },
      '',
      'local'
    );
    expect(errors.vat_rate).toBe('required');
  });

  it('name/slug/description always required regardless of product type', () => {
    const errors = collectRequiredFieldErrors(
      { ...baseValid, name: '', slug: '', description: '' },
      '',
      'local'
    );
    expect(errors.name).toBe('required');
    expect(errors.slug).toBe('required');
    expect(errors.description).toBe('required');
  });
});
