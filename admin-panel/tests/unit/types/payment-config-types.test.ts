/**
 * Unit Tests: Payment Config Type Helpers
 *
 * Test ID: UT-TYPE-001 to UT-TYPE-013
 * Coverage: Type validation and helper functions
 * Technique: Equivalence Partitioning, Boundary Value Analysis
 */

import { describe, it, expect } from 'vitest';
import {
  isPaymentMethodValidForCurrency,
  filterPaymentMethodsByCurrency,
  getOrderedPaymentMethods,
  isValidStripePMCId,
  type PaymentMethodMetadata,
} from '@/types/payment-config';

describe('payment-config-types', () => {
  describe('isPaymentMethodValidForCurrency', () => {
    // UT-TYPE-001: No restrictions (EP - Universal)
    it('should return true when method has no currency restrictions', () => {
      const method: PaymentMethodMetadata = {
        type: 'card',
        enabled: true,
        display_order: 0,
        currency_restrictions: [],
      };

      expect(isPaymentMethodValidForCurrency(method, 'USD')).toBe(true);
      expect(isPaymentMethodValidForCurrency(method, 'EUR')).toBe(true);
      expect(isPaymentMethodValidForCurrency(method, 'PLN')).toBe(true);
    });

    // UT-TYPE-002: Valid restriction (EP - Valid partition)
    it('should return true when currency matches restriction', () => {
      const method: PaymentMethodMetadata = {
        type: 'blik',
        enabled: true,
        display_order: 0,
        currency_restrictions: ['PLN'],
      };

      expect(isPaymentMethodValidForCurrency(method, 'PLN')).toBe(true);
    });

    // UT-TYPE-003: Invalid restriction (EP - Invalid partition)
    it('should return false when currency does not match restriction', () => {
      const method: PaymentMethodMetadata = {
        type: 'blik',
        enabled: true,
        display_order: 0,
        currency_restrictions: ['PLN'],
      };

      expect(isPaymentMethodValidForCurrency(method, 'USD')).toBe(false);
      expect(isPaymentMethodValidForCurrency(method, 'EUR')).toBe(false);
    });

    // UT-TYPE-004: Case insensitivity (BVA - Case handling)
    it('should be case insensitive for currency matching', () => {
      const method: PaymentMethodMetadata = {
        type: 'card',
        enabled: true,
        display_order: 0,
        currency_restrictions: ['USD', 'EUR'],
      };

      expect(isPaymentMethodValidForCurrency(method, 'usd')).toBe(true);
      expect(isPaymentMethodValidForCurrency(method, 'Usd')).toBe(true);
      expect(isPaymentMethodValidForCurrency(method, 'USD')).toBe(true);
    });

    it('should handle undefined currency_restrictions', () => {
      const method: PaymentMethodMetadata = {
        type: 'card',
        enabled: true,
        display_order: 0,
      };

      expect(isPaymentMethodValidForCurrency(method, 'USD')).toBe(true);
    });

    it('should handle multiple currency restrictions', () => {
      const method: PaymentMethodMetadata = {
        type: 'p24',
        enabled: true,
        display_order: 0,
        currency_restrictions: ['PLN', 'EUR'],
      };

      expect(isPaymentMethodValidForCurrency(method, 'PLN')).toBe(true);
      expect(isPaymentMethodValidForCurrency(method, 'EUR')).toBe(true);
      expect(isPaymentMethodValidForCurrency(method, 'USD')).toBe(false);
    });
  });

  describe('filterPaymentMethodsByCurrency', () => {
    // UT-TYPE-005: Empty array (BVA - Lower bound)
    it('should return empty array when input is empty', () => {
      const result = filterPaymentMethodsByCurrency([], 'PLN');
      expect(result).toEqual([]);
    });

    // UT-TYPE-006: All match (EP - Valid)
    it('should return all methods when all match currency', () => {
      const methods: PaymentMethodMetadata[] = [
        { type: 'card', enabled: true, display_order: 0, currency_restrictions: [] },
        { type: 'blik', enabled: true, display_order: 1, currency_restrictions: ['PLN', 'EUR'] },
      ];

      const result = filterPaymentMethodsByCurrency(methods, 'PLN');
      expect(result).toHaveLength(2);
      expect(result).toContainEqual(methods[0]);
      expect(result).toContainEqual(methods[1]);
    });

    // UT-TYPE-007: Partial match (EP - Mixed)
    it('should return only methods that match currency', () => {
      const methods: PaymentMethodMetadata[] = [
        { type: 'card', enabled: true, display_order: 0, currency_restrictions: [] },
        { type: 'blik', enabled: true, display_order: 1, currency_restrictions: ['PLN'] },
        { type: 'sepa_debit', enabled: true, display_order: 2, currency_restrictions: ['EUR'] },
      ];

      const result = filterPaymentMethodsByCurrency(methods, 'USD');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('card');
    });

    it('should filter correctly for PLN currency', () => {
      const methods: PaymentMethodMetadata[] = [
        { type: 'card', enabled: true, display_order: 0, currency_restrictions: [] },
        { type: 'blik', enabled: true, display_order: 1, currency_restrictions: ['PLN'] },
        { type: 'p24', enabled: true, display_order: 2, currency_restrictions: ['PLN', 'EUR'] },
        { type: 'sepa_debit', enabled: true, display_order: 3, currency_restrictions: ['EUR'] },
      ];

      const result = filterPaymentMethodsByCurrency(methods, 'PLN');
      expect(result).toHaveLength(3);
      expect(result.map(m => m.type)).toEqual(['card', 'blik', 'p24']);
    });

    it('should filter correctly for EUR currency', () => {
      const methods: PaymentMethodMetadata[] = [
        { type: 'card', enabled: true, display_order: 0, currency_restrictions: [] },
        { type: 'blik', enabled: true, display_order: 1, currency_restrictions: ['PLN'] },
        { type: 'sepa_debit', enabled: true, display_order: 2, currency_restrictions: ['EUR'] },
      ];

      const result = filterPaymentMethodsByCurrency(methods, 'EUR');
      expect(result).toHaveLength(2);
      expect(result.map(m => m.type)).toEqual(['card', 'sepa_debit']);
    });
  });

  describe('getOrderedPaymentMethods', () => {
    // UT-TYPE-008: Correct sorting (Algorithm validation)
    it('should sort methods by display_order ascending', () => {
      const methods: PaymentMethodMetadata[] = [
        { type: 'card', enabled: true, display_order: 2 },
        { type: 'blik', enabled: true, display_order: 0 },
        { type: 'p24', enabled: true, display_order: 1 },
      ];

      const result = getOrderedPaymentMethods(methods);
      expect(result.map(m => m.type)).toEqual(['blik', 'p24', 'card']);
    });

    it('should handle empty array', () => {
      const result = getOrderedPaymentMethods([]);
      expect(result).toEqual([]);
    });

    it('should handle single method', () => {
      const methods: PaymentMethodMetadata[] = [
        { type: 'card', enabled: true, display_order: 0 },
      ];

      const result = getOrderedPaymentMethods(methods);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('card');
    });

    it('should not mutate original array', () => {
      const methods: PaymentMethodMetadata[] = [
        { type: 'card', enabled: true, display_order: 2 },
        { type: 'blik', enabled: true, display_order: 0 },
      ];

      const original = [...methods];
      getOrderedPaymentMethods(methods);

      expect(methods).toEqual(original);
    });

    it('should handle same display_order (stable sort)', () => {
      const methods: PaymentMethodMetadata[] = [
        { type: 'card', enabled: true, display_order: 0 },
        { type: 'blik', enabled: true, display_order: 0 },
        { type: 'p24', enabled: true, display_order: 1 },
      ];

      const result = getOrderedPaymentMethods(methods);
      expect(result).toHaveLength(3);
      expect(result[2].type).toBe('p24');
    });
  });

  describe('isValidStripePMCId', () => {
    // UT-TYPE-009: Valid format (EP - Valid)
    it('should return true for valid Stripe PMC ID', () => {
      expect(isValidStripePMCId('pmc_1234567890')).toBe(true);
      expect(isValidStripePMCId('pmc_abcdefghijklmnop')).toBe(true);
      expect(isValidStripePMCId('pmc_1ABC2DEF3GHI')).toBe(true);
    });

    // UT-TYPE-010: Invalid prefix (EP - Invalid)
    it('should return false for invalid prefix', () => {
      expect(isValidStripePMCId('invalid_123')).toBe(false);
      expect(isValidStripePMCId('pk_123')).toBe(false);
      expect(isValidStripePMCId('sk_123')).toBe(false);
      expect(isValidStripePMCId('abc_123')).toBe(false);
    });

    // UT-TYPE-011: Null input (BVA - Null case)
    it('should return false for null input', () => {
      expect(isValidStripePMCId(null)).toBe(false);
    });

    // UT-TYPE-012: Empty string (BVA - Empty)
    it('should return false for empty string', () => {
      expect(isValidStripePMCId('')).toBe(false);
    });

    // UT-TYPE-013: Too short (BVA - Min length)
    it('should return false for too short ID', () => {
      expect(isValidStripePMCId('pmc_')).toBe(false);
      expect(isValidStripePMCId('pmc_1')).toBe(false);
      expect(isValidStripePMCId('pmc_12')).toBe(false);
      expect(isValidStripePMCId('pmc_123')).toBe(false);
    });

    it('should return false for undefined input', () => {
      expect(isValidStripePMCId(undefined)).toBe(false);
    });

    it('should return true for minimum valid length (pmc_ + 5 chars)', () => {
      expect(isValidStripePMCId('pmc_12345')).toBe(true);
    });

    it('should reject IDs with leading whitespace (prefix check fails)', () => {
      expect(isValidStripePMCId(' pmc_123456')).toBe(false);
    });

    it('should accept IDs with internal/trailing whitespace (known limitation: no whitespace check)', () => {
      // Current implementation only checks prefix and length, not character set.
      // These pass validation but are not valid Stripe PMC IDs in practice.
      // Stripe PMC IDs only contain alphanumeric chars after the pmc_ prefix.
      expect(isValidStripePMCId('pmc_ 123456')).toBe(true);  // 11 chars, meets minimum
      expect(isValidStripePMCId('pmc_1234 ')).toBe(true);    // 9 chars, meets minimum
    });

    it('should reject IDs with trailing whitespace when below minimum length', () => {
      expect(isValidStripePMCId('pmc_123 ')).toBe(false); // 8 chars, below minimum 9
    });
  });
});
