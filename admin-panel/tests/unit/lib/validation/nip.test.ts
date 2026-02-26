/**
 * NIP / Tax ID Validation Unit Tests
 *
 * Comprehensive tests for Polish NIP and international tax ID validation.
 * Covers all exported functions from @/lib/validation/nip:
 * - isPolishNIP, extractCountryCode, normalizeNIP, formatNIP
 * - validateNIPChecksum (weights [6,5,7,2,3,4,5,6,7], mod 11)
 * - validateTaxId (main validation entry point)
 */

import { describe, it, expect } from 'vitest';
import {
  isPolishNIP,
  extractCountryCode,
  normalizeNIP,
  formatNIP,
  validateNIPChecksum,
  validateTaxId,
} from '@/lib/validation/nip';

describe('isPolishNIP', () => {
  it('should return true for valid 10-digit NIP', () => {
    expect(isPolishNIP('5261040828')).toBe(true);
    expect(isPolishNIP('1234567890')).toBe(true);
  });

  it('should return true for NIP with PL prefix', () => {
    expect(isPolishNIP('PL5261040828')).toBe(true);
    expect(isPolishNIP('pl5261040828')).toBe(true);
  });

  it('should return false for non-Polish EU prefix', () => {
    expect(isPolishNIP('DE123456789')).toBe(false);
    expect(isPolishNIP('FR12345678901')).toBe(false);
  });

  it('should return false for short string', () => {
    expect(isPolishNIP('12345')).toBe(false);
    expect(isPolishNIP('123456789')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isPolishNIP('')).toBe(false);
  });

  it('should handle NIP with dashes and spaces', () => {
    expect(isPolishNIP('526-104-08-28')).toBe(true);
    expect(isPolishNIP('526 104 08 28')).toBe(true);
    expect(isPolishNIP('PL 526-104-08-28')).toBe(true);
  });

  it('should return false for too many digits', () => {
    expect(isPolishNIP('12345678901')).toBe(false);
    expect(isPolishNIP('PL12345678901')).toBe(false);
  });
});

describe('extractCountryCode', () => {
  it('should extract DE from DE123456789', () => {
    expect(extractCountryCode('DE123456789')).toBe('DE');
  });

  it('should return null for 10-digit number without prefix', () => {
    expect(extractCountryCode('5261040828')).toBeNull();
  });

  it('should extract PL from PL5261040828', () => {
    expect(extractCountryCode('PL5261040828')).toBe('PL');
  });

  it('should handle lowercase prefixes via uppercasing', () => {
    expect(extractCountryCode('pl5261040828')).toBe('PL');
    expect(extractCountryCode('de123456789')).toBe('DE');
  });

  it('should extract country code from tax IDs with spaces/dashes', () => {
    expect(extractCountryCode('PL 526-104-08-28')).toBe('PL');
    expect(extractCountryCode('DE 123 456 789')).toBe('DE');
  });

  it('should return null for single-letter prefix', () => {
    expect(extractCountryCode('A123456')).toBeNull();
  });

  it('should return null for purely numeric input', () => {
    expect(extractCountryCode('123456')).toBeNull();
  });
});

describe('normalizeNIP', () => {
  it('should strip dashes from NIP', () => {
    expect(normalizeNIP('526-104-08-28')).toBe('5261040828');
  });

  it('should strip spaces from NIP', () => {
    expect(normalizeNIP('526 104 08 28')).toBe('5261040828');
  });

  it('should strip PL prefix by default', () => {
    expect(normalizeNIP('PL5261040828')).toBe('5261040828');
    expect(normalizeNIP('PL 526-104-08-28')).toBe('5261040828');
    expect(normalizeNIP('pl5261040828')).toBe('5261040828');
  });

  it('should keep PL prefix when removePrefix=false', () => {
    expect(normalizeNIP('PL5261040828', false)).toBe('PL5261040828');
    expect(normalizeNIP('PL 526-104-08-28', false)).toBe('PL5261040828');
  });

  it('should keep non-PL prefixes regardless of removePrefix flag', () => {
    expect(normalizeNIP('DE123456789')).toBe('DE123456789');
    expect(normalizeNIP('DE123456789', true)).toBe('DE123456789');
    expect(normalizeNIP('FR12345678901')).toBe('FR12345678901');
  });

  it('should uppercase the result', () => {
    expect(normalizeNIP('pl5261040828')).toBe('5261040828');
    expect(normalizeNIP('de123456789')).toBe('DE123456789');
  });
});

describe('formatNIP', () => {
  it('should format 5261040828 as 526-104-08-28', () => {
    expect(formatNIP('5261040828')).toBe('526-104-08-28');
  });

  it('should format NIP with existing dashes correctly', () => {
    expect(formatNIP('526-104-08-28')).toBe('526-104-08-28');
  });

  it('should format NIP with PL prefix (strips prefix first)', () => {
    expect(formatNIP('PL5261040828')).toBe('526-104-08-28');
  });

  it('should return original string for invalid length', () => {
    expect(formatNIP('123')).toBe('123');
    expect(formatNIP('12345678901')).toBe('12345678901');
  });

  it('should format NIP with spaces', () => {
    expect(formatNIP('526 104 08 28')).toBe('526-104-08-28');
  });
});

