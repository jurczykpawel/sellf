import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';

/** Shared parsing for account and payment return destinations.
 * @see tests/unit/security/open-redirect.test.ts
 */
function hasUnsupportedRedirectCharacters(value: string): boolean {
  if (/[\u0000-\u0020\u007f]/.test(value)) return true;
  return /%(?:25)*(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value);
}

/** Resolve supported destinations to the path used by navigation. */
export function resolveSafeRedirectPath(value: string, siteUrl?: string): string | null {
  if (!value || hasUnsupportedRedirectCharacters(value)) return null;
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('//')) return null;
  const configuredSite = siteUrl || getCanonicalOriginOrNull();
  if (!value.startsWith('/') && (!configuredSite || !/^https?:\/\//i.test(value))) return null;
  try {
    const site = new URL(configuredSite || 'https://relative.invalid');
    if (site.protocol !== 'https:' && site.protocol !== 'http:') return null;
    const resolved = new URL(value, site);
    if (resolved.origin !== site.origin || resolved.pathname.startsWith('//')) return null;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return null;
  }
}

export function isSafeRedirectUrl(url: string, siteUrl?: string): boolean {
  return resolveSafeRedirectPath(url, siteUrl) !== null;
}

/**
 * Validate that a URL string is a relative path or an http(s) absolute URL.
 *
 * Used for admin-configured redirect fields that intentionally allow
 * cross-origin destinations (a seller's own store, an external course
 * platform, …) — unlike `isSafeRedirectUrl`, origin is NOT restricted —
 * but a dangerous scheme (`javascript:`, `data:`, …) must still be rejected.
 *
 * @see tests/unit/security/open-redirect.test.ts
 */
export function isRelativeOrHttpUrl(url: string): boolean {
  if (!url || hasUnsupportedRedirectCharacters(url)) return false;
  const normalized = url.replace(/\\/g, '/');
  const isRelative = normalized.startsWith('/') && !normalized.startsWith('//');
  const isHttp = normalized.startsWith('https://') || normalized.startsWith('http://');
  return isRelative || isHttp;
}
