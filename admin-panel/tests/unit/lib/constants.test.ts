/**
 * Constants Unit Tests
 *
 * Tests for currency formatting and constants.
 * Price output uses an explicit page locale.
 */

import { describe, it, expect } from 'vitest';
import { CURRENCIES, getCurrencySymbol, formatPrice } from '@/lib/constants';

describe('Currency Constants', () => {
  describe('CURRENCIES', () => {
    it('should have exactly 16 currencies with valid structure', () => {
      expect(CURRENCIES).toHaveLength(16);
      CURRENCIES.forEach(currency => {
        expect(typeof currency.code).toBe('string');
        expect(currency.code.length).toBe(3);
        expect(typeof currency.symbol).toBe('string');
        expect(currency.symbol.length).toBeGreaterThan(0);
        expect(typeof currency.name).toBe('string');
        expect(currency.name.length).toBeGreaterThan(0);
      });
    });

    it('should have unique codes', () => {
      const codes = CURRENCIES.map(c => c.code);
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(16);
    });

    it('should contain specific currency entries with correct symbols', () => {
      const usd = CURRENCIES.find(c => c.code === 'USD');
      expect(usd).toEqual({ code: 'USD', symbol: '$', name: 'US Dollar' });

      const eur = CURRENCIES.find(c => c.code === 'EUR');
      expect(eur).toEqual({ code: 'EUR', symbol: '\u20AC', name: 'Euro' });

      const pln = CURRENCIES.find(c => c.code === 'PLN');
      expect(pln).toEqual({ code: 'PLN', symbol: 'z\u0142', name: 'Polish Z\u0142oty' });

      const jpy = CURRENCIES.find(c => c.code === 'JPY');
      expect(jpy).toEqual({ code: 'JPY', symbol: '\u00A5', name: 'Japanese Yen' });

      const krw = CURRENCIES.find(c => c.code === 'KRW');
      expect(krw).toEqual({ code: 'KRW', symbol: '\u20A9', name: 'South Korean Won' });
    });
  });

  describe('getCurrencySymbol', () => {
    it('should return correct symbol for known currencies', () => {
      expect(getCurrencySymbol('USD')).toBe('$');
      expect(getCurrencySymbol('EUR')).toBe('€');
      expect(getCurrencySymbol('GBP')).toBe('£');
      expect(getCurrencySymbol('PLN')).toBe('zł');
      expect(getCurrencySymbol('JPY')).toBe('¥');
    });

    it('should return code for unknown currencies', () => {
      expect(getCurrencySymbol('XYZ')).toBe('XYZ');
      expect(getCurrencySymbol('UNKNOWN')).toBe('UNKNOWN');
    });

    it('should handle empty string', () => {
      expect(getCurrencySymbol('')).toBe('');
    });
  });

  describe('formatPrice', () => {
    it.each([
      [49, 'PLN', 'pl', '49,00\u00a0zł'],
      [12345.67, 'PLN', 'pl-PL', '12\u00a0345,67\u00a0zł'],
      [49, 'PLN', 'en', 'PLN\u00a049.00'],
      [49, 'USD', 'pl', '49,00\u00a0USD'],
      [49, 'USD', 'en', '$49.00'],
      [0, 'PLN', 'pl', '0,00\u00a0zł'],
      [-49, 'PLN', 'pl', '-49,00\u00a0zł'],
      [1500.7, 'JPY', 'pl', '1501\u00a0JPY'],
      [1000.7, 'KRW', 'en', '₩1,001'],
      [1000.7, 'VND', 'en', '₫1,001'],
      [49, 'pln', 'pl', '49,00\u00a0zł'],
    ])('formats %s %s for %s', (amount, currency, locale, expected) => {
      expect(formatPrice(amount, currency, locale)).toBe(expected);
    });

    describe('standard currencies (2 decimal places)', () => {
      it('should format USD with symbol and decimals', () => {
        const result = formatPrice(99.99, 'USD', 'en-US');
        expect(result).toContain('$');
        expect(result).toMatch(/99[.,]99/);
      });

      it('should format EUR with symbol and decimals', () => {
        const result = formatPrice(49.50, 'EUR', 'en-US');
        expect(result).toContain('€');
        expect(result).toMatch(/49[.,]50/);
      });

      it('should format GBP with symbol and decimals', () => {
        const result = formatPrice(29.99, 'GBP', 'en-US');
        expect(result).toContain('£');
        expect(result).toMatch(/29[.,]99/);
      });

      it('should format PLN with symbol and decimals', () => {
        const result = formatPrice(199.00, 'PLN', 'en-US');
        expect(result).toContain('PLN');
        expect(result).toMatch(/199[.,]00/);
      });

      it('should add trailing zeros', () => {
        const usd = formatPrice(100, 'USD', 'en-US');
        expect(usd).toContain('$');
        expect(usd).toMatch(/100[.,]00/);

        const eur = formatPrice(50.5, 'EUR', 'en-US');
        expect(eur).toContain('€');
        expect(eur).toMatch(/50[.,]50/);
      });

      it('should round to 2 decimal places', () => {
        const rounded = formatPrice(99.999, 'USD', 'en-US');
        expect(rounded).toContain('$');
        expect(rounded).toMatch(/100[.,]00/);
      });
    });

    describe('zero-decimal currencies (JPY, KRW)', () => {
      it('should format JPY without decimals', () => {
        const result = formatPrice(1000, 'JPY', 'en-US');
        expect(result).toContain('¥');
        expect(result).toMatch(/1[,.\s]?000/);
        // Should not have decimal point
        expect(result).not.toMatch(/1000\./);
      });

      it('should format KRW without decimals', () => {
        const result = formatPrice(50000, 'KRW', 'en-US');
        expect(result).toContain('₩');
        expect(result).toMatch(/50[,.\s]?000/);
      });

      it('should round to nearest integer for JPY', () => {
        const rounded1 = formatPrice(1500.7, 'JPY', 'en-US');
        expect(rounded1).toContain('¥');
        expect(rounded1).toMatch(/1[,.\s]?501/);

        const rounded2 = formatPrice(1500.4, 'JPY', 'en-US');
        expect(rounded2).toContain('¥');
        expect(rounded2).toMatch(/1[,.\s]?500/);
      });
    });

    describe('unknown currencies', () => {
      it('should use code as symbol for unknown currency', () => {
        const result = formatPrice(100, 'XYZ', 'en-US');
        expect(result).toContain('XYZ');
        expect(result).toMatch(/100[.,]00/);
      });
    });

    describe('edge cases', () => {
      it('should handle zero', () => {
        const zeroUsd = formatPrice(0, 'USD', 'en-US');
        expect(zeroUsd).toContain('$');
        expect(zeroUsd).toContain('0');

        const zeroJpy = formatPrice(0, 'JPY', 'en-US');
        expect(zeroJpy).toContain('¥');
        expect(zeroJpy).toContain('0');
      });

      it('should handle very small amounts', () => {
        const result = formatPrice(0.01, 'USD', 'en-US');
        expect(result).toContain('$');
        expect(result).toMatch(/0[.,]01/);
      });

      it('should handle negative amounts', () => {
        const result = formatPrice(-99.99, 'USD', 'en-US');
        expect(result).toContain('$');
        expect(result).toContain('-');
        expect(result).toMatch(/99[.,]99/);
      });
    });
  });
});
