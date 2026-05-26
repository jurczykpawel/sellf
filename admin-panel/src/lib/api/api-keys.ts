/**
 * API Key Utilities
 *
 * Generates, hashes, and verifies API keys for external authentication.
 * Keys are never stored in plaintext - only the hash is stored in the database.
 */

import { createHash, randomBytes, timingSafeEqual as cryptoTimingSafeEqual } from 'crypto';

import {
  API_SCOPES,
  ALL_SCOPES,
  WILDCARD_SCOPE,
  scopeToI18nKey,
  type ApiScope,
  type WildcardScope,
} from './scope-constants';
import { ApiValidationError } from './errors';

// Re-export client-safe scope constants so existing callers can keep
// importing from '@/lib/api/api-keys'. The runtime helpers below depend
// on Node crypto and must not leak into client bundles.
export { API_SCOPES, ALL_SCOPES, WILDCARD_SCOPE, scopeToI18nKey };
export type { ApiScope, WildcardScope };

// Key format: sf_{env}_{random}
// Example: sf_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
const KEY_PREFIX_LIVE = 'sf_live_';
const KEY_PREFIX_TEST = 'sf_test_';
const KEY_RANDOM_LENGTH = 32; // 32 bytes = 64 hex characters

export const SCOPE_PRESETS = {
  full: [...ALL_SCOPES],

  readOnly: [
    API_SCOPES.PRODUCTS_READ,
    API_SCOPES.USERS_READ,
    API_SCOPES.COUPONS_READ,
    API_SCOPES.ANALYTICS_READ,
    API_SCOPES.PAYMENTS_READ,
    API_SCOPES.WEBHOOKS_READ,
    API_SCOPES.REFUND_REQUESTS_READ,
    API_SCOPES.SYSTEM_READ,
  ],

  analyticsOnly: [API_SCOPES.ANALYTICS_READ],

  support: [
    API_SCOPES.PRODUCTS_READ,
    API_SCOPES.USERS_READ,
    API_SCOPES.COUPONS_READ,
  ],

  mcp: [...ALL_SCOPES],
} as const;

export type ScopePreset = keyof typeof SCOPE_PRESETS;

/**
 * Result of generating a new API key
 */
export interface GeneratedApiKey {
  /** The full key - ONLY returned once at creation time */
  plaintext: string;
  /** First 12 characters for display (e.g., "sf_live_a1b2") */
  prefix: string;
  /** SHA-256 hash of the key for storage */
  hash: string;
}

/**
 * Generate a new API key
 *
 * @param isTest - If true, generates a test key (sf_test_), otherwise live (sf_live_)
 * @returns The generated key with plaintext (only returned once), prefix, and hash
 */
export function generateApiKey(isTest: boolean = false): GeneratedApiKey {
  const prefix = isTest ? KEY_PREFIX_TEST : KEY_PREFIX_LIVE;
  const randomPart = randomBytes(KEY_RANDOM_LENGTH).toString('hex');
  const plaintext = `${prefix}${randomPart}`;

  return {
    plaintext,
    prefix: plaintext.substring(0, 12), // "sf_live_a1b2" or "sf_test_a1b2"
    hash: hashApiKey(plaintext),
  };
}

/**
 * Hash an API key using SHA-256
 *
 * @param key - The plaintext API key
 * @returns The SHA-256 hash
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Verify if a plaintext key matches a stored hash
 *
 * @param plaintextKey - The key to verify
 * @param storedHash - The hash from the database
 * @returns True if the key matches
 */
