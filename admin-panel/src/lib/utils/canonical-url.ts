// Canonical public origin for external URLs (Stripe return_url, magic links).
// request.nextUrl.origin leaks bind-address shapes (http://[::]:3333) behind
// reverse proxies that don't forward X-Forwarded-Host.

import type { NextRequest } from 'next/server';

const BIND_ADDRESS_HOSTS = new Set(['[::]', '0.0.0.0', '::', '127.0.0.1']);

function isExternalSafeOrigin(value: string | undefined | null): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (BIND_ADDRESS_HOSTS.has(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function deriveOriginFromMainDomain(): string | null {
  const mainDomain = process.env.MAIN_DOMAIN?.trim();
  if (!mainDomain) return null;
  // MAIN_DOMAIN is stored without scheme; assume https for everything except
  // explicit localhost (dev only).
  const scheme = mainDomain.startsWith('localhost') ? 'http' : 'https';
  const candidate = `${scheme}://${mainDomain}`;
  return isExternalSafeOrigin(candidate) ? candidate : null;
}

export function getCanonicalOrigin(request: NextRequest): string {
  const fromEnv =
    (isExternalSafeOrigin(process.env.SITE_URL) && process.env.SITE_URL) ||
    (isExternalSafeOrigin(process.env.NEXT_PUBLIC_SITE_URL) &&
      process.env.NEXT_PUBLIC_SITE_URL) ||
    deriveOriginFromMainDomain();

  if (fromEnv) {
    // Normalize: strip trailing slash so callers can append `/path` safely.
    return fromEnv.replace(/\/+$/, '');
  }

  const requestOrigin = request.nextUrl.origin;
  if (isExternalSafeOrigin(requestOrigin)) {
    return requestOrigin.replace(/\/+$/, '');
  }

  // Last resort: callers should never reach this in production. Throw so the
  // bug surfaces in logs instead of leaking a bind-address URL into Stripe.
  throw new Error(
    `Cannot determine canonical origin: no SITE_URL/NEXT_PUBLIC_SITE_URL/MAIN_DOMAIN env, ` +
      `and request origin "${requestOrigin}" is unusable (bind address or invalid). ` +
      `Set SITE_URL in the deployment env.`,
  );
}
