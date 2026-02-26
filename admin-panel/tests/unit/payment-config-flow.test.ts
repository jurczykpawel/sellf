/**
 * Payment Config Flow Tests
 *
 * Tests the full payment configuration flow:
 * - extractExpressCheckoutConfig: DB config -> frontend props (imported, tested directly)
 * - getEffectivePaymentConfig: product override -> global config resolution (imported, tested directly)
 * - create-payment-intent route: source verification that config_mode -> Stripe PaymentIntent params
 *
 * ============================================================================
 * SOURCE VERIFICATION PATTERN
 * ============================================================================
 * The create-payment-intent logic is inline in the route handler and cannot be
 * imported. Instead of maintaining a shadow copy, we verify the route source
 * contains the expected patterns for each config mode. These act as regression
 * guards to prevent accidental removal of critical Stripe integration logic.
 * ============================================================================
 *
 * @see /src/app/api/create-payment-intent/route.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  extractExpressCheckoutConfig,
  isPaymentMethodValidForCurrency,
  getEffectivePaymentConfig,
  type PaymentMethodConfig,
  type ExpressCheckoutConfig,
  type ProductPaymentConfigOverride,
} from '@/types/payment-config';
import {
  getEffectivePaymentMethodOrder,
  getEnabledPaymentMethodsForCurrency,
} from '@/lib/utils/payment-method-helpers';

// ---------------------------------------------------------------------------
// Route source for verification (read once)
// ---------------------------------------------------------------------------

const paymentIntentRoutePath = resolve(
  __dirname,
  '../../src/app/api/create-payment-intent/route.ts'
);
const paymentIntentRouteSource = readFileSync(paymentIntentRoutePath, 'utf-8');

const customPaymentFormPath = resolve(
  __dirname,
  '../../src/app/[locale]/checkout/[slug]/components/CustomPaymentForm.tsx'
);
const customPaymentFormSource = readFileSync(customPaymentFormPath, 'utf-8');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<PaymentMethodConfig> = {}): PaymentMethodConfig {
  return {
    id: 1,
    config_mode: 'automatic',
    custom_payment_methods: [],
    payment_method_order: [],
    currency_overrides: {},
    enable_express_checkout: true,
    enable_apple_pay: true,
    enable_google_pay: true,
    enable_link: true,
    available_payment_methods: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractExpressCheckoutConfig
// ---------------------------------------------------------------------------

describe('extractExpressCheckoutConfig', () => {
  it('should return all-enabled defaults when config is null or undefined', () => {
    const expected = { enabled: true, applePay: true, googlePay: true, link: true };
    expect(extractExpressCheckoutConfig(null)).toEqual(expected);
    expect(extractExpressCheckoutConfig(undefined)).toEqual(expected);
  });

  it('should map DB fields to frontend ExpressCheckoutConfig', () => {
    const config = makeConfig({
      enable_express_checkout: true,
      enable_apple_pay: false,
      enable_google_pay: true,
      enable_link: false,
    });

    const result = extractExpressCheckoutConfig(config);
    expect(result).toEqual({
      enabled: true,
      applePay: false,
      googlePay: true,
      link: false,
    });
  });

  it('should handle all toggles disabled', () => {
    const config = makeConfig({
      enable_express_checkout: false,
      enable_apple_pay: false,
      enable_google_pay: false,
      enable_link: false,
    });

    const result = extractExpressCheckoutConfig(config);
    expect(result).toEqual({
      enabled: false,
      applePay: false,
      googlePay: false,
      link: false,
    });
  });
});

// ---------------------------------------------------------------------------
// getEffectivePaymentConfig (product override resolution)
// ---------------------------------------------------------------------------

describe('getEffectivePaymentConfig', () => {
  it('should return global config when no product override exists', () => {
    const global = makeConfig({ config_mode: 'automatic' });
    const result = getEffectivePaymentConfig(global, null);
    expect(result.config_mode).toBe('automatic');
  });

  it('should return global config when product override is disabled', () => {
    const global = makeConfig({ config_mode: 'automatic' });
    const override: ProductPaymentConfigOverride = {
      override_enabled: false,
      config_mode: 'custom',
      custom_payment_methods: [{ type: 'card', enabled: true, display_order: 0 }],
    };

    const result = getEffectivePaymentConfig(global, override);
    expect(result.config_mode).toBe('automatic');
  });

  it('should use product override when enabled', () => {
    const global = makeConfig({ config_mode: 'automatic', enable_link: true });
    const override: ProductPaymentConfigOverride = {
      override_enabled: true,
      config_mode: 'custom',
      custom_payment_methods: [{ type: 'blik', enabled: true, display_order: 0 }],
      enable_link: false,
    };

    const result = getEffectivePaymentConfig(global, override);
    expect(result.config_mode).toBe('custom');
    expect(result.enable_link).toBe(false);
  });

  it('should merge override with global (override fields take precedence)', () => {
    const global = makeConfig({
      config_mode: 'automatic',
      enable_apple_pay: true,
      enable_google_pay: true,
    });
    const override: ProductPaymentConfigOverride = {
      override_enabled: true,
      config_mode: 'stripe_preset',
      stripe_pmc_id: 'pmc_product123',
      enable_google_pay: false,
    };

    const result = getEffectivePaymentConfig(global, override);
    expect(result.config_mode).toBe('stripe_preset');
    expect(result.stripe_pmc_id).toBe('pmc_product123');
    expect(result.enable_apple_pay).toBe(true); // from global
    expect(result.enable_google_pay).toBe(false); // from override
  });
});

// ---------------------------------------------------------------------------
// create-payment-intent route — source verification (regression guards)
// ---------------------------------------------------------------------------

describe('create-payment-intent route source verification', () => {
  it('automatic mode: applyAutomaticPaymentMethods helper with mutual exclusivity cleanup', () => {
    expect(paymentIntentRouteSource).toContain('function applyAutomaticPaymentMethods');
    expect(paymentIntentRouteSource).toContain('automatic_payment_methods');
    expect(paymentIntentRouteSource).toContain("allow_redirects: 'always'");
    expect(paymentIntentRouteSource).toContain("case 'automatic':");
    expect(paymentIntentRouteSource).toContain('applyAutomaticPaymentMethods(paymentIntentParams)');
  });

  it('stripe_preset mode: sets PMC ID with fallback to automatic', () => {
    expect(paymentIntentRouteSource).toContain("case 'stripe_preset':");
    expect(paymentIntentRouteSource).toContain('paymentIntentParams.payment_method_configuration = paymentConfig.stripe_pmc_id');
    expect(paymentIntentRouteSource).toMatch(/stripe_preset.*stripe_pmc_id/s);
    expect(paymentIntentRouteSource).toContain("falling back to automatic");
  });

  it('custom mode: uses getEnabledPaymentMethodsForCurrency with link append and fallback', () => {
    expect(paymentIntentRouteSource).toContain("case 'custom':");
    expect(paymentIntentRouteSource).toContain('getEnabledPaymentMethodsForCurrency');
    expect(paymentIntentRouteSource).toContain('paymentIntentParams.payment_method_types = enabledMethods');
    expect(paymentIntentRouteSource).toContain("paymentConfig.enable_link && !enabledMethods.includes('link')");
    expect(paymentIntentRouteSource).toContain('No payment methods match currency, falling back to automatic');
  });

  it('null config falls back to automatic mode', () => {
    expect(paymentIntentRouteSource).toContain('Payment config not found, using automatic mode');
    expect(paymentIntentRouteSource).toMatch(/\} else \{[\s\S]*?applyAutomaticPaymentMethods/);
  });

  it('mutual exclusivity: each branch deletes competing Stripe payment param fields', () => {
    const deleteAutomatic = (paymentIntentRouteSource.match(/delete.*automatic_payment_methods/g) || []).length;
    const deleteMethodTypes = (paymentIntentRouteSource.match(/delete.*payment_method_types/g) || []).length;
    const deleteMethodConfig = (paymentIntentRouteSource.match(/delete.*payment_method_configuration/g) || []).length;

    expect(deleteAutomatic).toBeGreaterThanOrEqual(2);
    expect(deleteMethodTypes).toBeGreaterThanOrEqual(2);
    expect(deleteMethodConfig).toBeGreaterThanOrEqual(2);
  });

  it('imports required dependencies and prevents accidental dual-setting', () => {
    expect(paymentIntentRouteSource).toContain("import { getEnabledPaymentMethodsForCurrency }");
    expect(paymentIntentRouteSource).toContain('PaymentMethodConfig');
    expect(paymentIntentRouteSource).toContain(
      'NOTE: automatic_payment_methods is set by the config switch below'
    );
  });
});

// ---------------------------------------------------------------------------
// Full checkout config pipeline (imported helpers + source verification)
// ---------------------------------------------------------------------------

describe('full checkout config pipeline', () => {
  it('automatic mode: express checkout all enabled, order is empty (Stripe decides)', () => {
    const config = makeConfig({ config_mode: 'automatic' });

    const expressConfig = extractExpressCheckoutConfig(config);
    expect(expressConfig.enabled).toBe(true);
    expect(expressConfig.link).toBe(true);

    const order = getEffectivePaymentMethodOrder(config, 'PLN');
    expect(order).toEqual([]);
  });

  it('custom mode PLN: BLIK first, card second + Link enabled', () => {
    const config = makeConfig({
      config_mode: 'custom',
      custom_payment_methods: [
        { type: 'blik', enabled: true, display_order: 0, currency_restrictions: ['PLN'] },
        { type: 'p24', enabled: true, display_order: 1, currency_restrictions: ['PLN', 'EUR'] },
        { type: 'card', enabled: true, display_order: 2, currency_restrictions: [] },
      ],
      payment_method_order: ['blik', 'p24', 'card'],
      enable_link: true,
    });

    const enabledMethods = getEnabledPaymentMethodsForCurrency(config, 'PLN');
    expect(enabledMethods).toEqual(['blik', 'p24', 'card']);

    const order = getEffectivePaymentMethodOrder(config, 'PLN');
    expect(order).toEqual(['blik', 'p24', 'card']);

    const expressConfig = extractExpressCheckoutConfig(config);
    expect(expressConfig.link).toBe(true);
  });

  it('custom mode EUR: filters out PLN-only methods', () => {
    const config = makeConfig({
      config_mode: 'custom',
      custom_payment_methods: [
        { type: 'blik', enabled: true, display_order: 0, currency_restrictions: ['PLN'] },
        { type: 'sepa_debit', enabled: true, display_order: 1, currency_restrictions: ['EUR'] },
        { type: 'card', enabled: true, display_order: 2, currency_restrictions: [] },
      ],
      currency_overrides: { EUR: ['sepa_debit', 'card'] },
    });

    const enabledMethods = getEnabledPaymentMethodsForCurrency(config, 'EUR');
    expect(enabledMethods).toEqual(['sepa_debit', 'card']);
    expect(enabledMethods).not.toContain('blik');

    const order = getEffectivePaymentMethodOrder(config, 'EUR');
    expect(order).toEqual(['sepa_debit', 'card']);
  });

  it('stripe_preset mode: express checkout configurable independently', () => {
    const config = makeConfig({
      config_mode: 'stripe_preset',
      stripe_pmc_id: 'pmc_production_eu',
      enable_express_checkout: true,
      enable_apple_pay: true,
      enable_google_pay: false,
      enable_link: true,
    });

    const expressConfig = extractExpressCheckoutConfig(config);
    expect(expressConfig.applePay).toBe(true);
    expect(expressConfig.googlePay).toBe(false);
    expect(expressConfig.link).toBe(true);
  });

  it('product override replaces global config for helper functions', () => {
    const global = makeConfig({
      config_mode: 'automatic',
      enable_link: true,
    });
    const override: ProductPaymentConfigOverride = {
      override_enabled: true,
      config_mode: 'custom',
      custom_payment_methods: [
        { type: 'card', enabled: true, display_order: 0 },
      ],
      payment_method_order: ['card'],
      enable_link: false,
    };

    const effective = getEffectivePaymentConfig(global, override);
    expect(effective.config_mode).toBe('custom');

    const methods = getEnabledPaymentMethodsForCurrency(effective, 'USD');
    expect(methods).toEqual(['card']);

    const expressConfig = extractExpressCheckoutConfig(effective);
    expect(expressConfig.link).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Link display mode — paymentMethodOrder (source verification)
// ---------------------------------------------------------------------------

describe('paymentMethodOrder — Link filtered out (CustomPaymentForm source verification)', () => {
  it('should filter out link from paymentMethodOrder and include currency-specific defaults', () => {
    expect(customPaymentFormSource).toContain("'link'");
    expect(customPaymentFormSource).toMatch(/filter.*link/);
    expect(customPaymentFormSource).toContain("'PLN'");
    expect(customPaymentFormSource).toContain("'EUR'");
    expect(customPaymentFormSource).toContain("'USD'");
    expect(customPaymentFormSource).toContain("'blik'");
  });

  it('extractExpressCheckoutConfig still reports link enabled state', () => {
    const configEnabled = makeConfig({ enable_link: true });
    const expressEnabled = extractExpressCheckoutConfig(configEnabled);
    expect(expressEnabled.link).toBe(true);

    const configDisabled = makeConfig({ enable_link: false });
    const expressDisabled = extractExpressCheckoutConfig(configDisabled);
    expect(expressDisabled.link).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Admin config -> helper functions: field mapping validation
// ---------------------------------------------------------------------------

describe('admin config field mapping (imported helpers)', () => {
  it('custom mode: disabled methods are excluded by getEnabledPaymentMethodsForCurrency', () => {
    const config = makeConfig({
      config_mode: 'custom',
      custom_payment_methods: [
        { type: 'blik', enabled: true, display_order: 0, currency_restrictions: ['PLN'] },
        { type: 'p24', enabled: false, display_order: 1, currency_restrictions: ['PLN'] },
        { type: 'card', enabled: true, display_order: 2, currency_restrictions: [] },
      ],
    });

    const methods = getEnabledPaymentMethodsForCurrency(config, 'PLN');
    expect(methods).toEqual(['blik', 'card']);
    expect(methods).not.toContain('p24');
  });

  it('custom mode: currency_restrictions filter works correctly across currencies', () => {
    const config = makeConfig({
      config_mode: 'custom',
      custom_payment_methods: [
        { type: 'blik', enabled: true, display_order: 0, currency_restrictions: ['PLN'] },
        { type: 'ideal', enabled: true, display_order: 1, currency_restrictions: ['EUR'] },
        { type: 'card', enabled: true, display_order: 2, currency_restrictions: [] },
        { type: 'p24', enabled: true, display_order: 3, currency_restrictions: ['PLN', 'EUR'] },
      ],
    });

    expect(getEnabledPaymentMethodsForCurrency(config, 'PLN')).toEqual(['blik', 'card', 'p24']);
    expect(getEnabledPaymentMethodsForCurrency(config, 'EUR')).toEqual(['ideal', 'card', 'p24']);
    expect(getEnabledPaymentMethodsForCurrency(config, 'USD')).toEqual(['card']);
    expect(getEnabledPaymentMethodsForCurrency(config, 'GBP')).toEqual(['card']);
  });

  it('custom mode: empty custom_payment_methods returns empty array', () => {
    const config = makeConfig({
      config_mode: 'custom',
      custom_payment_methods: [],
    });

    expect(getEnabledPaymentMethodsForCurrency(config, 'PLN')).toEqual([]);
  });

  it('custom mode: currency_overrides filters and reorders methods', () => {
    const config = makeConfig({
      config_mode: 'custom',
      custom_payment_methods: [
        { type: 'blik', enabled: true, display_order: 0, currency_restrictions: ['PLN'] },
        { type: 'p24', enabled: true, display_order: 1, currency_restrictions: ['PLN'] },
        { type: 'card', enabled: true, display_order: 2, currency_restrictions: [] },
      ],
      currency_overrides: { PLN: ['blik', 'card'] },
    });

    const methods = getEnabledPaymentMethodsForCurrency(config, 'PLN');
    expect(methods).toEqual(['blik', 'card']);
    expect(methods).not.toContain('p24');

    // EUR has no override -> falls back to globally enabled methods
    expect(getEnabledPaymentMethodsForCurrency(config, 'EUR')).toEqual(['card']);
  });

  it('custom mode: currency_overrides ignores globally disabled methods and preserves ordering', () => {
    const configWithDisabled = makeConfig({
      config_mode: 'custom',
      custom_payment_methods: [
        { type: 'blik', enabled: true, display_order: 0, currency_restrictions: ['PLN'] },
        { type: 'p24', enabled: false, display_order: 1, currency_restrictions: ['PLN'] },
        { type: 'card', enabled: true, display_order: 2, currency_restrictions: [] },
      ],
      currency_overrides: { PLN: ['blik', 'p24', 'card'] },
    });

    const methods = getEnabledPaymentMethodsForCurrency(configWithDisabled, 'PLN');
    expect(methods).toEqual(['blik', 'card']);
    expect(methods).not.toContain('p24');

    // Verify override ordering is preserved
    const configWithOrder = makeConfig({
      config_mode: 'custom',
      custom_payment_methods: [
        { type: 'blik', enabled: true, display_order: 0, currency_restrictions: ['PLN'] },
        { type: 'p24', enabled: true, display_order: 1, currency_restrictions: ['PLN'] },
        { type: 'card', enabled: true, display_order: 2, currency_restrictions: [] },
      ],
      currency_overrides: { PLN: ['card', 'p24', 'blik'] },
    });

    expect(getEnabledPaymentMethodsForCurrency(configWithOrder, 'PLN')).toEqual(['card', 'p24', 'blik']);
  });

  it('non-custom modes return empty array from getEnabledPaymentMethodsForCurrency', () => {
    const automaticConfig = makeConfig({ config_mode: 'automatic' });
    expect(getEnabledPaymentMethodsForCurrency(automaticConfig, 'PLN')).toEqual([]);

    const presetConfig = makeConfig({
      config_mode: 'stripe_preset',
      stripe_pmc_id: 'pmc_1QBxYZ2eZvKYlo2C0123abcd',
    });
    expect(getEnabledPaymentMethodsForCurrency(presetConfig, 'EUR')).toEqual([]);
  });

  it('express checkout config maps all DB field combinations correctly', () => {
    const combinations = [
      { express: true, apple: true, google: true, link: true },
      { express: true, apple: false, google: true, link: false },
      { express: false, apple: true, google: true, link: true },
      { express: true, apple: false, google: false, link: false },
    ];

    for (const combo of combinations) {
      const config = makeConfig({
        enable_express_checkout: combo.express,
        enable_apple_pay: combo.apple,
        enable_google_pay: combo.google,
        enable_link: combo.link,
      });

      const result = extractExpressCheckoutConfig(config);
      expect(result.enabled).toBe(combo.express);
      expect(result.applePay).toBe(combo.apple);
      expect(result.googlePay).toBe(combo.google);
      expect(result.link).toBe(combo.link);
    }
  });
});
