/**
 * Unit tests for license verification
 *
 * Test licenses below are FIXTURES signed with the real ECDSA private key
 * (via scripts/generate-license.js). This is the correct way to test crypto:
 * the production code verifies signatures against the embedded public key,
 * and these fixtures let us confirm that valid signatures pass and any
 * modification (tampered domain, expiry, or signature bytes) causes rejection.
 */

import { describe, it, expect } from 'vitest';
import {
  parseLicense,
  verifyLicenseSignature,
  parseExpiryDate,
  isLicenseExpired,
  doesDomainMatch,
  extractDomainFromUrl,
  getLicenseInfo,
  validateLicense,
  isValidLicenseFormat,
} from '../../src/lib/license/verify';

describe('License Verification', () => {
  // Fixtures: real ECDSA P-256 signatures generated with the private key
  const VALID_LICENSE_UNLIMITED = 'SF-test.example.com-UNLIMITED-MEUCIEHqYzD3xj-ro61wuTmeBnXI7atQ3d_NWX6QcZUk05zrAiEA53-g5nGLU3_hR2OZfCeUruyVU3lY_57ZQbmO4obico8';
  const VALID_LICENSE_DATED = 'SF-test.example.com-20301231-MEQCIFsw5GEhrFgVQnq-fz0qVEs3vXbo4u6iMsi5S6gJw43PAiACNsshNQIqPLGwVeNlQW22K0pRvfhnC0yzE0M6roOC4A';
  const EXPIRED_LICENSE = 'SF-test.example.com-20201231-MEYCIQCIDcA-LOWSM9PT67A0Gt8WI44ME0FbpM0XXspCgoMe5QIhANtBIAE3Mk1Bp6sRFvKh2AeAYSuiKwDchK8tA6nbhIyE';

  // Invalid: tampered / fabricated signatures
  const INVALID_LICENSE = 'SF-test.example.com-UNLIMITED-INVALID_SIGNATURE_HERE';
  const MALFORMED_LICENSE = 'not-a-valid-license';

  describe('parseLicense', () => {
    it('should parse valid unlimited license', () => {
      const result = parseLicense(VALID_LICENSE_UNLIMITED);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe('SF');
      expect(result?.domain).toBe('test.example.com');
      expect(result?.expiry).toBe('UNLIMITED');
      expect(result?.signature).toBeTruthy();
    });

    it('should parse valid dated license', () => {
      const result = parseLicense(VALID_LICENSE_DATED);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe('SF');
      expect(result?.domain).toBe('test.example.com');
      expect(result?.expiry).toBe('20301231');
    });

    it('should return null for malformed license', () => {
      const result = parseLicense(MALFORMED_LICENSE);
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = parseLicense('');
      expect(result).toBeNull();
    });
  });

  describe('verifyLicenseSignature', () => {
    it('should verify valid unlimited license signature', () => {
      const isValid = verifyLicenseSignature(VALID_LICENSE_UNLIMITED);
      expect(isValid).toBe(true);
    });

    it('should verify valid dated license signature', () => {
      const isValid = verifyLicenseSignature(VALID_LICENSE_DATED);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const isValid = verifyLicenseSignature(INVALID_LICENSE);
      expect(isValid).toBe(false);
    });

    it('should reject malformed license', () => {
      const isValid = verifyLicenseSignature(MALFORMED_LICENSE);
      expect(isValid).toBe(false);
    });

    it('should reject tampered domain', () => {
      // Take valid license and change domain
      const tampered = VALID_LICENSE_UNLIMITED.replace('test.example.com', 'hacker.com');
      const isValid = verifyLicenseSignature(tampered);
      expect(isValid).toBe(false);
    });

    it('should reject tampered expiry', () => {
      // Take valid dated license and change expiry
      const tampered = VALID_LICENSE_DATED.replace('20301231', '20991231');
      const isValid = verifyLicenseSignature(tampered);
      expect(isValid).toBe(false);
    });

    it('should reject a completely fabricated base64 signature', () => {
      // Random base64 that is NOT a valid ECDSA signature for this data
      const fabricated = 'SF-test.example.com-UNLIMITED-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      expect(verifyLicenseSignature(fabricated)).toBe(false);
    });

    it('should reject a truncated signature', () => {
      // Take only the first half of the valid signature
      const parts = VALID_LICENSE_UNLIMITED.split('-');
      const sig = parts.slice(3).join('-');
      const truncated = `SF-test.example.com-UNLIMITED-${sig.substring(0, sig.length / 2)}`;
      expect(verifyLicenseSignature(truncated)).toBe(false);
    });

    it('should reject signature from a different domain applied to another', () => {
      // Use the signature from VALID_LICENSE_UNLIMITED but pair it with a different domain
      const parts = VALID_LICENSE_UNLIMITED.split('-');
      const sig = parts.slice(3).join('-');
      const swapped = `SF-evil.example.com-UNLIMITED-${sig}`;
      expect(verifyLicenseSignature(swapped)).toBe(false);
    });

    it('should reject empty signature part', () => {
      expect(verifyLicenseSignature('SF-test.example.com-UNLIMITED-')).toBe(false);
    });

    it('should reject license with valid format but garbage binary signature', () => {
      // Valid base64url encoding but meaningless bytes
      const garbage = 'SF-test.example.com-UNLIMITED-dGhpcyBpcyBub3QgYSByZWFsIHNpZ25hdHVyZQ';
      expect(verifyLicenseSignature(garbage)).toBe(false);
    });
  });

  describe('parseExpiryDate', () => {
    it('should return null for UNLIMITED', () => {
      const result = parseExpiryDate('UNLIMITED');
      expect(result).toBeNull();
    });

    it('should parse valid date', () => {
      const result = parseExpiryDate('20301231');
      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(2030);
      expect(result?.getMonth()).toBe(11); // December (0-indexed)
      expect(result?.getDate()).toBe(31);
    });

    it('should return null for invalid format', () => {
      expect(parseExpiryDate('2030-12-31')).toBeNull();
      expect(parseExpiryDate('invalid')).toBeNull();
      expect(parseExpiryDate('123')).toBeNull();
    });
  });

  describe('isLicenseExpired', () => {
    it('should return false for UNLIMITED', () => {
      expect(isLicenseExpired('UNLIMITED')).toBe(false);
    });

    it('should return false for future date', () => {
      expect(isLicenseExpired('20991231')).toBe(false);
    });

    it('should return true for past date', () => {
      expect(isLicenseExpired('20201231')).toBe(true);
    });
  });

  describe('doesDomainMatch', () => {
    it('should match exact domain', () => {
      expect(doesDomainMatch('example.com', 'example.com')).toBe(true);
    });

    it('should match with different case', () => {
      expect(doesDomainMatch('Example.COM', 'example.com')).toBe(true);
    });

    it('should match removing www prefix', () => {
      expect(doesDomainMatch('www.example.com', 'example.com')).toBe(true);
      expect(doesDomainMatch('example.com', 'www.example.com')).toBe(true);
    });

    it('should match wildcard to subdomain', () => {
      expect(doesDomainMatch('*.example.com', 'app.example.com')).toBe(true);
      expect(doesDomainMatch('*.example.com', 'www.example.com')).toBe(true);
    });

    it('should match wildcard to base domain', () => {
      expect(doesDomainMatch('*.example.com', 'example.com')).toBe(true);
    });

    it('should not match different domains', () => {
      expect(doesDomainMatch('example.com', 'other.com')).toBe(false);
    });

    it('should not match subdomain to base domain license', () => {
      expect(doesDomainMatch('example.com', 'app.example.com')).toBe(false);
    });

    it('should match seller slug exactly', () => {
      expect(doesDomainMatch('kowalski-digital', 'kowalski-digital')).toBe(true);
    });

    it('should not match different seller slugs', () => {
      expect(doesDomainMatch('kowalski-digital', 'creative-studio')).toBe(false);
    });

    it('should not match slug to domain with same name', () => {
      // slug "kowalski-digital" does not match domain "kowalski-digital.com"
      expect(doesDomainMatch('kowalski-digital', 'kowalski-digital.com')).toBe(false);
    });
  });

  describe('extractDomainFromUrl', () => {
    it('should extract domain from full URL', () => {
      expect(extractDomainFromUrl('https://example.com/path')).toBe('example.com');
      expect(extractDomainFromUrl('https://app.example.com:3000/path?query=1')).toBe('app.example.com');
    });

    it('should return plain domain as-is', () => {
      expect(extractDomainFromUrl('example.com')).toBe('example.com');
    });

    it('should return null for invalid URL', () => {
      expect(extractDomainFromUrl('not a url at all!')).toBeNull();
    });
  });

  describe('getLicenseInfo', () => {
    it('should return valid info for valid unlimited license', () => {
      const info = getLicenseInfo(VALID_LICENSE_UNLIMITED);
      expect(info.valid).toBe(true);
      expect(info.domain).toBe('test.example.com');
      expect(info.expiry).toBe('UNLIMITED');
      expect(info.expiryDate).toBeNull();
      expect(info.isExpired).toBe(false);
      expect(info.error).toBeUndefined();
    });

    it('should return valid info for valid dated license', () => {
      const info = getLicenseInfo(VALID_LICENSE_DATED);
      expect(info.valid).toBe(true);
      expect(info.domain).toBe('test.example.com');
      expect(info.expiry).toBe('20301231');
      expect(info.expiryDate).toBeInstanceOf(Date);
      expect(info.isExpired).toBe(false);
    });

    it('should return invalid for malformed license', () => {
      const info = getLicenseInfo(MALFORMED_LICENSE);
      expect(info.valid).toBe(false);
      expect(info.error).toBe('Invalid license format');
    });

    it('should return invalid for bad signature', () => {
      const info = getLicenseInfo(INVALID_LICENSE);
      expect(info.valid).toBe(false);
      expect(info.error).toBe('Invalid license signature');
    });

    it('should return expired for expired license with valid signature', () => {
      const info = getLicenseInfo(EXPIRED_LICENSE);
      // Signature is valid but date is in the past
      expect(info.isExpired).toBe(true);
      expect(info.valid).toBe(false);
      expect(info.error).toBe('License has expired');
    });
  });

  describe('validateLicense (full validation)', () => {
    it('should validate valid license without domain check', () => {
      const result = validateLicense(VALID_LICENSE_UNLIMITED);
      expect(result.valid).toBe(true);
      expect(result.domainMatch).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate valid license with matching domain', () => {
      const result = validateLicense(VALID_LICENSE_UNLIMITED, 'test.example.com');
      expect(result.valid).toBe(true);
      expect(result.domainMatch).toBe(true);
    });

    it('should reject valid license with non-matching domain', () => {
      const result = validateLicense(VALID_LICENSE_UNLIMITED, 'other-domain.com');
      expect(result.valid).toBe(false);
      expect(result.domainMatch).toBe(false);
      expect(result.error).toContain('not "other-domain.com"');
    });

    it('should reject invalid signature', () => {
      const result = validateLicense(INVALID_LICENSE, 'test.example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid license signature');
    });

    it('should reject empty license', () => {
      const result = validateLicense('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('No license key provided');
    });

    it('should reject expired license even with matching domain', () => {
      const result = validateLicense(EXPIRED_LICENSE, 'test.example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('License has expired');
    });
  });

  describe('isValidLicenseFormat', () => {
    it('should accept valid format', () => {
      expect(isValidLicenseFormat('SF-example.com-UNLIMITED-abc123')).toBe(true);
      expect(isValidLicenseFormat('SF-example.com-20301231-abc123_XYZ')).toBe(true);
      expect(isValidLicenseFormat('SF-*.example.com-UNLIMITED-sig')).toBe(true);
    });

    it('should reject invalid format', () => {
      expect(isValidLicenseFormat('invalid')).toBe(false);
      expect(isValidLicenseFormat('SF-domain')).toBe(false);
      expect(isValidLicenseFormat('XX-domain-UNLIMITED-sig')).toBe(false);
    });
  });
});
