/**
 * License Feature Gating
 *
 * Central registry of features and their required license tiers.
 * All feature checks go through hasFeature() to keep gating logic in one place.
 *
 * @see verify.ts for license parsing and cryptographic verification
 */

import { validateLicense, extractDomainFromUrl } from './verify';
import type { LicenseTier } from './verify';

// ===== FEATURE REGISTRY =====

// Features with active enforcement in the codebase.
// Only add here when the gate is actually wired up (route, UI, or middleware).
const FEATURE_TIERS = {
  // Registered Free (free key from sellf.app registration)
  'csv-export': 'registered',          // POST /api/v1/payments/export, POST /api/admin/payments/export

  // Pro
  'watermark-removal': 'pro',          // /api/sellf route → LICENSE_VALID in sellf.js
  'theme-customization': 'pro',        // theme.ts actions, theme-loader.ts
  // Marketplace (separate product, highest tier)
  'marketplace': 'marketplace',        // marketplace/feature-flag.ts
  'api-key-scopes': 'pro',             // POST /api/v1/api-keys → enforceApiKeyScopeGate
} as const satisfies Record<string, LicenseTier>;

// Planned features — NOT yet enforced. Add to FEATURE_TIERS when implemented.
// registered: audit-log-ui
// pro:        webhook-retry, api-rate-boost, custom-email-domain
// business:   rbac, sso, unlimited-api-keys, advanced-analytics, backup-restore, multi-currency-reports

export type Feature = keyof typeof FEATURE_TIERS;

// ===== TIER ORDERING =====

const TIER_RANK: Record<LicenseTier, number> = {
  free: 0,
  registered: 1,
  pro: 2,
  business: 3,
  marketplace: 4,
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

/**
 * @deprecated Use resolveCurrentTier() from '@/lib/license/resolve' instead.
 * This sync version reads ONLY from env var — misses DB-stored licenses.
 * Kept for edge cases where async is impossible.
 */
export function getCurrentTier(): LicenseTier {
  if (process.env.DEMO_MODE === 'true') return 'marketplace';

  const licenseKey = process.env.SELLF_LICENSE_KEY;
  if (!licenseKey) return 'free';

  const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  const currentDomain = siteUrl ? extractDomainFromUrl(siteUrl) : null;
  const result = validateLicense(licenseKey, currentDomain || undefined);

  return result.valid ? result.info.tier : 'free';
}

// Re-export from resolve.ts for convenience
export { resolveCurrentTier, checkFeature } from './resolve';
export type { LicenseResolveOptions } from './resolve';

