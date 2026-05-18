/**
 * Centralized security headers.
 *
 * - `buildBaseSecurityHeaders`: defaults applied via next.config.ts to every
 *   route (COOP/CORP browser isolation, X-Frame-Options, etc.). CSP is NOT
 *   here — middleware owns it because it embeds a per-request nonce.
 * - `buildContentSecurityPolicyWithNonce`: per-request CSP, attached by
 *   middleware (`src/proxy.ts`).
 * - `buildEmbeddableResourceHeaders`: relaxed CORP override for endpoints
 *   that must load from external seller domains (sellf.js, checkout embed loader, runtime config).
 */

interface HeaderEntry {
  key: string;
  value: string;
}

/**
 * Endpoints intentionally exposed to external origins (cross-domain SDK).
 * CORP is downgraded to `cross-origin` for these only — never the admin app.
 */
export const EMBEDDABLE_RESOURCE_PATHS = [
  '/api/sellf',
  '/embed/v1/checkout.js',
  '/api/runtime-config',
] as const;

interface CspBuildOptions {
  isDev?: boolean;
}

/**
 * Build a Content-Security-Policy header value bound to a per-request nonce.
 *
 * The nonce authorizes inline `<script nonce="...">` tags emitted by Server
 * Components (theme detection, tracking/consent loaders) without needing
 * `'unsafe-inline'`. `'strict-dynamic'` allows nonced loader scripts to
 * pull in their own subscripts (GTM/Klaro/FB Pixel bootstrap).
 *
 * Style is intentionally still `'unsafe-inline'` — Tailwind v4 + Next.js
 * emit dynamic critical CSS, and inline styles cannot execute JavaScript.
 */
export function buildContentSecurityPolicyWithNonce(
  nonce: string,
  opts: CspBuildOptions = {},
): string {
  const isDev = opts.isDev ?? process.env.NODE_ENV === 'development';
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
    "frame-src js.stripe.com challenges.cloudflare.com *.youtube.com player.vimeo.com fast.wistia.net player.twitch.tv",
    `connect-src 'self' *.supabase.co *.stripe.com challenges.cloudflare.com www.youtube.com s.ytimg.com *.b-cdn.net *.wistia.com *.wistia.net *.vimeo.com *.twitch.tv player.twitch.tv clips.twitch.tv${isDev ? ' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*' : ''}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
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
    { key: 'X-XSS-Protection', value: '1; mode=block' },
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
