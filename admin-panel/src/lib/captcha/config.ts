/**
 * Captcha provider detection
 *
 * Selection logic:
 * 1. Turnstile site key + secret key set → 'turnstile'
 * 2. ALTCHA_HMAC_KEY set → 'altcha'
 * 3. Neither → 'none' (dev warning)
 *
 * @see types.ts — CaptchaProvider type
 */

import type { CaptchaProvider } from './types';

/**
 * Detect which captcha provider is configured (server-side only).
 * Called from API routes and runtime-config endpoint.
 */
export function getCaptchaProvider(): CaptchaProvider {
  const hasTurnstile =
    !!(process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY) &&
    !!process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;

  if (hasTurnstile) return 'turnstile';

  const hasAltcha = !!process.env.ALTCHA_HMAC_KEY;
  if (hasAltcha) return 'altcha';

  return 'none';
}

/**
 * Get the Turnstile site key for client-side rendering.
 * Returns empty string when Turnstile is not configured.
 */
export function getTurnstileSiteKey(): string {
  return (
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY ||
    process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY ||
    ''
  );
}
