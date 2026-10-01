import type { CaptchaConfig, CaptchaProvider } from './types';

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
// Use the DEFAULT build, not `dist/external`: the external build excludes the
// bundled proof-of-work workers (SHA-256/PBKDF2) and requires registering them
// manually via `$altcha.algorithms.set(...)`. Without a worker the widget can
// never solve the challenge and ends in the `error` state ("Verification
// failed"). The main build bundles the SHA-256 worker used by our challenges.
//
// Pinned to the exact version in package.json/bun.lock (not a floating `@3`
// tag) — jsDelivr could otherwise start serving a different minor/patch at
// any time, and the SRI hash below is only valid for this exact file.
// Bump both together when the `altcha` npm dependency is upgraded; verify
// with: `curl -fsSL <url> | openssl dgst -sha384 -binary | openssl base64 -A`
// and diff the local node_modules/altcha/dist/main/altcha.js by checksum.
const ALTCHA_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/altcha@3.2.2/dist/main/altcha.js';
const ALTCHA_SCRIPT_INTEGRITY = 'sha384-qV4Gl2o6J5/ZiK69wonhWSz6cXyNzg05mIKksGFv2oEnBAZGR1FgWMFrlYuqEznz';
const ALTCHA_CHALLENGE_URL = '/api/captcha/challenge';

const NONE_CONFIG: CaptchaConfig = {
  provider: 'none',
  siteKey: null,
  scriptUrl: null,
  scriptIntegrity: null,
  widgetTag: null,
  challengeUrl: null,
};

export function getCaptchaConfig(): CaptchaConfig {
  if (process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE === 'true') {
    return NONE_CONFIG;
  }

  const turnstileSiteKey =
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY ||
    process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY ||
    '';
  const hasTurnstile = !!turnstileSiteKey && !!process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;

  if (hasTurnstile) {
    return {
      provider: 'turnstile',
      siteKey: turnstileSiteKey,
      scriptUrl: TURNSTILE_SCRIPT_URL,
      // Cloudflare doesn't publish a stable per-version hash for this URL
      // (it's an evergreen endpoint, not a pinned release asset) — no SRI
      // possible here, unlike the pinned ALTCHA CDN asset below.
      scriptIntegrity: null,
      widgetTag: 'turnstile',
      challengeUrl: null,
    };
  }

  if (process.env.ALTCHA_HMAC_KEY) {
    return {
      provider: 'altcha',
      siteKey: null,
      scriptUrl: ALTCHA_SCRIPT_URL,
      scriptIntegrity: ALTCHA_SCRIPT_INTEGRITY,
      widgetTag: 'altcha-widget',
      challengeUrl: ALTCHA_CHALLENGE_URL,
    };
  }

  return NONE_CONFIG;
}

export function getCaptchaProvider(): CaptchaProvider {
  return getCaptchaConfig().provider;
}

export function getTurnstileSiteKey(): string {
  return getCaptchaConfig().siteKey ?? '';
}
