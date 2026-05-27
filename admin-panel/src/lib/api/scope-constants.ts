/**
 * API scope constants and pure helpers.
 *
 * This module is client-safe — it has no Node-only imports (e.g. crypto)
 * and may be imported from React Client Components. The runtime/crypto
 * pieces live in `./api-keys` and re-export from here.
 *
 * @see ./api-keys.ts
 */

// Concrete scopes persisted on api_keys rows. Wildcard is resolved at
// create-time, not at request-time — existing keys keep their snapshot.
// Changing this list requires a paired migration for the api_keys.scopes
// DEFAULT (parity enforced by tests/unit/lib/api/scope-constants.test.ts).
export const API_SCOPES = {
  PRODUCTS_READ: 'products:read',
  PRODUCTS_WRITE: 'products:write',

  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',

  COUPONS_READ: 'coupons:read',
  COUPONS_WRITE: 'coupons:write',

  ANALYTICS_READ: 'analytics:read',

  PAYMENTS_READ: 'payments:read',
  PAYMENTS_WRITE: 'payments:write',
  PAYMENTS_REFUND: 'payments:refund',

  WEBHOOKS_READ: 'webhooks:read',
  WEBHOOKS_WRITE: 'webhooks:write',

  INTEGRATIONS_WRITE: 'integrations:write',

  REFUND_REQUESTS_READ: 'refund-requests:read',
  REFUND_REQUESTS_WRITE: 'refund-requests:write',

  SYSTEM_READ: 'system:read',
  SYSTEM_WRITE: 'system:write',
} as const;

export type ApiScope = typeof API_SCOPES[keyof typeof API_SCOPES];

// Input-only marker meaning "expand to every scope known at create-time".
// Never persisted; `expandScopes` resolves it before storage.
export const WILDCARD_SCOPE = '*' as const;
export type WildcardScope = typeof WILDCARD_SCOPE;

// Frozen snapshot of every concrete scope at this version. Used by
// `expandScopes`, by preset definitions, and by UI to render checkboxes.
export const ALL_SCOPES: readonly ApiScope[] = Object.freeze(Object.values(API_SCOPES));

/**
 * Convert a scope value to a camelCase i18n key. Used by UI to look up
 * label/description messages from a single source of truth (this scope
 * list) without maintaining a parallel hand-rolled mapping.
 *
 * Examples:
 *   "products:read"        -> "productsRead"
 *   "refund-requests:read" -> "refundRequestsRead"
 *   "payments:refund"      -> "paymentsRefund"
 */
export function scopeToI18nKey(scope: string): string {
  return scope
    .split(/[:-]/)
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}
