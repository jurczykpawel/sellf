/**
 * buildSubscriptionSessionConfig (Phase 2 — Subscriptions MVP)
 *
 * Pure unit tests. No Stripe / Supabase calls.
 */

import { describe, it, expect } from 'vitest';
import { buildSubscriptionSessionConfig } from '@/lib/stripe/subscription-checkout';
import type { ValidatedProduct } from '@/lib/services/product-validation';
import type { CheckoutConfig } from '@/lib/stripe/checkout-config';

const baseProduct: ValidatedProduct = {
  id: 'prod-123',
  slug: 'monthly-plan',
  name: 'Monthly Plan',
  description: 'Pełen dostęp',
  price: 0,
  currency: 'PLN',
  is_active: true,
  available_from: null,
  available_until: null,
  vat_rate: null,
  price_includes_vat: false,
  product_type: 'subscription',
  billing_interval: 'month',
  billing_interval_count: 1,
  recurring_price: 49.0,
  trial_days: null,
};

const baseConfig: CheckoutConfig = {
  tax_mode: 'stripe_tax',
  automatic_tax: { enabled: true },
  tax_id_collection: { enabled: false },
  billing_address_collection: 'auto',
  expires_hours: 24,
  collect_terms_of_service: false,
  paymentMethodMode: 'automatic',
  payment_method_types: [],
  sources: {
    automatic_tax: 'default',
    tax_id_collection: 'default',
    billing_address_collection: 'default',
    expires_hours: 'default',
    collect_terms: 'default',
    payment_methods: 'default',
  },
  envExists: {
    automatic_tax: false,
    tax_id_collection: false,
    billing_address_collection: false,
    expires_hours: false,
    collect_terms: false,
    payment_methods: false,
  },
};

