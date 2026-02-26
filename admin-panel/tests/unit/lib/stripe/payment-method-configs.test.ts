/**
 * Unit Tests: Stripe Payment Method Config Helpers
 *
 * Test ID: UT-STRIPE-001 to UT-STRIPE-013
 * Coverage: Stripe API helper functions
 * Technique: Equivalence Partitioning, Boundary Value Analysis
 */

import { describe, it, expect } from 'vitest';
import {
  extractEnabledPaymentMethods,
  getPaymentMethodInfo,
  isPaymentMethodSupportedForCurrency,
  filterPaymentMethodTypesByCurrency,
  isValidStripePMCId,
  isValidPaymentMethodType,
  getPaymentMethodConfigDisplayName,
  type StripePaymentMethodConfig,
} from '@/lib/stripe/payment-method-configs';

describe('payment-method-configs', () => {
  describe('extractEnabledPaymentMethods', () => {
    // UT-STRIPE-001: All enabled (EP - Valid)
    it('should extract all enabled payment methods in order', () => {
      const config: StripePaymentMethodConfig = {
        id: 'pmc_123',
        name: 'All Methods',
        active: true,
        livemode: false,
        created: Date.now(),
        card: { enabled: true },
        blik: { enabled: true },
        p24: { enabled: true },
        sepa_debit: { enabled: true },
      };

      const result = extractEnabledPaymentMethods(config);
      expect(result).toEqual(['card', 'blik', 'p24', 'sepa_debit']);
    });

    // UT-STRIPE-002: None enabled (BVA - Empty result)
    it('should return empty array when no methods enabled', () => {
      const config: StripePaymentMethodConfig = {
        id: 'pmc_123',
        name: 'Empty',
        active: true,
        livemode: false,
        created: Date.now(),
        card: { enabled: false },
        blik: { enabled: false },
      };

      const result = extractEnabledPaymentMethods(config);
      expect(result).toEqual([]);
    });

    // UT-STRIPE-003: Mixed enabled (EP - Partial)
    it('should extract only enabled methods from mixed config', () => {
      const config: StripePaymentMethodConfig = {
        id: 'pmc_123',
        name: 'Mixed',
        active: true,
        livemode: false,
        created: Date.now(),
        card: { enabled: true },
        blik: { enabled: false },
        p24: { enabled: true },
      };

      const result = extractEnabledPaymentMethods(config);
      expect(result).toEqual(['card', 'p24']);
    });

    it('should handle config with no payment method fields', () => {
      const config: StripePaymentMethodConfig = {
        id: 'pmc_123',
        name: 'Empty',
        active: true,
        livemode: false,
        created: Date.now(),
      };

      const result = extractEnabledPaymentMethods(config);
      expect(result).toEqual([]);
    });

    it('should handle config with undefined enabled property', () => {
      const config: StripePaymentMethodConfig = {
        id: 'pmc_123',
        name: 'Undefined',
        active: true,
        livemode: false,
        created: Date.now(),
        card: {} as any, // Missing enabled property
      };

      const result = extractEnabledPaymentMethods(config);
      expect(result).toEqual([]);
    });

    it('should ignore non-payment-method fields on the config object', () => {
      const config: StripePaymentMethodConfig = {
        id: 'pmc_123',
        name: 'Only card',
        active: true,
        livemode: false,
        created: Date.now(),
        card: { enabled: true },
      };

      const result = extractEnabledPaymentMethods(config);
      expect(result).toEqual(['card']);
      // Metadata fields should not appear in the result
      expect(result).not.toContain('id');
      expect(result).not.toContain('name');
      expect(result).not.toContain('active');
    });
  });

  describe('getPaymentMethodInfo', () => {
    // UT-STRIPE-004: Valid type (EP - Valid)
    it('should return payment method info for valid type', () => {
      const info = getPaymentMethodInfo('blik');

      expect(info).not.toBeNull();
      expect(info?.type).toBe('blik');
      expect(info?.name).toBe('BLIK');
      expect(typeof info?.icon).toBe('string');
      expect(info?.currencies).toContain('PLN');
    });

    // UT-STRIPE-005: Invalid type (EP - Invalid)
    it('should return null for invalid payment method type', () => {
      const info = getPaymentMethodInfo('invalid_type');
      expect(info).toBeNull();
    });

    it('should return info for card', () => {
      const info = getPaymentMethodInfo('card');

      expect(info).not.toBeNull();
      expect(info?.type).toBe('card');
      expect(info?.currencies).toContain('*');
    });

    it('should return info for sepa_debit', () => {
      const info = getPaymentMethodInfo('sepa_debit');

      expect(info).not.toBeNull();
      expect(info?.type).toBe('sepa_debit');
      expect(info?.currencies).toContain('EUR');
    });

    it('should return null for empty string', () => {
      expect(getPaymentMethodInfo('')).toBeNull();
    });

    it('should return null for similar but wrong type names', () => {
      expect(getPaymentMethodInfo('cards')).toBeNull();
      expect(getPaymentMethodInfo('BLIK')).toBeNull();
      expect(getPaymentMethodInfo('sepa-debit')).toBeNull();
    });
  });

  describe('isPaymentMethodSupportedForCurrency', () => {
    // UT-STRIPE-006: Universal method (EP - Universal)
    it('should return true for universal payment method (card)', () => {
      expect(isPaymentMethodSupportedForCurrency('card', 'USD')).toBe(true);
      expect(isPaymentMethodSupportedForCurrency('card', 'EUR')).toBe(true);
      expect(isPaymentMethodSupportedForCurrency('card', 'PLN')).toBe(true);
    });

    // UT-STRIPE-007: Currency match (EP - Valid)
    it('should return true when currency matches method support', () => {
      expect(isPaymentMethodSupportedForCurrency('blik', 'PLN')).toBe(true);
      expect(isPaymentMethodSupportedForCurrency('sepa_debit', 'EUR')).toBe(true);
    });

    // UT-STRIPE-008: Currency mismatch (EP - Invalid)
    it('should return false when currency does not match', () => {
      expect(isPaymentMethodSupportedForCurrency('blik', 'USD')).toBe(false);
      expect(isPaymentMethodSupportedForCurrency('sepa_debit', 'PLN')).toBe(false);
    });

    // UT-STRIPE-009: Case insensitive (BVA - Case)
    it('should be case insensitive for currency code', () => {
      expect(isPaymentMethodSupportedForCurrency('blik', 'pln')).toBe(true);
      expect(isPaymentMethodSupportedForCurrency('blik', 'Pln')).toBe(true);
      expect(isPaymentMethodSupportedForCurrency('blik', 'PLN')).toBe(true);
    });

    it('should return false for invalid payment method type', () => {
      expect(isPaymentMethodSupportedForCurrency('invalid', 'USD')).toBe(false);
    });

    it('should handle multi-currency payment methods', () => {
      // Klarna supports multiple currencies
      expect(isPaymentMethodSupportedForCurrency('klarna', 'USD')).toBe(true);
      expect(isPaymentMethodSupportedForCurrency('klarna', 'EUR')).toBe(true);
      expect(isPaymentMethodSupportedForCurrency('klarna', 'GBP')).toBe(true);
    });
  });

  describe('filterPaymentMethodTypesByCurrency', () => {
    // UT-STRIPE-010: All match (EP - All valid)
    it('should return all types when all support currency', () => {
      const types = ['card', 'blik', 'p24'];
      const result = filterPaymentMethodTypesByCurrency(types, 'PLN');

      expect(result).toEqual(['card', 'blik', 'p24']);
    });

    // UT-STRIPE-011: Partial match (EP - Mixed)
    it('should filter out unsupported types', () => {
      const types = ['card', 'blik', 'sepa_debit'];
      const result = filterPaymentMethodTypesByCurrency(types, 'PLN');

      expect(result).toEqual(['card', 'blik']);
      expect(result).not.toContain('sepa_debit');
    });

    it('should return empty array when no types match', () => {
      const types = ['blik', 'sepa_debit'];
      const result = filterPaymentMethodTypesByCurrency(types, 'JPY');

      expect(result).toEqual([]);
    });

    it('should handle empty input array', () => {
      const result = filterPaymentMethodTypesByCurrency([], 'USD');
      expect(result).toEqual([]);
    });

    it('should handle invalid payment method types', () => {
      const types = ['card', 'invalid_type', 'blik'];
      const result = filterPaymentMethodTypesByCurrency(types, 'PLN');

      expect(result).toContain('card');
      expect(result).toContain('blik');
      expect(result).not.toContain('invalid_type');
    });
  });

  describe('isValidStripePMCId', () => {
    // UT-STRIPE-012: Valid format (EP - Valid)
    it('should return true for valid Stripe PMC ID', () => {
      expect(isValidStripePMCId('pmc_1234567890')).toBe(true);
      expect(isValidStripePMCId('pmc_abcdefg')).toBe(true);
    });

    it('should return false for invalid prefix', () => {
      expect(isValidStripePMCId('invalid_123')).toBe(false);
      expect(isValidStripePMCId('pk_123')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isValidStripePMCId(null)).toBe(false);
      expect(isValidStripePMCId(undefined)).toBe(false);
    });

    it('should return false for too short ID', () => {
      expect(isValidStripePMCId('pmc_')).toBe(false);
      expect(isValidStripePMCId('pmc_123')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidStripePMCId('')).toBe(false);
    });

    it('should return false for pmc_ prefix with only short suffix', () => {
      expect(isValidStripePMCId('pmc_abcd')).toBe(false);
    });

    it('should return true for pmc_ prefix with 5+ char suffix (min valid)', () => {
      expect(isValidStripePMCId('pmc_abcde')).toBe(true);
    });
  });

  describe('isValidPaymentMethodType', () => {
    // UT-STRIPE-013: Valid type (EP - Valid)
    it('should return true for valid payment method types', () => {
      expect(isValidPaymentMethodType('card')).toBe(true);
      expect(isValidPaymentMethodType('blik')).toBe(true);
      expect(isValidPaymentMethodType('sepa_debit')).toBe(true);
      expect(isValidPaymentMethodType('ideal')).toBe(true);
    });

    // UT-STRIPE-013: Invalid type (EP - Invalid)
    it('should return false for invalid payment method type', () => {
      expect(isValidPaymentMethodType('fake_method')).toBe(false);
      expect(isValidPaymentMethodType('invalid')).toBe(false);
      expect(isValidPaymentMethodType('')).toBe(false);
    });

    it('should be case sensitive', () => {
      expect(isValidPaymentMethodType('CARD')).toBe(false);
      expect(isValidPaymentMethodType('Card')).toBe(false);
      expect(isValidPaymentMethodType('card')).toBe(true);
    });
  });

  describe('getPaymentMethodConfigDisplayName', () => {
    it('should return name if provided in config', () => {
      const config: StripePaymentMethodConfig = {
        id: 'pmc_123',
        name: 'Custom Name',
        active: true,
        livemode: false,
        created: Date.now(),
      };

      expect(getPaymentMethodConfigDisplayName(config)).toBe('Custom Name');
    });

    it('should generate name from enabled methods when no name', () => {
      const config: StripePaymentMethodConfig = {
        id: 'pmc_123',
        name: '',
        active: true,
        livemode: false,
        created: Date.now(),
        card: { enabled: true },
        blik: { enabled: true },
      };

      const result = getPaymentMethodConfigDisplayName(config);
      expect(result).toBe('Custom: card + blik');
    });

    it('should handle empty config', () => {
      const config: StripePaymentMethodConfig = {
        id: 'pmc_123',
        name: '',
        active: true,
        livemode: false,
        created: Date.now(),
      };

      expect(getPaymentMethodConfigDisplayName(config)).toBe('Empty Configuration');
    });

    it('should truncate long method lists', () => {
      const config: StripePaymentMethodConfig = {
        id: 'pmc_123',
        name: '',
        active: true,
        livemode: false,
        created: Date.now(),
        card: { enabled: true },
        blik: { enabled: true },
        p24: { enabled: true },
        sepa_debit: { enabled: true },
        ideal: { enabled: true },
      };

      const result = getPaymentMethodConfigDisplayName(config);
      expect(result).toMatch(/\+\d+ more$/); // Should say "+X more"
    });
  });
});
