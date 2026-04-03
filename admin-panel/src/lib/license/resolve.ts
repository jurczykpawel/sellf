/**
 * Unified License Resolution
 *
 * Single source of truth for license tier resolution.
 * DB-first with env fallback.
 *
 * Usage:
 *   const tier = await resolveCurrentTier();
 *   const valid = await checkFeature('watermark-removal');
 *
 * @see verify.ts for cryptographic signature verification
 * @see features.ts for feature registry and tier ordering
 */

import { validateLicense, extractDomainFromUrl, doesDomainMatch } from './verify';
import { hasFeature } from './features';
import { createAdminClient } from '@/lib/supabase/admin';
import type { LicenseTier } from './verify';
import type { Feature } from './features';

// ===== OPTIONS =====

export interface LicenseResolveOptions {
  /** Supabase client override. Defaults to createAdminClient(). */
  dataClient?: { from: (table: string) => any };
}

// ===== RESOLVE =====

/**
 * Resolve license tier for the current context.
 *
 * Priority:
 *   1. Demo mode → 'business'
 *   2. DB (integrations_config.sellf_license)
 *   3. ENV (SELLF_LICENSE_KEY)
 */
export async function resolveCurrentTier(options?: LicenseResolveOptions): Promise<LicenseTier> {
  if (process.env.DEMO_MODE === 'true') return 'business';

  const platformDomain = getPlatformDomain();

  // 1. DB first
  const dbTier = await readTierFromDb(options?.dataClient, platformDomain);
  if (dbTier !== 'free') return dbTier;

  // 2. ENV fallback
  const envTier = readTierFromEnv(platformDomain);
  if (envTier !== 'free') return envTier;

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
 */
async function readTierFromDb(
  client: { from: (table: string) => any } | undefined,
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

    const result = validateLicense(licenseKey);
    if (!result.valid || !result.info.domain) return 'free';

    // License domain must match platform domain
    if (platformDomain && doesDomainMatch(result.info.domain, platformDomain)) {
      return result.info.tier;
    }

    // No domain to check against - reject
    return 'free';
  } catch {
    return 'free';
  }
}

/**
 * Read license tier from ENV var (sync).
 */
function readTierFromEnv(platformDomain: string | null): LicenseTier {
  const licenseKey = process.env.SELLF_LICENSE_KEY;
  if (!licenseKey) return 'free';

  const result = validateLicense(licenseKey, platformDomain || undefined);
  return result.valid ? result.info.tier : 'free';
}