describe('buildSubscriptionSessionConfig', () => {
  it('uses the durable Stripe Price id on the line item (no inline price_data)', () => {
    const config = buildSubscriptionSessionConfig({
      product: baseProduct,
      customerId: 'cus_test',
      stripePriceId: 'price_durable_xyz',
      returnUrl: 'https://shop.example/return',
      checkoutConfig: baseConfig,
    });

    expect(config.mode).toBe('subscription');
    expect(config.customer).toBe('cus_test');
    expect(config.ui_mode).toBe('embedded_page');

    const lineItem = (config.line_items as Array<Record<string, unknown>>)[0];
    expect(lineItem.price).toBe('price_durable_xyz');
    expect(lineItem.price_data).toBeUndefined();
    expect(lineItem.quantity).toBe(1);
  });

  it('throws when stripePriceId is missing', () => {
    expect(() =>
      buildSubscriptionSessionConfig({
        product: baseProduct,
        customerId: 'cus_x',
        stripePriceId: '',
        returnUrl: 'https://x.test/r',
        checkoutConfig: baseConfig,
      })
    ).toThrow();
  });

  it('omits trial_period_days when trial_days is null or 0', () => {
    const noTrial = buildSubscriptionSessionConfig({
      product: { ...baseProduct, trial_days: null },
      customerId: 'cus_x',
      stripePriceId: 'price_test_fixture',
      returnUrl: 'https://x.test/r',
      checkoutConfig: baseConfig,
    });
    const zeroTrial = buildSubscriptionSessionConfig({
      product: { ...baseProduct, trial_days: 0 },
      customerId: 'cus_x',
      stripePriceId: 'price_test_fixture',
      returnUrl: 'https://x.test/r',
      checkoutConfig: baseConfig,
    });

    expect((noTrial.subscription_data as Record<string, unknown>).trial_period_days).toBeUndefined();
    expect((zeroTrial.subscription_data as Record<string, unknown>).trial_period_days).toBeUndefined();
  });

  it('includes trial_period_days when trial_days > 0', () => {
    const config = buildSubscriptionSessionConfig({
      product: { ...baseProduct, trial_days: 14 },
      customerId: 'cus_trial',
      stripePriceId: 'price_test_fixture',
      returnUrl: 'https://x.test/r',
      checkoutConfig: baseConfig,
    });

    expect((config.subscription_data as Record<string, unknown>).trial_period_days).toBe(14);
  });

  it('mirrors product / user metadata onto both session and subscription', () => {
    const config = buildSubscriptionSessionConfig({
      product: baseProduct,
      customerId: 'cus_meta',
      stripePriceId: 'price_test_fixture',
      returnUrl: 'https://x.test/r',
      userId: 'user-uuid-9',
      checkoutConfig: baseConfig,
    });

    expect(config.metadata).toMatchObject({
      product_id: 'prod-123',
      product_slug: 'monthly-plan',
      product_type: 'subscription',
      user_id: 'user-uuid-9',
    });
    expect((config.subscription_data as Record<string, unknown>).metadata).toMatchObject({
      product_id: 'prod-123',
      product_slug: 'monthly-plan',
      user_id: 'user-uuid-9',
    });
  });

  it('uses null user_id metadata for guests', () => {
    const config = buildSubscriptionSessionConfig({
      product: baseProduct,
      customerId: 'cus_guest',
      stripePriceId: 'price_test_fixture',
      returnUrl: 'https://x.test/r',
      checkoutConfig: baseConfig,
    });

    expect((config.metadata as Record<string, unknown>).user_id).toBeNull();
    expect(((config.subscription_data as Record<string, unknown>).metadata as Record<string, unknown>).user_id).toBeNull();
  });

  it('respects payment method config: automatic', () => {
    const config = buildSubscriptionSessionConfig({
      product: baseProduct,
      customerId: 'cus_x',
      stripePriceId: 'price_test_fixture',
      returnUrl: 'https://x.test/r',
      checkoutConfig: { ...baseConfig, paymentMethodMode: 'automatic' },
    });
    expect(config.automatic_payment_methods).toEqual({ enabled: true });
    expect(config.payment_method_types).toBeUndefined();
  });

  it('respects payment method config: stripe preset', () => {
    const config = buildSubscriptionSessionConfig({
      product: baseProduct,
      customerId: 'cus_x',
      stripePriceId: 'price_test_fixture',
      returnUrl: 'https://x.test/r',
      checkoutConfig: {
        ...baseConfig,
        paymentMethodMode: 'stripe_preset',
        stripePresetId: 'pmc_preset_123',
      },
    });
    expect(config.payment_method_configuration).toBe('pmc_preset_123');
    expect(config.automatic_payment_methods).toBeUndefined();
  });

  it('respects payment method config: explicit list', () => {
    const config = buildSubscriptionSessionConfig({
      product: baseProduct,
      customerId: 'cus_x',
      stripePriceId: 'price_test_fixture',
      returnUrl: 'https://x.test/r',
      checkoutConfig: {
        ...baseConfig,
        paymentMethodMode: 'custom',
        payment_method_types: ['card', 'p24'],
      },
    });
    expect(config.payment_method_types).toEqual(['card', 'p24']);
  });

  it('attaches local tax_rate to the line item when provided', () => {
    const config = buildSubscriptionSessionConfig({
      product: { ...baseProduct, vat_rate: 23, price_includes_vat: false },
      customerId: 'cus_x',
      stripePriceId: 'price_test_fixture',
      returnUrl: 'https://x.test/r',
      checkoutConfig: { ...baseConfig, tax_mode: 'local' },
      taxRateId: 'txr_abc',
    });
    const lineItem = (config.line_items as Array<Record<string, unknown>>)[0];
    expect(lineItem.tax_rates).toEqual(['txr_abc']);
  });

  it('throws when called on a one-time product', () => {
    expect(() =>
      buildSubscriptionSessionConfig({
        product: { ...baseProduct, product_type: 'one_time' },
        customerId: 'cus_x',
      stripePriceId: 'price_test_fixture',
        returnUrl: 'https://x.test/r',
        checkoutConfig: baseConfig,
      })
    ).toThrow();
  });

  it('throws when recurring fields are missing', () => {
    expect(() =>
      buildSubscriptionSessionConfig({
        product: { ...baseProduct, recurring_price: null },
        customerId: 'cus_x',
      stripePriceId: 'price_test_fixture',
        returnUrl: 'https://x.test/r',
        checkoutConfig: baseConfig,
      })
    ).toThrow();
  });

  it('emits consent_collection when collect_terms_of_service is true', () => {
    const config = buildSubscriptionSessionConfig({
      product: baseProduct,
      customerId: 'cus_x',
      stripePriceId: 'price_test_fixture',
      returnUrl: 'https://x.test/r',
      checkoutConfig: { ...baseConfig, collect_terms_of_service: true },
    });
    expect(config.consent_collection).toEqual({ terms_of_service: 'required' });
  });
});
