/**
 * Instance public origin: SITE_URL → MAIN_DOMAIN → legacy public env at runtime.
 * Shared validators use the browser origin; browsers never resolve server env.
 * @see lib/security/startup-assertions.ts
 */
import { readRuntimeEnv, isBuildPlaceholder } from '@/lib/config/runtime-env';
import type { NextRequest } from 'next/server';

const BIND_ADDRESS_HOSTS = new Set(['[::]', '0.0.0.0', '::', '127.0.0.1']);
let warned = false;

function normalizeOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  if (isBuildPlaceholder(value)) {
    if (!warned) {
      console.error('[public-url] Build placeholder rejected. Configure SITE_URL at runtime.');
      warned = true;
    }
    return null;
  }
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || BIND_ADDRESS_HOSTS.has(url.hostname)) return null;
    if (url.username || url.password || url.search || url.hash || !/^\/*$/.test(url.pathname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getCanonicalOriginOrNull(): string | null {
  if (typeof window !== 'undefined') return window.location.origin;
  const site = normalizeOrigin(readRuntimeEnv('SITE_URL'));
  if (site) return site;
  const domain = readRuntimeEnv('MAIN_DOMAIN')?.trim();
  const main = domain ? normalizeOrigin(`${domain.startsWith('localhost') ? 'http' : 'https'}://${domain}`) : null;
  if (main) return main;
  for (const name of ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_APP_URL']) {
    const origin = normalizeOrigin(readRuntimeEnv(name));
    if (origin) return origin;
  }
  return null;
}

/** Required request-less origin; never invent a production URL. */
export function getPublicBaseUrl(): string {
  const origin = getCanonicalOriginOrNull();
  if (origin) return origin;
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3000';
  throw new Error('Cannot determine canonical origin. Set SITE_URL at runtime.');
}

export function getCanonicalOrigin(request: NextRequest): string {
  const origin = getCanonicalOriginOrNull();
  if (origin) return origin;
  // Production must have an explicit trusted origin; request Host is untrusted.
  if (process.env.NODE_ENV !== 'production') {
    const requestOrigin = normalizeOrigin(request.nextUrl.origin);
    if (requestOrigin) return requestOrigin;
  }
  throw new Error('Cannot determine canonical origin. Set SITE_URL at runtime.');
}
