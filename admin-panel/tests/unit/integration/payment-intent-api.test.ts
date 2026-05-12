/**
 * Integration Tests: Checkout Session Payment Configuration
 *
 * Test ID: IT-CS-001 to IT-CS-009
 * Coverage: Checkout Session payment method configuration
 * Focus: payment method selection based on config mode
 *
 * Tests verify config -> Checkout Session parameter mapping logic using real
 * exported functions from @/lib/utils/payment-method-helpers.
 */

import { describe, it, expect } from 'vitest';
import type { PaymentMethodConfig } from '@/types/payment-config';
import {
  getEnabledPaymentMethodsForCurrency,
  getEffectivePaymentMethodOrder,
  RECOMMENDED_CONFIG,
} from '@/lib/utils/payment-method-helpers';

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

describe('Checkout Session API - Config Integration', () => {
  describe('Checkout Session payment method generation', () => {
    // IT-CS-001: Custom mode
    it('should use payment_method_types for custom mode', () => {
      const config = makeConfig({
        config_mode: 'custom',
        custom_payment_methods: [
          { type: 'card', enabled: true, display_order: 0 },
          { type: 'blik', enabled: true, display_order: 1, currency_restrictions: ['PLN'] },
        ],
        payment_method_order: ['card', 'blik'],
      });

      const enabledMethods = getEnabledPaymentMethodsForCurrency(config, 'PLN');

      expect(config.config_mode).toBe('custom');
      expect(enabledMethods).toEqual(['card', 'blik']);
      expect(enabledMethods).toContain('card');
      expect(enabledMethods).toContain('blik');
    });

    // IT-CS-002: Custom mode with currency filter
    it('should filter payment methods by currency in custom mode', () => {
      const config = makeConfig({
        config_mode: 'custom',
        custom_payment_methods: [
          { type: 'card', enabled: true, display_order: 0 },
          { type: 'blik', enabled: true, display_order: 1, currency_restrictions: ['PLN'] },
        ],
        payment_method_order: ['card', 'blik'],
      });

      // For USD currency, BLIK should be filtered out
      const enabledMethodsUSD = getEnabledPaymentMethodsForCurrency(config, 'USD');

      expect(enabledMethodsUSD).toEqual(['card']);
      expect(enabledMethodsUSD).not.toContain('blik');
    });

    // IT-CS-003: Automatic mode returns empty array
    it('should return empty array for automatic mode', () => {
      const config = makeConfig({ config_mode: 'automatic' });
      const result = getEnabledPaymentMethodsForCurrency(config, 'USD');
      expect(result).toEqual([]);
    });

    // IT-CS-004: Stripe preset mode returns empty array
    it('should return empty array for stripe_preset mode', () => {
      const config = makeConfig({
        config_mode: 'stripe_preset',
        stripe_pmc_id: 'pmc_test12345',
      });
      const result = getEnabledPaymentMethodsForCurrency(config, 'USD');
      expect(result).toEqual([]);
    });

    // IT-CS-005: Custom mode with currency_overrides filters correctly
    it('should filter by currency_overrides when present', () => {
      const config = makeConfig({
        config_mode: 'custom',
        custom_payment_methods: [
          { type: 'card', enabled: true, display_order: 0 },
          { type: 'blik', enabled: true, display_order: 1, currency_restrictions: ['PLN'] },
          { type: 'p24', enabled: true, display_order: 2, currency_restrictions: ['PLN', 'EUR'] },
        ],
        payment_method_order: ['card', 'blik', 'p24'],
        currency_overrides: {
          PLN: ['card', 'blik'],
        },
      });

      // PLN should return only the overridden methods that are also enabled
      const plnMethods = getEnabledPaymentMethodsForCurrency(config, 'PLN');
      expect(plnMethods).toEqual(['card', 'blik']);
      expect(plnMethods).not.toContain('p24');

      // USD has no override, falls back to globally enabled methods valid for USD
      const usdMethods = getEnabledPaymentMethodsForCurrency(config, 'USD');
      expect(usdMethods).toEqual(['card']);
    });
  });

  describe('RECOMMENDED_CONFIG', () => {
    // IT-CS-006: Recommended config has expected shape
    it('should have expected shape', () => {
      expect(RECOMMENDED_CONFIG.config_mode).toBe('custom');
      expect(Array.isArray(RECOMMENDED_CONFIG.custom_payment_methods)).toBe(true);
      expect(RECOMMENDED_CONFIG.custom_payment_methods.length).toBeGreaterThan(0);
      expect(typeof RECOMMENDED_CONFIG.enable_express_checkout).toBe('boolean');
      expect(RECOMMENDED_CONFIG.enable_express_checkout).toBe(true);
      expect(Array.isArray(RECOMMENDED_CONFIG.payment_method_order)).toBe(true);
      expect(RECOMMENDED_CONFIG.payment_method_order).toContain('blik');
      expect(RECOMMENDED_CONFIG.payment_method_order).toContain('card');
    });
  });

  describe('Payment method ordering', () => {
    // IT-CS-007: getEffectivePaymentMethodOrder returns ordered list
    it('should return payment_method_order from config', () => {
      const config = makeConfig({
        config_mode: 'custom',
        payment_method_order: ['blik', 'p24', 'card'],
      });

      const order = getEffectivePaymentMethodOrder(config, 'USD');
      expect(order).toEqual(['blik', 'p24', 'card']);
    });

    // IT-CS-008: getEffectivePaymentMethodOrder with currency override
    it('should use currency override order when available', () => {
      const config = makeConfig({
        config_mode: 'custom',
        payment_method_order: ['card', 'blik'],
        currency_overrides: {
          PLN: ['blik', 'card'],
        },
      });

      // PLN has an override
      const plnOrder = getEffectivePaymentMethodOrder(config, 'PLN');
      expect(plnOrder).toEqual(['blik', 'card']);

      // USD has no override, falls back to global order
      const usdOrder = getEffectivePaymentMethodOrder(config, 'USD');
      expect(usdOrder).toEqual(['card', 'blik']);
    });

    it('should return empty array when no order is configured', () => {
      const config = makeConfig({
        config_mode: 'custom',
        payment_method_order: [],
        currency_overrides: {},
      });

      const order = getEffectivePaymentMethodOrder(config, 'USD');
      expect(order).toEqual([]);
    });
  });

  describe('Error handling', () => {
    // IT-CS-009: Empty custom_payment_methods
    it('should handle empty custom_payment_methods array', () => {
      const config = makeConfig({
        config_mode: 'custom',
        custom_payment_methods: [],
      });

      const enabledMethods = getEnabledPaymentMethodsForCurrency(config, 'PLN');
      expect(enabledMethods).toEqual([]);
    });
  });
});
