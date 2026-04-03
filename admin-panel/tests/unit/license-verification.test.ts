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
import {
  hasFeature,
  getRequiredTier,
  getFeaturesForTier,
} from '../../src/lib/license/features';

describe('License Verification', () => {
  // Legacy fixtures (no tier = PRO): signed with original ECDSA P-256 key from Vaultwarden
  const VALID_LICENSE_UNLIMITED = 'SF-test.example.com-UNLIMITED-MEQCIFOQdQ3HIjNyMpP8fZGEnxSKJkjOl41DE52Ryiti6RpBAiA0jQjtVM7E-oYdrTyvIrmqwXJAafSxhSVsyQsM2U5rsA';
  const VALID_LICENSE_DATED = 'SF-test.example.com-20301231-MEUCIQDagMQjsPrJZtLeSk5QoyVYgVS7n-3sim6GlyrWQmpDfAIgCNRiOyfywAGgnyxDz4r192rcqzd8MlRT1uorliGe9R0';
  const EXPIRED_LICENSE = 'SF-test.example.com-20201231-MEUCIAlitOZwn3Btmyy5cmZ1GIGdT8eDVtxaNFrCrsgbBAhGAiEA-iZqQcEJH46UhxCwmnO_ORCtNVCtk7zYrDiRxouenys';

  // Current format fixtures (with tier) — signed with original key
  const VALID_REG_UNLIMITED = 'SF-test.example.com-REG-UNLIMITED-MEQCIEF8Xs3WSGCUH4O8_tCTwpH6FqR0mPEh2HP0UndqLk1aAiA4Ay5k-3xAKR00bvUug1dUHMmNbllfnihQHOxlZZFhwQ';
  const VALID_PRO_UNLIMITED = 'SF-test.example.com-PRO-UNLIMITED-MEQCIFJvfvcakzjXutavoqSX9d-NnKPfVit5lb2kSezgO0YZAiAyVYnHJOa9A5WSav0YYVB9LWFQJyR_cM2EL9NfJZAq5Q';
  const VALID_BIZ_UNLIMITED = 'SF-test.example.com-BIZ-UNLIMITED-MEYCIQDVctECqyu3T94QuJML7fBTVGRJRR8h7VxibrHeKotiIgIhAKQ8WFOD5cCgc2aBchajxe2qH0YXjSrUzUHP8LufYwM-';
  const VALID_PRO_DATED = 'SF-test.example.com-PRO-20301231-MEYCIQCwx4gdCR3YjgIA0wuIDV2M309UButoWGxQUtP3yFwNdwIhAKiezQ95eTzZhEyxI4u8lftekxQsB_6KZBsPZeJbXQxz';
  const EXPIRED_BIZ = 'SF-test.example.com-BIZ-20201231-MEYCIQCoWI1lxsqiLO0KTQk3pf7MtuRbpYkca4bYxuv_TcRqeQIhALPNuWYfln8hmL88Wlh8GQhU45N735GU5hBMpeyPD0D3';

  // Invalid: tampered / fabricated signatures
  const INVALID_LICENSE = 'SF-test.example.com-UNLIMITED-INVALID_SIGNATURE_HERE';
  const MALFORMED_LICENSE = 'not-a-valid-license';

  describe('parseLicense', () => {
    it('should parse legacy unlimited license as PRO', () => {
      const result = parseLicense(VALID_LICENSE_UNLIMITED);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe('SF');
      expect(result?.domain).toBe('test.example.com');
      expect(result?.tier).toBe('pro');
      expect(result?.expiry).toBe('UNLIMITED');
      expect(result?.signature).toBeTruthy();
    });

    it('should parse legacy dated license as PRO', () => {
      const result = parseLicense(VALID_LICENSE_DATED);
      expect(result).not.toBeNull();
      expect(result?.prefix).toBe('SF');
      expect(result?.domain).toBe('test.example.com');
      expect(result?.tier).toBe('pro');
      expect(result?.expiry).toBe('20301231');
    });

    it('should parse current REG license with tier', () => {
      const result = parseLicense(VALID_REG_UNLIMITED);
      expect(result).not.toBeNull();
      expect(result?.domain).toBe('test.example.com');
      expect(result?.tier).toBe('registered');
      expect(result?.expiry).toBe('UNLIMITED');
    });

    it('should parse current PRO license with tier', () => {
      const result = parseLicense(VALID_PRO_UNLIMITED);
      expect(result).not.toBeNull();
      expect(result?.domain).toBe('test.example.com');
      expect(result?.tier).toBe('pro');
      expect(result?.expiry).toBe('UNLIMITED');
    });

    it('should parse current BIZ license with tier', () => {
      const result = parseLicense(VALID_BIZ_UNLIMITED);
      expect(result).not.toBeNull();
      expect(result?.domain).toBe('test.example.com');
      expect(result?.tier).toBe('business');
      expect(result?.expiry).toBe('UNLIMITED');
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
    it('should verify valid legacy unlimited license signature', () => {
      const isValid = verifyLicenseSignature(VALID_LICENSE_UNLIMITED);
      expect(isValid).toBe(true);
    });

    it('should verify valid legacy dated license signature', () => {
      const isValid = verifyLicenseSignature(VALID_LICENSE_DATED);
      expect(isValid).toBe(true);
    });

    it('should verify valid REG tiered license signature', () => {
      expect(verifyLicenseSignature(VALID_REG_UNLIMITED)).toBe(true);
    });

    it('should verify valid PRO tiered license signature', () => {
      expect(verifyLicenseSignature(VALID_PRO_UNLIMITED)).toBe(true);
      expect(verifyLicenseSignature(VALID_PRO_DATED)).toBe(true);
    });

    it('should verify valid BIZ tiered license signature', () => {
      expect(verifyLicenseSignature(VALID_BIZ_UNLIMITED)).toBe(true);
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

    it('should reject tampered tier (PRO changed to BIZ)', () => {
      const tampered = VALID_PRO_UNLIMITED.replace('-PRO-', '-BIZ-');
      expect(verifyLicenseSignature(tampered)).toBe(false);
    });

    it('should reject tampered tier (BIZ changed to PRO)', () => {
      const tampered = VALID_BIZ_UNLIMITED.replace('-BIZ-', '-PRO-');
      expect(verifyLicenseSignature(tampered)).toBe(false);
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
    it('should return valid info for legacy unlimited license (tier=pro)', () => {
      const info = getLicenseInfo(VALID_LICENSE_UNLIMITED);
      expect(info.valid).toBe(true);
      expect(info.domain).toBe('test.example.com');
      expect(info.tier).toBe('pro');
      expect(info.expiry).toBe('UNLIMITED');
      expect(info.expiryDate).toBeNull();
      expect(info.isExpired).toBe(false);
      expect(info.error).toBeUndefined();
    });

    it('should return valid info for legacy dated license (tier=pro)', () => {
      const info = getLicenseInfo(VALID_LICENSE_DATED);
      expect(info.valid).toBe(true);
      expect(info.domain).toBe('test.example.com');
      expect(info.tier).toBe('pro');
      expect(info.expiry).toBe('20301231');
      expect(info.expiryDate).toBeInstanceOf(Date);
      expect(info.isExpired).toBe(false);
    });

    it('should return valid info for REG tiered license', () => {
      const info = getLicenseInfo(VALID_REG_UNLIMITED);
      expect(info.valid).toBe(true);
      expect(info.tier).toBe('registered');
    });

    it('should return valid info for PRO tiered license', () => {
      const info = getLicenseInfo(VALID_PRO_UNLIMITED);
      expect(info.valid).toBe(true);
      expect(info.tier).toBe('pro');
    });

    it('should return valid info for BIZ tiered license', () => {
      const info = getLicenseInfo(VALID_BIZ_UNLIMITED);
      expect(info.valid).toBe(true);
      expect(info.tier).toBe('business');
    });

    it('should return tier=free for malformed license', () => {
      const info = getLicenseInfo(MALFORMED_LICENSE);
      expect(info.valid).toBe(false);
      expect(info.tier).toBe('free');
      expect(info.error).toBe('Invalid license format');
    });

    it('should return tier=free for bad signature', () => {
      const info = getLicenseInfo(INVALID_LICENSE);
      expect(info.valid).toBe(false);
      expect(info.tier).toBe('free');
      expect(info.error).toBe('Invalid license signature');
    });

    it('should return expired for expired BIZ license with valid signature', () => {
      const info = getLicenseInfo(EXPIRED_BIZ);
      expect(info.isExpired).toBe(true);
      expect(info.valid).toBe(false);
      expect(info.tier).toBe('business');
      expect(info.error).toBe('License has expired');
    });

    it('should return expired for expired legacy license with valid signature', () => {
      const info = getLicenseInfo(EXPIRED_LICENSE);
      expect(info.isExpired).toBe(true);
      expect(info.valid).toBe(false);
      expect(info.tier).toBe('pro');
      expect(info.error).toBe('License has expired');
    });
  });

  describe('validateLicense (full validation)', () => {
    it('should validate legacy license without domain check', () => {
      const result = validateLicense(VALID_LICENSE_UNLIMITED);
      expect(result.valid).toBe(true);
      expect(result.info.tier).toBe('pro');
      expect(result.domainMatch).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate legacy license with matching domain', () => {
      const result = validateLicense(VALID_LICENSE_UNLIMITED, 'test.example.com');
      expect(result.valid).toBe(true);
      expect(result.domainMatch).toBe(true);
    });

    it('should validate PRO tiered license', () => {
      const result = validateLicense(VALID_PRO_UNLIMITED, 'test.example.com');
      expect(result.valid).toBe(true);
      expect(result.info.tier).toBe('pro');
    });

    it('should validate BIZ tiered license', () => {
      const result = validateLicense(VALID_BIZ_UNLIMITED, 'test.example.com');
      expect(result.valid).toBe(true);
      expect(result.info.tier).toBe('business');
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
      expect(result.info.tier).toBe('free');
      expect(result.error).toBe('No license key provided');
    });

    it('should reject expired license even with matching domain', () => {
      const result = validateLicense(EXPIRED_LICENSE, 'test.example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('License has expired');
    });
  });

  describe('isValidLicenseFormat', () => {
    it('should accept legacy format', () => {
      expect(isValidLicenseFormat('SF-example.com-UNLIMITED-abc123')).toBe(true);
      expect(isValidLicenseFormat('SF-example.com-20301231-abc123_XYZ')).toBe(true);
      expect(isValidLicenseFormat('SF-*.example.com-UNLIMITED-sig')).toBe(true);
    });

    it('should accept current format with tier', () => {
      expect(isValidLicenseFormat('SF-example.com-REG-UNLIMITED-abc123')).toBe(true);
      expect(isValidLicenseFormat('SF-example.com-PRO-UNLIMITED-abc123')).toBe(true);
      expect(isValidLicenseFormat('SF-example.com-BIZ-20301231-abc123')).toBe(true);
      expect(isValidLicenseFormat('SF-*.example.com-PRO-UNLIMITED-sig')).toBe(true);
    });

    it('should reject invalid format', () => {
      expect(isValidLicenseFormat('invalid')).toBe(false);
      expect(isValidLicenseFormat('SF-domain')).toBe(false);
      expect(isValidLicenseFormat('XX-domain-UNLIMITED-sig')).toBe(false);
    });
  });
});

// ===== FEATURE GATING =====

describe('License Feature Gating', () => {
  describe('hasFeature', () => {
    it('should grant registered features to registered tier', () => {
      expect(hasFeature('registered', 'csv-export')).toBe(true);
    });

    it('should deny pro features to registered tier', () => {
      expect(hasFeature('registered', 'watermark-removal')).toBe(false);
    });

    it('should grant registered + pro features to pro tier', () => {
      expect(hasFeature('pro', 'csv-export')).toBe(true);
      expect(hasFeature('pro', 'watermark-removal')).toBe(true);
    });

    it('should grant all features to business tier', () => {
      expect(hasFeature('business', 'csv-export')).toBe(true);
      expect(hasFeature('business', 'watermark-removal')).toBe(true);
      expect(hasFeature('business', 'api-key-scopes')).toBe(true);
    });

    it('should deny all paid features to free tier', () => {
      expect(hasFeature('free', 'csv-export')).toBe(false);
      expect(hasFeature('free', 'watermark-removal')).toBe(false);
    });
  });

  describe('getRequiredTier', () => {
    it('should return registered for registered features', () => {
      expect(getRequiredTier('csv-export')).toBe('registered');
    });

    it('should return pro for pro features', () => {
      expect(getRequiredTier('watermark-removal')).toBe('pro');
    });

  });

  describe('getFeaturesForTier', () => {
    it('should return empty for free tier', () => {
      expect(getFeaturesForTier('free')).toHaveLength(0);
    });

    it('should return only registered features for registered tier', () => {
      const features = getFeaturesForTier('registered');
      expect(features).toContain('csv-export');
      expect(features).not.toContain('watermark-removal');
    });

    it('should return registered + pro features for pro tier', () => {
      const features = getFeaturesForTier('pro');
      expect(features).toContain('csv-export');
      expect(features).toContain('watermark-removal');
    });

    it('should return all features for business tier', () => {
      const features = getFeaturesForTier('business');
      expect(features).toContain('csv-export');
      expect(features).toContain('watermark-removal');
      expect(features).toContain('api-key-scopes');
    });

  });
});
