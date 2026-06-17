import { domainMatches, normalizeLicenseDomain } from '@/lib/license-keys/domain';
import { parseLicenseClaims } from '@/lib/license-keys/format';
import { verifySellfLicense, type SellfPublicKey } from '@/lib/license-keys/sdk';
import { createAdminClient } from '@/lib/supabase/admin';

import { hasFeature, type Feature, type LicenseTier } from './features';

const PLATFORM_SELLER_ID = '83789f79-bdd7-4918-af1f-e56325fa5070';
const DEFAULT_PLATFORM_JWKS_URL = `https://sellf.techskills.academy/api/licenses/jwks?seller=${PLATFORM_SELLER_ID}`;
const JWKS_TTL_MS = 5 * 60 * 1000;
const JWKS_FALLBACK_TTL_MS = 60 * 1000;

let cachedKeys: { keys: SellfPublicKey[]; expiresAt: number } | null = null;

export interface LicenseResolveOptions {
  dataClient?: { from: (table: string) => any };
  keys?: SellfPublicKey[];
  now?: Date;
  allowedProducts?: ReadonlySet<string>;
}

export type PlatformLicenseVerification =
  | {
      valid: true;
      tier: Exclude<LicenseTier, 'free'>;
      domain: string;
      expiry: number | null;
    }
  | {
      valid: false;
      reason: 'malformed' | 'signature' | 'expired' | 'domain' | 'product' | 'tier' | 'keys';
      tier: null;
      domain: string | null;
      expiry: number | null;
    };

// Official Sellf tier products. A buyer's self-hosted instance must accept the
// slug carried in their license token's `product` claim; defaulting to all three
// tier slugs makes registered/pro/business licenses validate out of the box
// without each self-hoster having to set SELLF_LICENSE_PRODUCTS.
const DEFAULT_LICENSE_PRODUCTS = 'sellf-registered,sellf-pro,sellf-business';

function allowedProductsFromEnv(): ReadonlySet<string> {
  const configured = process.env.SELLF_LICENSE_PRODUCTS ?? DEFAULT_LICENSE_PRODUCTS;
  return new Set(configured.split(',').map((value) => value.trim()).filter(Boolean));
}

function normalizeTier(value: unknown): Exclude<LicenseTier, 'free'> | null {
  return value === 'registered' || value === 'pro' || value === 'business' ? value : null;
}

function parseFallbackKeys(): SellfPublicKey[] {
  const raw = process.env.SELLF_JWKS_FALLBACK;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { keys?: unknown }).keys)
        ? (parsed as { keys: unknown[] }).keys
        : [];
    return values.filter((value): value is SellfPublicKey => {
      if (!value || typeof value !== 'object') return false;
      const key = value as Record<string, unknown>;
      return typeof key.kid === 'string' && key.alg === 'ES256' && typeof key.pem === 'string';
    });
  } catch {
    return [];
  }
}

async function loadPlatformKeys(): Promise<SellfPublicKey[]> {
  const now = Date.now();
  if (cachedKeys && cachedKeys.expiresAt > now) return cachedKeys.keys;

  const fallback = parseFallbackKeys();
  const cacheFallback = () => {
    cachedKeys = { keys: fallback, expiresAt: now + JWKS_FALLBACK_TTL_MS };
    return fallback;
  };
  try {
    const response = await fetch(process.env.SELLF_PLATFORM_JWKS_URL ?? DEFAULT_PLATFORM_JWKS_URL, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return cacheFallback();
    const body = await response.json() as { keys?: unknown };
    if (!Array.isArray(body.keys)) return cacheFallback();
    const keys = body.keys.filter((value): value is SellfPublicKey => {
      if (!value || typeof value !== 'object') return false;
      const key = value as Record<string, unknown>;
      return typeof key.kid === 'string' && key.alg === 'ES256' && typeof key.pem === 'string';
    });
    if (keys.length === 0) return cacheFallback();
    cachedKeys = { keys, expiresAt: now + JWKS_TTL_MS };
    return keys;
  } catch {
    return cacheFallback();
  }
}

export async function verifyPlatformLicenseToken(
  token: string,
  platformDomain: string,
  options: Pick<LicenseResolveOptions, 'keys' | 'now' | 'allowedProducts'> = {},
): Promise<PlatformLicenseVerification> {
  const parsed = parseLicenseClaims(token);
  if (!parsed) return { valid: false, reason: 'malformed', tier: null, domain: null, expiry: null };

  const domain = normalizeLicenseDomain(parsed.domain) ?? null;
  const expiry = parsed.exp;
  const keys = options.keys ?? await loadPlatformKeys();
  if (keys.length === 0) {
    return { valid: false, reason: 'keys', tier: null, domain: null, expiry: null };
  }

  const verified = verifySellfLicense(token, { keys, now: options.now });
  if (!verified.valid) {
    const claimsAreTrusted = verified.reason === 'expired';
    return {
      valid: false,
      reason: verified.reason,
      tier: null,
      domain: claimsAreTrusted ? domain : null,
      expiry: claimsAreTrusted ? expiry : null,
    };
  }

  const allowedProducts = options.allowedProducts ?? allowedProductsFromEnv();
  if (!allowedProducts.has(verified.claims.product)) {
    return { valid: false, reason: 'product', tier: null, domain, expiry };
  }
  const tier = normalizeTier(verified.claims.tier);
  if (!tier) return { valid: false, reason: 'tier', tier: null, domain, expiry };
  if (!domain || !domainMatches(domain, platformDomain)) {
    return { valid: false, reason: 'domain', tier: null, domain, expiry };
  }
  return { valid: true, tier, domain, expiry };
}

function getPlatformDomain(): string | null {
  const configured = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.MAIN_DOMAIN;
  return normalizeLicenseDomain(configured) ?? null;
}

async function tierForToken(
  token: string | null | undefined,
  platformDomain: string | null,
  options: LicenseResolveOptions,
): Promise<LicenseTier> {
  if (!token || !platformDomain) return 'free';
  const result = await verifyPlatformLicenseToken(token, platformDomain, options);
  return result.valid ? result.tier : 'free';
}

async function readDbToken(client?: { from: (table: string) => any }): Promise<string | null> {
  try {
    const dbClient = client ?? createAdminClient();
    const { data } = await dbClient
      .from('integrations_config')
      .select('sellf_license')
      .eq('id', 1)
      .single();
    return (data as { sellf_license: string | null } | null)?.sellf_license ?? null;
  } catch {
    return null;
  }
}

export async function resolveCurrentTier(options: LicenseResolveOptions = {}): Promise<LicenseTier> {
  // DEMO_MODE / E2E_MODE unlock all features as a NON-PRODUCTION test/dev seam only.
  // In a production build (the release tarball + Docker image both build with
  // NODE_ENV=production) these flags are IGNORED, so a self-hoster cannot flip one env
  // var to get business for free — every real install must present a signed token.
  // The public demo runs a production build and is licensed by its own signed token.
  if (process.env.NODE_ENV !== 'production' && (process.env.DEMO_MODE === 'true' || process.env.E2E_MODE === 'true')) {
    return 'business';
  }

  const platformDomain = getPlatformDomain();
  if (!platformDomain) return 'free';

  const dbTier = await tierForToken(await readDbToken(options.dataClient), platformDomain, options);
  if (dbTier !== 'free') return dbTier;

  return tierForToken(process.env.SELLF_LICENSE_KEY, platformDomain, options);
}

export async function checkFeature(
  feature: Feature,
  options?: LicenseResolveOptions,
): Promise<boolean> {
  return hasFeature(await resolveCurrentTier(options), feature);
}
