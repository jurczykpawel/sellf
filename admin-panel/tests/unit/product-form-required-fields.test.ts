/**
  * subscription product creation form must not require the hidden
 * one-time price field. The recurring_price stands in for it.
 */

import { describe, it, expect } from 'vitest';
import {
  collectRequiredFieldErrors,
  collectStep1FieldErrors,
} from '@/components/ProductFormModal/hooks/required-fields';

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
  ux_product_type: 'subscription' as const,
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
      ux_product_type: 'standard' as const,
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
      ux_product_type: 'standard' as const,
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

  it('name and slug are required, description is optional', () => {
    const errors = collectRequiredFieldErrors(
      { ...baseValid, name: '', slug: '', description: '' },
      '',
      'local'
    );
    expect(errors.name).toBe('required');
    expect(errors.slug).toBe('required');
    expect(errors.description).toBeUndefined();
  });

  describe('tip-jar / lead-magnet skip the price requirement', () => {
    const oneTimeBase = {
      ...baseValid,
      product_type: 'one_time' as const,
      billing_interval: null,
      billing_interval_count: null,
      recurring_price: null,
      price: 0,
    };

    it('tip-jar (allow_custom_price=true) does not require priceDisplayValue', () => {
      const errors = collectRequiredFieldErrors(
        { ...oneTimeBase, allow_custom_price: true, ux_product_type: 'tip-jar' as const },
        '',
        'local',
      );
      expect(errors.price).toBeUndefined();
    });

    it('PWYW products do not require priceDisplayValue even if UX type was not restored', () => {
      const errors = collectRequiredFieldErrors(
        { ...oneTimeBase, allow_custom_price: true, ux_product_type: 'standard' as const },
        '0',
        'local',
      );
      expect(errors.price).toBeUndefined();
    });

    it('lead-magnet (price=0 by design) does not require priceDisplayValue', () => {
      const errors = collectRequiredFieldErrors(
        { ...oneTimeBase, ux_product_type: 'lead-magnet' as const },
        '',
        'local',
      );
      expect(errors.price).toBeUndefined();
    });

    it('standard with price=0 fails — must pick lead-magnet for free product', () => {
      const errors = collectRequiredFieldErrors(
        { ...oneTimeBase, ux_product_type: 'standard' as const },
        '0',
        'local',
      );
      expect(errors.price).toBe('required');
    });

    it('standard with priceDisplayValue empty fails', () => {
      const errors = collectRequiredFieldErrors(
        { ...oneTimeBase, ux_product_type: 'standard' as const },
        '',
        'local',
      );
      expect(errors.price).toBe('required');
    });
  });
});

describe('collectStep1FieldErrors', () => {
  const baseStandard = {
    name: 'Foo',
    slug: 'foo',
    description: '', // description is step 2 — should NOT be required here
    price: 49,
    vat_rate: 23 as number | null,
    price_includes_vat: true,
    allow_custom_price: false,
    product_type: 'one_time' as const,
    billing_interval: null,
    billing_interval_count: null,
    recurring_price: null,
    trial_days: null,
    ux_product_type: 'standard' as const,
  };

  it('does NOT require description (description belongs to step 2)', () => {
    const errors = collectStep1FieldErrors(baseStandard, '49,00', 'local');
    expect(errors.description).toBeUndefined();
  });

  it('still requires name and price', () => {
    const errors = collectStep1FieldErrors(
      { ...baseStandard, name: '' },
      '',
      'local',
    );
    expect(errors.name).toBe('required');
    expect(errors.price).toBe('required');
  });

  it('tip-jar with just name filled passes step 1', () => {
    const errors = collectStep1FieldErrors(
      {
        ...baseStandard,
        ux_product_type: 'tip-jar' as const,
        allow_custom_price: true,
        price: 0,
      },
      '',
      'local',
    );
    expect(errors).toEqual({});
  });
});

describe('collectStep1FieldErrors — VAT exempt (zw.)', () => {
  const paidNoRate = {
    name: 'Foo',
    slug: 'foo',
    description: '',
    price: 49,
    vat_rate: null as number | null,
    price_includes_vat: true,
    allow_custom_price: false,
    product_type: 'one_time' as const,
    billing_interval: null,
    billing_interval_count: null,
    recurring_price: null,
    trial_days: null,
    ux_product_type: 'standard' as const,
  };

  it('baseline: requires vat_rate for a paid local product when NOT exempt', () => {
    const errors = collectStep1FieldErrors(paidNoRate, '49,00', 'local');
    expect(errors.vat_rate).toBe('required');
  });

  it('does NOT require vat_rate when the product is VAT-exempt (zw.)', () => {
    // "Zwolniony z VAT (zw.)" = no VAT at all → a rate is not applicable.
    const errors = collectStep1FieldErrors(
      { ...paidNoRate, vat_exempt: true },
      '49,00',
      'local',
    );
    expect(errors.vat_rate).toBeUndefined();
  });
});
