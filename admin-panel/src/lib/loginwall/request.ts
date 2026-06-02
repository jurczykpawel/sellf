import { NextResponse } from 'next/server';

import { isAllowedEmbedOrigin } from '@/lib/embed/checkout-embed';
import { isInternalHostname } from '@/lib/security/internal-hostname';
import { checkRateLimit } from '@/lib/rate-limiting';

/**
 * Per-IP rate-limit guard for the public loginwall routes via the shared
 * application limiter (checkRateLimit): keys on the trusted-proxy client IP
 * (the proxy-set X-Forwarded-For when TRUSTED_PROXY is enabled) with a UA
 * fingerprint fallback. Returns a 429 response to short-circuit, or null to proceed.
 */
export async function rateLimitGuard(
  action: string,
  maxRequests: number,
  windowMinutes: number,
): Promise<NextResponse | null> {
  const allowed = await checkRateLimit(action, maxRequests, windowMinutes);
  return allowed ? null : NextResponse.json({ error: 'Rate limited' }, { status: 429 });
}

export function parseCustomerRedirect(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (isInternalHostname(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function siteOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function validateRedirectAgainstAllowlist(redirectOrigin: string, allowedOrigins: string[]): boolean {
  return isAllowedEmbedOrigin(redirectOrigin, allowedOrigins);
}

export function appendTokenToFragment(target: URL, token: string): string {
  const existing = target.hash.replace(/^#/, '');
  const tokenParam = `_sf_token=${token}`;
  target.hash = existing ? `${existing}&${tokenParam}` : tokenParam;
  return target.toString();
}
