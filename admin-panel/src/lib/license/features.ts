/**
 * License Feature Gating
 *
 * Central registry of features and their required license tiers.
 * All feature checks go through hasFeature() to keep gating logic in one place.
 *
 * @see ../license-keys/format.ts for token parsing and verification
 */

export type LicenseTier = 'free' | 'registered' | 'pro' | 'business';

// ===== FEATURE REGISTRY =====

// Features with active enforcement in the codebase.
// Only add here when the gate is actually wired up (route, UI, or middleware).
const FEATURE_TIERS = {
  // Registered Free (free key from sellf.app registration)
  'csv-export': 'registered',          // POST /api/v1/payments/export, POST /api/admin/payments/export

  // Pro
  'watermark-removal': 'pro',          // SellfBranding component on checkout + product pages
  'theme-customization': 'pro',        // theme.ts actions, theme-loader.ts
  'api-key-scopes': 'pro',             // POST /api/v1/api-keys → enforceApiKeyScopeGate
  'webhook-product-scoping': 'pro',    // POST/PATCH /api/v1/webhooks → product_filter_mode='selected'
  'webhook-payload-customization': 'pro', // webhook custom headers/fields/selection
  'license-key-issuance': 'pro',          // generate/upload signing keys + issue tokens on purchase
  'license-revoked-webhook': 'pro',       // outbound license.revoked webhook (subscription + dispatch)
} as const satisfies Record<string, LicenseTier>;

// Planned features — NOT yet enforced. Add to FEATURE_TIERS when implemented.
// registered: audit-log-ui
// pro:        webhook-retry, api-rate-boost, custom-email-domain
// business:   rbac, sso, unlimited-api-keys, advanced-analytics, backup-restore, multi-currency-reports

export type Feature = keyof typeof FEATURE_TIERS;

/**
 * Webhook events whose SUBSCRIPTION (and dispatch) requires a paid feature.
 * Defense in depth: the write-path rejects subscribing without the feature and
 * the dispatcher only fires the event when the feature is active. Most events
 * are free; only the ones listed here are gated.
 */
export const EVENT_FEATURE_REQUIREMENTS = {
  'license.revoked': 'license-revoked-webhook',
} as const satisfies Record<string, Feature>;

// ===== TIER ORDERING =====

const TIER_RANK: Record<LicenseTier, number> = {
  free: 0,
  registered: 1,
  pro: 2,
  business: 3,
};

// ===== PUBLIC API =====

/**
 * Check if a license tier has access to a specific feature.
 * Higher tiers include all features from lower tiers.
 */
export function hasFeature(tier: LicenseTier, feature: Feature): boolean {
  const requiredTier = FEATURE_TIERS[feature];
  return TIER_RANK[tier] >= TIER_RANK[requiredTier];
}

/**
 * Get the minimum required tier for a feature.
 */
export function getRequiredTier(feature: Feature): LicenseTier {
  return FEATURE_TIERS[feature];
}

/**
 * Get all features available for a given tier.
 */
export function getFeaturesForTier(tier: LicenseTier): Feature[] {
  return (Object.keys(FEATURE_TIERS) as Feature[]).filter(
    (feature) => TIER_RANK[tier] >= TIER_RANK[FEATURE_TIERS[feature]],
  );
}

/**
 * Get all registered features with their required tiers.
 */
export function getAllFeatures(): Record<Feature, LicenseTier> {
  return { ...FEATURE_TIERS };
}

// Re-export from resolve.ts for convenience
export { resolveCurrentTier, checkFeature } from './resolve';
export type { LicenseResolveOptions } from './resolve';
