/**
 * API Keys Unit Tests
 *
 * Tests for API key generation, hashing, verification, and scope management.
 */

import { describe, it, expect } from 'vitest';
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  isValidScope,
  hasScope,
  hasAllScopes,
  hasAnyScope,
  parseApiKeyFromHeader,
  maskApiKey,
  validateScopes,
  getScopeDescription,
  enforceApiKeyScopeGate,
  API_SCOPES,
  SCOPE_PRESETS,
} from '@/lib/api/api-keys';

describe('API Keys', () => {
  describe('generateApiKey', () => {
    it('should generate live key with correct prefix', () => {
      const key = generateApiKey(false);
      expect(key.plaintext).toMatch(/^sf_live_[a-f0-9]{64}$/);
      expect(key.prefix).toBe(key.plaintext.substring(0, 12));
    });

    it('should generate test key with correct prefix', () => {
      const key = generateApiKey(true);
      expect(key.plaintext).toMatch(/^sf_test_[a-f0-9]{64}$/);
      expect(key.prefix).toBe(key.plaintext.substring(0, 12));
    });

    it('should generate unique keys each time', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();
      expect(key1.plaintext).not.toBe(key2.plaintext);
      expect(key1.hash).not.toBe(key2.hash);
    });

    it('should have correct key length (prefix 8 + random 64)', () => {
      const key = generateApiKey();
      expect(key.plaintext.length).toBe(8 + 64);
    });

    it('should return hash that matches plaintext', () => {
      const key = generateApiKey();
      expect(verifyApiKey(key.plaintext, key.hash)).toBe(true);
    });

    it('should generate prefix of exactly 12 characters', () => {
      const key = generateApiKey();
      expect(key.prefix.length).toBe(12);
    });
  });

  describe('hashApiKey', () => {
    it('should return SHA-256 hash (64 hex chars)', () => {
      const hash = hashApiKey('test-key');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should return consistent hash for same input', () => {
      const hash1 = hashApiKey('my-secret-key');
      const hash2 = hashApiKey('my-secret-key');
      expect(hash1).toBe(hash2);
    });

    it('should return different hash for different input', () => {
      const hash1 = hashApiKey('key1');
      const hash2 = hashApiKey('key2');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = hashApiKey('');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle unicode characters', () => {
      const hash = hashApiKey('кириллица-키-日本語');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('verifyApiKey', () => {
    it('should return true for matching key and hash', () => {
      const key = generateApiKey();
      expect(verifyApiKey(key.plaintext, key.hash)).toBe(true);
    });

    it('should return false for non-matching key', () => {
      const key = generateApiKey();
      const wrongKey = 'sf_live_' + 'a'.repeat(64);
      expect(verifyApiKey(wrongKey, key.hash)).toBe(false);
    });

    it('should return false for invalid hash format', () => {
      const key = generateApiKey();
      expect(verifyApiKey(key.plaintext, 'invalid-hash')).toBe(false);
    });

    it('should return false for empty hash', () => {
      const key = generateApiKey();
      expect(verifyApiKey(key.plaintext, '')).toBe(false);
    });

    it('should be timing-safe (return false for slightly different hash)', () => {
      const key = generateApiKey();
      const wrongHash = key.hash.replace(/[0-9]/, 'a');
      expect(verifyApiKey(key.plaintext, wrongHash)).toBe(false);
    });
  });

  describe('isValidScope', () => {
    it('should return true for valid scopes', () => {
      expect(isValidScope('products:read')).toBe(true);
      expect(isValidScope('products:write')).toBe(true);
      expect(isValidScope('users:read')).toBe(true);
      expect(isValidScope('*')).toBe(true);
    });

    it('should return false for invalid scopes', () => {
      expect(isValidScope('invalid:scope')).toBe(false);
      expect(isValidScope('products')).toBe(false);
      expect(isValidScope('')).toBe(false);
      expect(isValidScope('PRODUCTS:READ')).toBe(false);
    });

    it('should validate all defined API_SCOPES', () => {
      for (const scope of Object.values(API_SCOPES)) {
        expect(isValidScope(scope)).toBe(true);
      }
    });
  });

  describe('hasScope', () => {
    it('should return true for full access scope', () => {
      expect(hasScope(['*'], API_SCOPES.PRODUCTS_READ)).toBe(true);
      expect(hasScope(['*'], API_SCOPES.USERS_WRITE)).toBe(true);
    });

    it('should return true for exact scope match', () => {
      expect(hasScope(['products:read'], API_SCOPES.PRODUCTS_READ)).toBe(true);
    });

    it('should return false for missing scope', () => {
      expect(hasScope(['products:read'], API_SCOPES.USERS_READ)).toBe(false);
    });

    it('should allow write scope to grant read access', () => {
      expect(hasScope(['products:write'], API_SCOPES.PRODUCTS_READ)).toBe(true);
      expect(hasScope(['users:write'], API_SCOPES.USERS_READ)).toBe(true);
    });

    it('should not allow read scope to grant write access', () => {
      expect(hasScope(['products:read'], API_SCOPES.PRODUCTS_WRITE)).toBe(false);
    });

    it('should handle empty scopes array', () => {
      expect(hasScope([], API_SCOPES.PRODUCTS_READ)).toBe(false);
    });

    it('should work with multiple scopes', () => {
      const scopes = ['products:read', 'users:write'];
      expect(hasScope(scopes, API_SCOPES.PRODUCTS_READ)).toBe(true);
      expect(hasScope(scopes, API_SCOPES.USERS_READ)).toBe(true);
      expect(hasScope(scopes, API_SCOPES.USERS_WRITE)).toBe(true);
      expect(hasScope(scopes, API_SCOPES.COUPONS_READ)).toBe(false);
    });
  });

  describe('hasAllScopes', () => {
    it('should return true when all scopes are present', () => {
      const keyScopes = ['products:read', 'users:read'];
      expect(hasAllScopes(keyScopes, [API_SCOPES.PRODUCTS_READ, API_SCOPES.USERS_READ])).toBe(true);
    });

    it('should return false when some scopes are missing', () => {
      const keyScopes = ['products:read'];
      expect(hasAllScopes(keyScopes, [API_SCOPES.PRODUCTS_READ, API_SCOPES.USERS_READ])).toBe(false);
    });

    it('should return true for empty required scopes', () => {
      expect(hasAllScopes(['products:read'], [])).toBe(true);
    });

    it('should work with full access', () => {
      expect(hasAllScopes(['*'], [API_SCOPES.PRODUCTS_READ, API_SCOPES.USERS_WRITE])).toBe(true);
    });
  });

  describe('hasAnyScope', () => {
    it('should return true when at least one scope matches', () => {
      const keyScopes = ['products:read'];
      expect(hasAnyScope(keyScopes, [API_SCOPES.PRODUCTS_READ, API_SCOPES.USERS_READ])).toBe(true);
    });

    it('should return false when no scopes match', () => {
      const keyScopes = ['coupons:read'];
      expect(hasAnyScope(keyScopes, [API_SCOPES.PRODUCTS_READ, API_SCOPES.USERS_READ])).toBe(false);
    });

    it('should return false for empty required scopes', () => {
      expect(hasAnyScope(['products:read'], [])).toBe(false);
    });
  });

  describe('parseApiKeyFromHeader', () => {
    const validLiveKey = 'sf_live_' + 'a'.repeat(64);
    const validTestKey = 'sf_test_' + 'b'.repeat(64);

    it('should parse Bearer token format', () => {
      expect(parseApiKeyFromHeader(`Bearer ${validLiveKey}`)).toBe(validLiveKey);
    });

    it('should parse raw key format', () => {
      expect(parseApiKeyFromHeader(validLiveKey)).toBe(validLiveKey);
    });

    it('should accept test keys', () => {
      expect(parseApiKeyFromHeader(validTestKey)).toBe(validTestKey);
    });

    it('should return null for invalid prefix', () => {
      expect(parseApiKeyFromHeader('sf_invalid_' + 'a'.repeat(64))).toBe(null);
      expect(parseApiKeyFromHeader('invalid_key')).toBe(null);
    });

    it('should return null for wrong length', () => {
      expect(parseApiKeyFromHeader('sf_live_short')).toBe(null);
      expect(parseApiKeyFromHeader('sf_live_' + 'a'.repeat(100))).toBe(null);
    });

    it('should return null for null/empty input', () => {
      expect(parseApiKeyFromHeader(null)).toBe(null);
      expect(parseApiKeyFromHeader('')).toBe(null);
    });
  });

  describe('maskApiKey', () => {
    it('should mask long keys correctly', () => {
      const key = 'sf_live_' + 'a'.repeat(64);
      const masked = maskApiKey(key);
      expect(masked).toBe('sf_live_aaaa...aaaa');
    });

    it('should handle short keys', () => {
      const masked = maskApiKey('short');
      expect(masked).toBe('shor...');
    });

    it('should show first 12 and last 4 characters', () => {
      const key = 'sf_live_1234567890abcdef';
      const masked = maskApiKey(key);
      expect(masked.startsWith('sf_live_1234')).toBe(true);
      expect(masked.endsWith('...cdef')).toBe(true);
    });
  });

  describe('validateScopes', () => {
    it('should validate array of valid scopes', () => {
      const result = validateScopes(['products:read', 'users:write']);
      expect(result.isValid).toBe(true);
      expect(result.invalidScopes).toHaveLength(0);
    });

    it('should detect invalid scopes', () => {
      const result = validateScopes(['products:read', 'invalid:scope']);
      expect(result.isValid).toBe(false);
      expect(result.invalidScopes).toContain('invalid:scope');
    });

    it('should reject non-array input', () => {
      expect(validateScopes('products:read').isValid).toBe(false);
      expect(validateScopes(null).isValid).toBe(false);
      expect(validateScopes(123).isValid).toBe(false);
    });

    it('should validate empty array as valid', () => {
      const result = validateScopes([]);
      expect(result.isValid).toBe(true);
    });

    it('should reject non-string elements', () => {
      const result = validateScopes(['products:read', 123, null]);
      expect(result.isValid).toBe(false);
      expect(result.invalidScopes.length).toBe(2);
    });
  });

  describe('getScopeDescription', () => {
    it('should return description for known scopes', () => {
      expect(getScopeDescription(API_SCOPES.PRODUCTS_READ)).toBe('View products');
      expect(getScopeDescription(API_SCOPES.FULL_ACCESS)).toBe('Full access to all resources');
    });

    it('should return scope itself for unknown scope', () => {
      // @ts-expect-error Testing with invalid scope
      expect(getScopeDescription('unknown:scope')).toBe('unknown:scope');
    });
  });

  describe('SCOPE_PRESETS', () => {
    it('should have full preset with full access', () => {
      expect(SCOPE_PRESETS.full).toContain(API_SCOPES.FULL_ACCESS);
    });

    it('should have readOnly preset without write scopes', () => {
      const readOnly = SCOPE_PRESETS.readOnly;
      expect(readOnly.every(s => s.includes('read'))).toBe(true);
    });

    it('should have mcp preset with full access', () => {
      expect(SCOPE_PRESETS.mcp).toContain(API_SCOPES.FULL_ACCESS);
    });

    it('should have support preset with limited scopes', () => {
      const support = SCOPE_PRESETS.support;
      expect(support).toContain(API_SCOPES.PRODUCTS_READ);
      expect(support).toContain(API_SCOPES.USERS_READ);
      expect(support).not.toContain(API_SCOPES.PRODUCTS_WRITE);
    });

    it('should have readOnly preset with payments:read', () => {
      expect(SCOPE_PRESETS.readOnly).toContain(API_SCOPES.PAYMENTS_READ);
      expect(SCOPE_PRESETS.readOnly).not.toContain(API_SCOPES.PAYMENTS_WRITE);
    });

  });

  // ===== PAYMENTS SCOPES =====

  describe('payments scopes', () => {
    it('should define PAYMENTS_READ and PAYMENTS_WRITE', () => {
      expect(API_SCOPES.PAYMENTS_READ).toBe('payments:read');
      expect(API_SCOPES.PAYMENTS_WRITE).toBe('payments:write');
    });

    it('hasScope should grant payments:write with full access', () => {
      expect(hasScope(['*'], API_SCOPES.PAYMENTS_WRITE)).toBe(true);
    });

    it('hasScope should grant payments:write with explicit scope', () => {
      expect(hasScope(['payments:write'], API_SCOPES.PAYMENTS_WRITE)).toBe(true);
    });

    it('hasScope should NOT grant payments:write with only payments:read', () => {
      expect(hasScope(['payments:read'], API_SCOPES.PAYMENTS_WRITE)).toBe(false);
    });

    it('hasScope should NOT grant payments:write with only analytics:read', () => {
      expect(hasScope(['analytics:read'], API_SCOPES.PAYMENTS_WRITE)).toBe(false);
    });

    it('getScopeDescription should return descriptions for payment scopes', () => {
      expect(getScopeDescription(API_SCOPES.PAYMENTS_READ)).toBe('View payment transactions');
      expect(getScopeDescription(API_SCOPES.PAYMENTS_WRITE)).toBe('Update payment metadata');
    });
  });

  // ===== API KEY SCOPE GATING (LICENSE TIER) =====

  describe('enforceApiKeyScopeGate', () => {
    it('should force full access for free tier regardless of requested scopes', () => {
      const result = enforceApiKeyScopeGate('free', ['products:read', 'users:read']);
      expect(result.scopes).toEqual(['*']);
      expect(result.gated).toBe(true);
    });

    it('should force full access for free tier when no scopes requested', () => {
      const result = enforceApiKeyScopeGate('free', undefined);
      expect(result.scopes).toEqual(['*']);
      expect(result.gated).toBe(true);
    });

    it('should allow custom scopes for pro tier', () => {
      const result = enforceApiKeyScopeGate('pro', ['products:read', 'analytics:read']);
      expect(result.scopes).toEqual(['products:read', 'analytics:read']);
      expect(result.gated).toBe(false);
    });

    it('should allow custom scopes for business tier', () => {
      const result = enforceApiKeyScopeGate('business', ['users:write']);
      expect(result.scopes).toEqual(['users:write']);
      expect(result.gated).toBe(false);
    });

    it('should default to full access for pro tier when no scopes provided', () => {
      const result = enforceApiKeyScopeGate('pro', undefined);
      expect(result.scopes).toEqual(['*']);
      expect(result.gated).toBe(false);
    });

    it('should default to full access for pro tier with empty array', () => {
      const result = enforceApiKeyScopeGate('pro', []);
      expect(result.scopes).toEqual(['*']);
      expect(result.gated).toBe(false);
    });

    it('should force full access for free tier even when full access explicitly requested', () => {
      const result = enforceApiKeyScopeGate('free', ['*']);
      expect(result.scopes).toEqual(['*']);
      expect(result.gated).toBe(true);
    });
  });
});
