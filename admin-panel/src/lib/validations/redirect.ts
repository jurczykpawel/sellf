/**
 * Validate that a redirect URL is safe (relative path or same-origin).
 * Prevents open redirect attacks via success_url / return_url parameters.
 *
 * @see tests/unit/security/open-redirect.test.ts
 */
export function isSafeRedirectUrl(url: string, siteUrl?: string): boolean {
  if (!url) return false;

  // Normalize backslashes — browsers and Node.js treat \ as / in URLs,
  // so /\evil.com becomes //evil.com (protocol-relative → open redirect)
  const normalized = url.replace(/\\/g, '/');

  // Allow relative URLs (starting with /) but block protocol-relative (//evil.com)
  if (normalized.startsWith('/') && !normalized.startsWith('//')) {
    return true;
  }

  // For absolute URLs, validate against site origin
  const effectiveSiteUrl = siteUrl
    || process.env.NEXT_PUBLIC_SITE_URL
    || process.env.SITE_URL
    || process.env.NEXT_PUBLIC_APP_URL;

  if (!effectiveSiteUrl) {
    // No site URL configured — only allow relative paths
    return false;
  }

  try {
    const parsed = new URL(url);
    const site = new URL(effectiveSiteUrl);
    return parsed.origin === site.origin;
  } catch {
    return false;
  }
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
  if (!url) return false;
  const normalized = url.replace(/\\/g, '/');
  const isRelative = normalized.startsWith('/') && !normalized.startsWith('//');
  const isHttp = normalized.startsWith('https://') || normalized.startsWith('http://');
  return isRelative || isHttp;
}
