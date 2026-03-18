/**
 * Unified License Resolution
 *
 * Single source of truth for license tier resolution.
 * DB-first with env fallback (platform only, NEVER for sellers).
 *
 * Usage:
 *   // Platform context (default):
 *   const tier = await resolveCurrentTier();
 *
 *   // Seller context (marketplace):
 *   const tier = await resolveCurrentTier({
 *     dataClient: sellerClient,
 *     sellerSlug: 'kowalski_digital',
 *   });
 *
 *   // Feature check shortcut:
 *   const valid = await checkFeature('watermark-removal', { dataClient, sellerSlug });
 *
 * @see verify.ts for cryptographic signature verification
 * @see features.ts for feature registry and tier ordering
 */

import { validateLicense, extractDomainFromUrl, doesDomainMatch } from './verify';
import { hasFeature } from './features';
import { createAdminClient } from '@/lib/supabase/admin';
import type { LicenseTier } from './verify';
import type { Feature } from './features';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = { from: (table: string) => any };

// ===== OPTIONS =====

export interface LicenseResolveOptions {
  /** Schema-scoped Supabase client. No client = createAdminClient() (seller_main). */
  dataClient?: SupabaseClientLike;
  /** Seller slug for marketplace seller context. When set, env fallback is disabled. */
  sellerSlug?: string;
}

// ===== RESOLVE =====

/**
 * Resolve license tier for the current context.
 *
 * Priority:
 *   1. Demo mode → 'business'
 *   2. DB (integrations_config.sellf_license) — per-schema
 *   3. ENV (SELLF_LICENSE_KEY) — ONLY for platform, NEVER for sellers
 */
export async function resolveCurrentTier(options?: LicenseResolveOptions): Promise<LicenseTier> {
  // Demo mode: highest tier (marketplace) — unlocks all features for demonstration
  if (process.env.DEMO_MODE === 'true') return 'marketplace';

  const { dataClient, sellerSlug } = options ?? {};
  const isSellerContext = !!sellerSlug;
  const platformDomain = getPlatformDomain();

  // 1. DB first (per-schema license)
  const dbTier = await readTierFromDb(dataClient, sellerSlug, platformDomain);
  if (dbTier !== 'free') return dbTier;

  // 2. ENV fallback — platform only (seller must have own license or be free)
  if (!isSellerContext) {
    const envTier = readTierFromEnv(platformDomain);
    if (envTier !== 'free') return envTier;
  }

  return 'free';
}

/**
 * Check if a specific feature is available in the current license context.
 */
export async function checkFeature(
  feature: Feature,
  options?: LicenseResolveOptions
): Promise<boolean> {
  const tier = await resolveCurrentTier(options);
  return hasFeature(tier, feature);
}

// ===== INTERNAL HELPERS =====

function getPlatformDomain(): string | null {
  const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.MAIN_DOMAIN;
  return siteUrl ? extractDomainFromUrl(siteUrl) : null;
}

/**
 * Read license tier from DB (integrations_config.sellf_license).
 * For sellers: validates against {slug}.{platformDomain} format.
 * For platform: validates against platformDomain.
 */
async function readTierFromDb(
  client: SupabaseClientLike | undefined,
  sellerSlug: string | undefined,
  platformDomain: string | null
): Promise<LicenseTier> {
  try {
    const dbClient = client || createAdminClient();

    const { data } = await dbClient
      .from('integrations_config')
      .select('sellf_license')
      .eq('id', 1)
      .single();

    const licenseKey = (data as { sellf_license: string | null } | null)?.sellf_license;
    if (!licenseKey) return 'free';

    // Validate signature + expiry first
    const result = validateLicense(licenseKey);
    if (!result.valid || !result.info.domain) return 'free';

    // Domain matching depends on context
    if (sellerSlug && platformDomain) {
      // Seller context: license domain must be {slug}.{platformDomain}
      if (doesSellerLicenseMatch(result.info.domain, sellerSlug, platformDomain)) {
        return result.info.tier;
      }
      // Backward compat: license domain = slug only (old format)
      if (doesDomainMatch(result.info.domain, sellerSlug)) {
        return result.info.tier;
      }
      return 'free';
    }

    // Platform context: license domain must match platform domain
    if (platformDomain && doesDomainMatch(result.info.domain, platformDomain)) {
      return result.info.tier;
    }

    // No domain to check against — reject (cannot validate domain claim)
    if (!platformDomain) {
      return 'free';
    }

    return 'free';
  } catch {
    return 'free';
  }
}

/**
 * Read license tier from ENV var (sync, platform only).
 */
function readTierFromEnv(platformDomain: string | null): LicenseTier {
  const licenseKey = process.env.SELLF_LICENSE_KEY;
  if (!licenseKey) return 'free';

  const result = validateLicense(licenseKey, platformDomain || undefined);
  return result.valid ? result.info.tier : 'free';
}

/**
 * Check if a license domain matches seller's expected format:
 * {sellerSlug}.{platformDomain}
 *
 * Example: "kowalski_digital.sellf.techskills.academy" matches
 * sellerSlug="kowalski_digital", platformDomain="sellf.techskills.academy"
 */
function doesSellerLicenseMatch(
  licenseDomain: string,
  sellerSlug: string,
  platformDomain: string
): boolean {
  const expected = `${sellerSlug}.${platformDomain}`.toLowerCase();
  return licenseDomain.toLowerCase() === expected;
}
