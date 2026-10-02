/**
 * Centralized security headers.
 *
 * - `buildBaseSecurityHeaders`: defaults applied via next.config.ts to every
 *   route (COOP/CORP browser isolation, X-Frame-Options, etc.). CSP is NOT
 *   here — middleware owns it because it embeds a per-request nonce.
 * - `buildContentSecurityPolicyWithNonce`: per-request CSP, attached by
 *   middleware (`src/proxy.ts`).
 * - `buildEmbeddableResourceHeaders`: relaxed CORP override for endpoints
 *   that must load from external seller domains (checkout embed loader,
 *   login-wall / gating loader scripts, runtime config).
 */

interface HeaderEntry {
  key: string;
  value: string;
}

/**
 * Endpoints intentionally exposed to external origins (embed checkout
 * loader, login-wall / gating loader scripts, runtime-config bootstrap —
 * all loaded via `<script src>` from a seller's own page). CORP is
 * downgraded to `cross-origin` for these only — never the admin app itself.
 */
export const EMBEDDABLE_RESOURCE_PATHS = [
  '/embed/v1/checkout.js',
  '/api/runtime-config',
  '/api/loginwall/login.js',
  '/api/loginwall/gate.js',
] as const;

/**
 * Of the paths above, these two also carry their own short public
 * `Cache-Control` (set in the route handler) that the generic
 * `/api/:path*` no-store rule in next.config.ts would otherwise win —
 * next.config header rules apply in array order with the last matching
 * rule winning per header key, so this list must be re-applied after that
 * generic rule (mirrors the route handlers' own `Cache-Control`).
 */
export const EMBEDDABLE_PUBLIC_CACHE_PATHS = [
  '/api/loginwall/login.js',
  '/api/loginwall/gate.js',
] as const;

interface CspBuildOptions {
  isDev?: boolean;
  extraConnectSrc?: string[];
  extraFrameSrc?: string[];
}

/**
 * Resolve the Supabase origin the browser actually talks to, so `connect-src`
 * can name it instead of allowing every `*.supabase.co` project (self-hosted
 * Supabase behind a custom domain is not `*.supabase.co` either, which is
 * exactly why the configured URL — not the wildcard — is the right source).
 *
 * Mirrors the precedence in `buildRuntimeConfig()` (`runtime-config.ts`):
 * `PUBLIC_SUPABASE_URL || SUPABASE_URL || NEXT_PUBLIC_SUPABASE_URL`. Not
 * imported from there directly — that module is `server-only`, and this file
 * is also loaded by `next.config.ts` at build time, where `server-only`
 * throws unconditionally. None of these three vars are `NEXT_PUBLIC_`-first,
 * so this reads live at request time in the edge middleware rather than
 * getting build-time inlined.
 */
function resolveSupabaseConnectOrigins(): { http: string; ws: string } | null {
  // This module is imported by next.config.ts too; keep it dependency-free.
  const configuredUrl = ['PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']
    .map(name => process.env[name])
    .find(value => value && !/placeholder[.]supabase[.]co/i.test(value));
  if (!configuredUrl) return null;

  try {
    const http = new URL(configuredUrl).origin;
    const ws = http.replace(/^http/, 'ws');
    return { http, ws };
  } catch {
    return null;
  }
}

/**
 * Build a Content-Security-Policy header value bound to a per-request nonce.
 *
 * The nonce authorizes inline `<script nonce="...">` tags emitted by Server
 * Components (theme detection, tracking/consent loaders) without needing
 * `'unsafe-inline'`. `'strict-dynamic'` allows nonced loader scripts to
 * pull in their own subscripts (GTM/cookieconsent/FB Pixel bootstrap).
 *
 * Style is intentionally still `'unsafe-inline'` — Tailwind v4 + Next.js
 * emit dynamic critical CSS, and inline styles cannot execute JavaScript.
 */
export function buildContentSecurityPolicyWithNonce(
  nonce: string,
  opts: CspBuildOptions = {},
): string {
  const isDev = opts.isDev ?? process.env.NODE_ENV === 'development';
  const supabaseOrigins = resolveSupabaseConnectOrigins();
  const supabaseConnectSrc = supabaseOrigins
    ? `${supabaseOrigins.http} ${supabaseOrigins.ws}`
    : '*.supabase.co wss://*.supabase.co';
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // 'strict-dynamic' makes browsers ignore host allow-list entries when
    // they support CSP3, but legacy browsers fall back to host matching;
    // keeping the third-party hosts here preserves coverage on those.
    'js.stripe.com',
    'challenges.cloudflare.com',
    'www.youtube.com',
    's.ytimg.com',
    isDev ? "'unsafe-eval'" : '',
  ]
    .filter(Boolean)
    .join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: i.ibb.co *.stripe.com img.youtube.com vumbnail.com embed-ssl.wistia.com fast.wistia.com placehold.co",
    "font-src 'self' data:",
    "media-src 'self' blob: *.b-cdn.net",
    `frame-src js.stripe.com challenges.cloudflare.com *.youtube.com player.vimeo.com fast.wistia.net player.twitch.tv${opts.extraFrameSrc?.length ? ' ' + opts.extraFrameSrc.join(' ') : ''}`,
    `connect-src 'self' ${supabaseConnectSrc} *.stripe.com challenges.cloudflare.com www.youtube.com s.ytimg.com *.b-cdn.net *.wistia.com *.wistia.net *.vimeo.com *.twitch.tv player.twitch.tv clips.twitch.tv${opts.extraConnectSrc?.length ? ' ' + opts.extraConnectSrc.join(' ') : ''}${isDev ? ' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*' : ''}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    // No native <form action> targets exist anywhere in the app — every
    // form calls preventDefault() and submits via fetch(); OAuth and magic
    // links redirect via window.location, not a form post. 'self' covers
    // the no-JS fallback (a plain form with no action posts to the current
    // URL) without opening submissions to any third party.
    "form-action 'self'",
  ].join('; ');
}

/**
 * Default security headers for the whole app. CSP is NOT here — middleware
 * sets it per-request with a fresh nonce. Sellf uses redirect-based OAuth
 * (not popup) so COOP=same-origin does not break auth flows.
 */
export function buildBaseSecurityHeaders(): HeaderEntry[] {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    // Disabled by design: the legacy XSS Auditor is gone from modern browsers and
    // `1; mode=block` enabled XS-Leak side channels in older ones. CSP (nonce +
    // strict-dynamic, set per-request in middleware) is the actual XSS control.
    { key: 'X-XSS-Protection', value: '0' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
  ];
}

/**
 * Override CORP for endpoints that must load from external seller domains.
 * COOP is intentionally NOT set here — the global header still applies.
 */
export function buildEmbeddableResourceHeaders(): HeaderEntry[] {
  return [
    { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
  ];
}

export function buildApiSecurityHeaders(): HeaderEntry[] {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
  ];
}

/**
 * Short public caching for endpoints that are safe to cache at the edge:
 * license verification material (JWKS, revocation list) and the
 * login-wall / gating loader scripts (`EMBEDDABLE_PUBLIC_CACHE_PATHS`).
 */
export function buildPublicCacheHeaders(): HeaderEntry[] {
  return [
    { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=300' },
  ];
}