describe('validateNIPChecksum', () => {
  it('should return true for known valid NIP 5261040828', () => {
    // 5*6+2*5+6*7+1*2+0*3+4*4+0*5+8*6+2*7 = 162, 162%11=8, last digit=8
    expect(validateNIPChecksum('5261040828')).toBe(true);
  });

  it('should return true for another valid NIP', () => {
    expect(validateNIPChecksum('5260250274')).toBe(true);
  });

  it('should return false for known invalid NIP 1234567890', () => {
    expect(validateNIPChecksum('1234567890')).toBe(false);
  });

  it('should return true for all zeros 0000000000 (checksum matches mathematically)', () => {
    // 0*6+0*5+0*7+0*2+0*3+0*4+0*5+0*6+0*7 = 0, 0%11=0, last digit=0
    // Checksum matches: sum mod 11 equals the last digit
    expect(validateNIPChecksum('0000000000')).toBe(true);
  });

  it('should return false for too short input', () => {
    expect(validateNIPChecksum('123')).toBe(false);
    expect(validateNIPChecksum('123456789')).toBe(false);
  });

  it('should return false for too long input', () => {
    expect(validateNIPChecksum('12345678901')).toBe(false);
  });

  it('should return false for non-numeric input', () => {
    expect(validateNIPChecksum('123456789A')).toBe(false);
    expect(validateNIPChecksum('abcdefghij')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(validateNIPChecksum('')).toBe(false);
  });

  it('should handle NIP with PL prefix (normalizes first)', () => {
    expect(validateNIPChecksum('PL5261040828')).toBe(true);
  });

  it('should handle NIP with dashes (normalizes first)', () => {
    expect(validateNIPChecksum('526-104-08-28')).toBe(true);
  });
});

describe('validateTaxId', () => {
  describe('valid Polish NIP', () => {
    it('should return valid result with all fields', () => {
      const result = validateTaxId('5261040828');
      expect(result.isValid).toBe(true);
      expect(result.isPolish).toBe(true);
      expect(result.countryCode).toBe('PL');
      expect(result.normalized).toBe('5261040828');
      expect(result.formatted).toBe('526-104-08-28');
      expect(result.withPrefix).toBe('PL5261040828');
      expect(result.error).toBeUndefined();
    });

    it('should validate Polish NIP with PL prefix', () => {
      const result = validateTaxId('PL5261040828');
      expect(result.isValid).toBe(true);
      expect(result.isPolish).toBe(true);
      expect(result.normalized).toBe('5261040828');
    });

    it('should validate Polish NIP with dashes and spaces', () => {
      const result = validateTaxId('PL 526-104-08-28');
      expect(result.isValid).toBe(true);
      expect(result.isPolish).toBe(true);
      expect(result.normalized).toBe('5261040828');
    });
  });

  describe('invalid Polish NIP checksum', () => {
    it('should return error containing checksum for bad NIP', () => {
      const result = validateTaxId('1234567890');
      expect(result.isValid).toBe(false);
      expect(result.isPolish).toBe(true);
      expect(result.error).toEqual(expect.stringContaining('checksum'));
    });
  });

  describe('too short input', () => {
    it('should return isValid false for very short tax ID', () => {
      const result = validateTaxId('DE123');
      expect(result.isValid).toBe(false);
    });

    it('should return isValid false for short numeric input', () => {
      const result = validateTaxId('12345');
      expect(result.isValid).toBe(false);
    });
  });

  describe('non-numeric Polish NIP', () => {
    it('should treat PL prefix with non-digit chars as international tax ID, not Polish', () => {
      // 'PLaBcDeFgHiJ' has PL prefix but remaining chars are not 10 digits,
      // so isPolishNIP returns false. It falls through to international validation
      // where PL prefix + length >= 8 makes it valid as generic international tax ID.
      const result = validateTaxId('PLaBcDeFgHiJ');
      expect(result.isValid).toBe(true);
      expect(result.isPolish).toBe(false);
      expect(result.countryCode).toBe('PL');
    });

    it('should reject short non-numeric input without country prefix', () => {
      const result = validateTaxId('abc');
      expect(result.isValid).toBe(false);
    });
  });

  describe('EU with prefix (non-strict)', () => {
    it('should validate DE tax ID as non-Polish', () => {
      const result = validateTaxId('DE123456789', false);
      expect(result.isValid).toBe(true);
      expect(result.isPolish).toBe(false);
      expect(result.countryCode).toBe('DE');
      expect(result.normalized).toBe('123456789');
    });

    it('should validate DE tax ID with strict mode too', () => {
      const result = validateTaxId('DE123456789', true);
      expect(result.isValid).toBe(true);
      expect(result.isPolish).toBe(false);
      expect(result.countryCode).toBe('DE');
    });

    it('should skip Polish checksum validation when strictPolishValidation=false', () => {
      const result = validateTaxId('PL1234567890', false);
      expect(result.isValid).toBe(true);
      expect(result.isPolish).toBe(true);
    });
  });

  describe('empty string', () => {
    it('should return isValid false with error message', () => {
      const result = validateTaxId('');
      expect(result.isValid).toBe(false);
      expect(result.isPolish).toBe(false);
      expect(result.error).toBe('Tax ID is required');
    });

    it('should reject whitespace-only input', () => {
      const result = validateTaxId('   ');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Tax ID is required');
    });
  });

  describe('international tax IDs', () => {
    it('should validate French VAT number', () => {
      const result = validateTaxId('FR12345678901');
      expect(result.isValid).toBe(true);
      expect(result.isPolish).toBe(false);
      expect(result.countryCode).toBe('FR');
    });

    it('should validate UK VAT number', () => {
      const result = validateTaxId('GB999999999');
      expect(result.isValid).toBe(true);
      expect(result.isPolish).toBe(false);
      expect(result.countryCode).toBe('GB');
    });

    it('should validate generic numeric tax ID if long enough', () => {
      const result = validateTaxId('12345678901');
      expect(result.isValid).toBe(true);
      expect(result.isPolish).toBe(false);
      expect(result.countryCode).toBeNull();
    });
  });
});
