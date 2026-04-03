/**
 * API Key Utilities
 *
 * Generates, hashes, and verifies API keys for external authentication.
 * Keys are never stored in plaintext - only the hash is stored in the database.
 */

import { createHash, randomBytes, timingSafeEqual as cryptoTimingSafeEqual } from 'crypto';

// Key format: sf_{env}_{random}
// Example: sf_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
const KEY_PREFIX_LIVE = 'sf_live_';
const KEY_PREFIX_TEST = 'sf_test_';
const KEY_RANDOM_LENGTH = 32; // 32 bytes = 64 hex characters

// Scopes for API key permissions
export const API_SCOPES = {
  // Products
  PRODUCTS_READ: 'products:read',
  PRODUCTS_WRITE: 'products:write',

  // Users
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',

  // Coupons
  COUPONS_READ: 'coupons:read',
  COUPONS_WRITE: 'coupons:write',

  // Analytics (includes payment read for backward compat)
  ANALYTICS_READ: 'analytics:read',

  // Payments
  PAYMENTS_READ: 'payments:read',
  PAYMENTS_WRITE: 'payments:write',

  // Webhooks
  WEBHOOKS_READ: 'webhooks:read',
  WEBHOOKS_WRITE: 'webhooks:write',

  // Refund Requests
  REFUND_REQUESTS_READ: 'refund-requests:read',
  REFUND_REQUESTS_WRITE: 'refund-requests:write',

  // System
  SYSTEM_READ: 'system:read',
  SYSTEM_WRITE: 'system:write',

  // Full access
  FULL_ACCESS: '*',
} as const;

export type ApiScope = typeof API_SCOPES[keyof typeof API_SCOPES];

// Scope groups for common use cases
export const SCOPE_PRESETS = {
  // Full access to everything
  full: [API_SCOPES.FULL_ACCESS],

  // Read-only access (for dashboards, reporting)
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

  // Analytics only (for BI tools)
  analyticsOnly: [API_SCOPES.ANALYTICS_READ],

  // Support (read users, read products, no write)
  support: [
    API_SCOPES.PRODUCTS_READ,
    API_SCOPES.USERS_READ,
    API_SCOPES.COUPONS_READ,
  ],

  // MCP Server (typically needs full access)
  mcp: [API_SCOPES.FULL_ACCESS],
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
  // Full access grants everything
  if (keyScopes.includes(API_SCOPES.FULL_ACCESS)) {
    return true;
  }

  // Check for exact match
  if (keyScopes.includes(requiredScope)) {
    return true;
  }

  // Check if write permission implies read permission
  // e.g., products:write includes products:read
  if (requiredScope.endsWith(':read')) {
    const writeScope = requiredScope.replace(':read', ':write');
    if (keyScopes.includes(writeScope)) {
      return true;
    }
  }

  return false;
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
    [API_SCOPES.WEBHOOKS_READ]: 'View webhook configurations',
    [API_SCOPES.WEBHOOKS_WRITE]: 'Manage webhooks',
    [API_SCOPES.REFUND_REQUESTS_READ]: 'View refund requests',
    [API_SCOPES.REFUND_REQUESTS_WRITE]: 'Process refund requests',
    [API_SCOPES.SYSTEM_READ]: 'View system configuration',
    [API_SCOPES.SYSTEM_WRITE]: 'Trigger system operations (upgrade)',
    [API_SCOPES.FULL_ACCESS]: 'Full access to all resources',
  };

  return descriptions[scope] || scope;
}

// ===== LICENSE-GATED SCOPE CUSTOMIZATION =====

import type { LicenseTier } from '@/lib/license/verify';
import { hasFeature } from '@/lib/license/features';

interface ScopeGateResult {
  /** Final scopes to use (may be overridden to ['*'] for free tier) */
  scopes: string[];
  /** True if scopes were forced due to license restriction */
  gated: boolean;
}

/**
 * Enforce license-based scope gating on API key creation.
 * Free tier: scopes locked to ['*'] (full access, no granular control).
 * Pro+: full scope customization.
 */
export function enforceApiKeyScopeGate(
  tier: LicenseTier,
  requestedScopes: string[] | undefined,
): ScopeGateResult {
  const canCustomize = hasFeature(tier, 'api-key-scopes');

  if (!canCustomize) {
    return { scopes: [API_SCOPES.FULL_ACCESS], gated: true };
  }

  const scopes = requestedScopes && requestedScopes.length > 0
    ? requestedScopes
    : [API_SCOPES.FULL_ACCESS];

  return { scopes, gated: false };
}
