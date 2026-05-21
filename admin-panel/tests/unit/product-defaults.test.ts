import { describe, it, expect } from 'vitest';
import {
  applyProductTypeDefaults,
  inferProductTypeFromForm,
  UX_PRODUCT_TYPES_AVAILABLE,
  type UxProductType,
} from '@/lib/product-defaults';
import { initialFormData } from '@/components/ProductFormModal/types';
import { getTipJarDefaultCustomFields } from '@/lib/checkout-templates/tip-jar';

describe('product-defaults registry', () => {
  describe('UX type constants', () => {
    it('exposes the 4 available types in display order', () => {
      expect(UX_PRODUCT_TYPES_AVAILABLE).toEqual([
        'standard',
        'subscription',
        'tip-jar',
        'lead-magnet',
      ]);
    });
  });

  describe('applyProductTypeDefaults', () => {
    it('standard: ux_product_type, checkout_template, product_type, allow_custom_price set', () => {
      const result = applyProductTypeDefaults(initialFormData, 'standard');
      expect(result.ux_product_type).toBe('standard');
      expect(result.checkout_template).toBe('default');
      expect(result.product_type).toBe('one_time');
      expect(result.allow_custom_price).toBe(false);
    });

    it('subscription: product_type=subscription, defaults billing_interval=month', () => {
      const result = applyProductTypeDefaults(initialFormData, 'subscription');
      expect(result.checkout_template).toBe('default');
      expect(result.product_type).toBe('subscription');
      expect(result.billing_interval).toBe('month');
      expect(result.billing_interval_count).toBe(1);
      expect(result.allow_custom_price).toBe(false);
    });

    it('subscription: preserves user-set billing_interval', () => {
      const result = applyProductTypeDefaults(
        { ...initialFormData, billing_interval: 'year', billing_interval_count: 1 },
        'subscription',
      );
      expect(result.billing_interval).toBe('year');
    });

    it('tip-jar: checkout_template=tip-jar, allow_custom_price=true, seeds default fields when empty', () => {
      const result = applyProductTypeDefaults(initialFormData, 'tip-jar');
      expect(result.checkout_template).toBe('tip-jar');
      expect(result.allow_custom_price).toBe(true);
      expect(result.product_type).toBe('one_time');
      expect(result.custom_checkout_fields).toEqual(getTipJarDefaultCustomFields());
    });

    it('tip-jar: preserves user-defined custom fields when array non-empty', () => {
      const customFields = [
        { id: 'note', type: 'text' as const, label: 'Note', required: false, max_length: 200 },
      ];
      const result = applyProductTypeDefaults(
        { ...initialFormData, custom_checkout_fields: customFields },
        'tip-jar',
      );
      expect(result.custom_checkout_fields).toEqual(customFields);
    });

    it('tip-jar: sets PWYW defaults (min=1, presets [5,10,25], show_presets=true)', () => {
      const result = applyProductTypeDefaults(initialFormData, 'tip-jar');
      expect(result.custom_price_min).toBe(1);
      expect(result.custom_price_presets).toEqual([5, 10, 25]);
      expect(result.show_price_presets).toBe(true);
    });

    it('tip-jar: preserves user-tuned presets across re-selection', () => {
      const customized = applyProductTypeDefaults(initialFormData, 'tip-jar');
      const tuned = { ...customized, custom_price_presets: [10, 20, 50] };
      const result = applyProductTypeDefaults(tuned, 'tip-jar');
      expect(result.custom_price_presets).toEqual([10, 20, 50]);
    });

    it('lead-magnet: price=0, allow_custom_price=false, checkout_template=default', () => {
      const result = applyProductTypeDefaults(
        { ...initialFormData, price: 49 },
        'lead-magnet',
      );
      expect(result.price).toBe(0);
      expect(result.allow_custom_price).toBe(false);
      expect(result.checkout_template).toBe('default');
      expect(result.product_type).toBe('one_time');
    });

    it('switching from subscription to standard clears billing fields', () => {
      const result = applyProductTypeDefaults(
        {
          ...initialFormData,
          product_type: 'subscription',
          billing_interval: 'month',
          billing_interval_count: 1,
          recurring_price: 19,
          trial_days: 7,
        },
        'standard',
      );
      expect(result.product_type).toBe('one_time');
      expect(result.billing_interval).toBeNull();
      expect(result.billing_interval_count).toBeNull();
      expect(result.recurring_price).toBeNull();
      expect(result.trial_days).toBeNull();
    });

    it('preserves unrelated fields (name, slug, icon, categories)', () => {
      const input = {
        ...initialFormData,
        name: 'My Product',
        slug: 'my-product',
        icon: '🎯',
        categories: ['cat-1'],
      };
      const result = applyProductTypeDefaults(input, 'subscription');
      expect(result.name).toBe('My Product');
      expect(result.slug).toBe('my-product');
      expect(result.icon).toBe('🎯');
      expect(result.categories).toEqual(['cat-1']);
    });
  });

  describe('inferProductTypeFromForm', () => {
    it('returns tip-jar when checkout_template is tip-jar', () => {
      const t: UxProductType = inferProductTypeFromForm({
        ...initialFormData,
        checkout_template: 'tip-jar',
      });
      expect(t).toBe('tip-jar');
    });

    it('returns subscription when product_type is subscription', () => {
      const t = inferProductTypeFromForm({
        ...initialFormData,
        product_type: 'subscription',
      });
      expect(t).toBe('subscription');
    });

    it('returns lead-magnet for free standard product (price=0, no PWYW)', () => {
      // Inference is used only when bootstrapping a loaded product — the form's
      // ux_product_type field is the source of truth for fresh wizard state.
      expect(inferProductTypeFromForm(initialFormData)).toBe('lead-magnet');
    });

    it('returns standard for paid one-time product', () => {
      expect(
        inferProductTypeFromForm({ ...initialFormData, price: 49 }),
      ).toBe('standard');
    });

    it('checkout_template=oto with paid price falls through to standard', () => {
      expect(
        inferProductTypeFromForm({
          ...initialFormData,
          checkout_template: 'oto',
          price: 19,
        }),
      ).toBe('standard');
    });

    it('subscription takes precedence over price', () => {
      expect(
        inferProductTypeFromForm({
          ...initialFormData,
          product_type: 'subscription',
          price: 99,
        }),
      ).toBe('subscription');
    });

    it('tip-jar template takes precedence over subscription', () => {
      expect(
        inferProductTypeFromForm({
          ...initialFormData,
          checkout_template: 'tip-jar',
          product_type: 'subscription',
        }),
      ).toBe('tip-jar');
    });
  });
});
