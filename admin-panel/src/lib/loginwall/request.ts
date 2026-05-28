import { isAllowedEmbedOrigin } from '@/lib/embed/checkout-embed';
import { isInternalHostname } from '@/lib/security/internal-hostname';

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
