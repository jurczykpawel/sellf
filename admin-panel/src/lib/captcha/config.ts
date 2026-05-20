import type { CaptchaConfig, CaptchaProvider } from './types';

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const ALTCHA_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/altcha@3/dist/external/altcha.min.js';
const ALTCHA_CHALLENGE_URL = '/api/captcha/challenge';

const NONE_CONFIG: CaptchaConfig = {
  provider: 'none',
  siteKey: null,
  scriptUrl: null,
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
      widgetTag: 'turnstile',
      challengeUrl: null,
    };
  }

  if (process.env.ALTCHA_HMAC_KEY) {
    return {
      provider: 'altcha',
      siteKey: null,
      scriptUrl: ALTCHA_SCRIPT_URL,
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