export function verifyApiKey(plaintextKey: string, storedHash: string): boolean {
  const keyHash = hashApiKey(plaintextKey);
  // Use Node.js crypto timing-safe comparison to prevent timing attacks
  // Both hashes are SHA-256 hex strings (always 64 chars), so lengths match
  try {
    return cryptoTimingSafeEqual(Buffer.from(keyHash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    // If conversion fails (e.g., invalid hex), return false
    return false;
  }
}

/**
 * Check if a scope is valid
 */
export function isValidScope(scope: string): scope is ApiScope {
  return Object.values(API_SCOPES).includes(scope as ApiScope);
}

/**
 * Check if a key has permission for a specific scope
 *
 * @param keyScopes - Array of scopes assigned to the key
 * @param requiredScope - The scope required for the operation
 * @returns True if the key has the required permission
 */
export function hasScope(keyScopes: string[], requiredScope: ApiScope): boolean {
  if (keyScopes.includes(requiredScope)) {
    return true;
  }

  // Write permission implies read permission (e.g., products:write ⇒ products:read)
  if (requiredScope.endsWith(':read')) {
    const writeScope = requiredScope.replace(':read', ':write');
    if (keyScopes.includes(writeScope)) {
      return true;
    }
  }

  return false;
}

/**
 * Expand an input scope list, resolving the wildcard marker to the full
 * concrete scope snapshot of THIS version. Returns a new array of valid
 * ApiScope values with duplicates removed.
 *
 * Every non-wildcard entry is validated against `isValidScope` and an
 * `ApiValidationError` is thrown for unknown strings — the function's
 * return type claims a runtime guarantee, so we back it here rather than
 * trusting upstream validation. Persistence layers downstream see only
 * explicit, validated ApiScope values.
 */
export function expandScopes(input: readonly string[]): ApiScope[] {
  const out = new Set<ApiScope>();
  for (const scope of input) {
    if (scope === WILDCARD_SCOPE) {
      for (const known of ALL_SCOPES) {
        out.add(known);
      }
      continue;
    }
    if (!isValidScope(scope)) {
      throw new ApiValidationError(`Invalid scope: ${scope}`);
    }
    out.add(scope);
  }
  return [...out];
}

/**
 * Check if a key has ALL of the required scopes
 */
export function hasAllScopes(keyScopes: string[], requiredScopes: ApiScope[]): boolean {
  return requiredScopes.every(scope => hasScope(keyScopes, scope));
}

/**
 * Check if a key has ANY of the required scopes
 */
export function hasAnyScope(keyScopes: string[], requiredScopes: ApiScope[]): boolean {
  return requiredScopes.some(scope => hasScope(keyScopes, scope));
}

/**
 * Parse API key from Authorization header
 *
 * Supports formats:
 * - "Bearer sf_live_xxx..."
 * - "sf_live_xxx..." (without Bearer prefix)
 *
 * @param authHeader - The Authorization header value
 * @returns The extracted key or null if invalid
 */
export function parseApiKeyFromHeader(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  // Remove "Bearer " prefix if present
  const key = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  // Validate key format
  if (!key.startsWith('sf_live_') && !key.startsWith('sf_test_')) {
    return null;
  }

  // Validate key length (prefix + 64 hex chars)
  if (key.length !== 8 + 64) {
    return null;
  }

  return key;
}

/**
 * Mask an API key for display
 * Shows prefix and last 4 characters
 *
 * @param key - The full API key
 * @returns Masked key like "sf_live_a1b2...p6q7"
 */
export function maskApiKey(key: string): string {
  if (key.length < 16) {
    return key.substring(0, 4) + '...';
  }
  return key.substring(0, 12) + '...' + key.slice(-4);
}

/**
 * Validate scopes array
 *
 * @param scopes - Array of scope strings to validate
 * @returns Object with isValid flag and any invalid scopes
 */
export function validateScopes(scopes: unknown): { isValid: boolean; invalidScopes: string[] } {
  if (!Array.isArray(scopes)) {
    return { isValid: false, invalidScopes: [] };
  }

  const invalidScopes: string[] = [];

  for (const scope of scopes) {
    if (typeof scope !== 'string' || !isValidScope(scope)) {
      invalidScopes.push(String(scope));
    }
  }

  return {
    isValid: invalidScopes.length === 0,
    invalidScopes,
  };
}

/**
 * Get human-readable description for a scope
 */
export function getScopeDescription(scope: ApiScope): string {
  const descriptions: Record<ApiScope, string> = {
    [API_SCOPES.PRODUCTS_READ]: 'View products',
    [API_SCOPES.PRODUCTS_WRITE]: 'Create, update, delete products',
    [API_SCOPES.USERS_READ]: 'View users and access',
    [API_SCOPES.USERS_WRITE]: 'Manage user access',
    [API_SCOPES.COUPONS_READ]: 'View coupons',
    [API_SCOPES.COUPONS_WRITE]: 'Create, update, delete coupons',
    [API_SCOPES.ANALYTICS_READ]: 'View analytics and reports',
    [API_SCOPES.PAYMENTS_READ]: 'View payment transactions',
    [API_SCOPES.PAYMENTS_WRITE]: 'Update payment metadata',
    [API_SCOPES.PAYMENTS_REFUND]: 'Issue refunds on payment transactions',
    [API_SCOPES.WEBHOOKS_READ]: 'View webhook configurations',
    [API_SCOPES.WEBHOOKS_WRITE]: 'Manage webhooks',
    [API_SCOPES.INTEGRATIONS_WRITE]: 'Manage integrations configuration',
    [API_SCOPES.REFUND_REQUESTS_READ]: 'View refund requests',
    [API_SCOPES.REFUND_REQUESTS_WRITE]: 'Process refund requests',
    [API_SCOPES.SYSTEM_READ]: 'View system configuration',
    [API_SCOPES.SYSTEM_WRITE]: 'Trigger system operations (upgrade)',
  };

  return descriptions[scope] || scope;
}

// ===== LICENSE-GATED SCOPE CUSTOMIZATION =====

import type { LicenseTier } from '@/lib/license/verify';

/**
 * Resolve the final, concrete scope list for a new API key.
 *
 * - No request (undefined / empty / wildcard-only): snapshot full access
 *   (`ALL_SCOPES`). This is the default for both UI-driven creation and
 *   integrations that don't know which scopes they need yet.
 * - Explicit narrower request: returned as-is (after wildcard expansion
 *   and validation). This holds for every tier — a free-tier admin who
 *   bypasses the locked UI and asks for `['products:read']` MUST get
 *   exactly that list. Forcing the request wider violates least-privilege
 *   and turns a "read-only" key into a refund/user-mutation key.
 *
 * The `tier` parameter is retained for the signature shape: future gating
 * (e.g., a paid tier required for certain high-risk scopes) plugs in here
 * without changing call-sites. Today, no scope is tier-restricted.
 */
export function enforceApiKeyScopeGate(
  tier: LicenseTier,
  requestedScopes: string[] | undefined,
): ApiScope[] {
  // Intentional pass-through — narrower-than-full requests are always honored
  // regardless of tier (see header doc). Don't "fix" this by enforcing tier.
  void tier;
  if (!requestedScopes || requestedScopes.length === 0) {
    return [...ALL_SCOPES];
  }

  return expandScopes(requestedScopes);
}
