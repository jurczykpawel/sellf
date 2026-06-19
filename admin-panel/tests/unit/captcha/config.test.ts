import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getCaptchaConfig } from '@/lib/captcha/config';

const SAVED = {
  TURNSTILE_TEST_MODE: process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE,
  TURNSTILE_SITE_KEY: process.env.CLOUDFLARE_TURNSTILE_SITE_KEY,
  TURNSTILE_PUBLIC_SITE_KEY: process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY,
  TURNSTILE_SECRET_KEY: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY,
  ALTCHA_HMAC_KEY: process.env.ALTCHA_HMAC_KEY,
};

function clearAll() {
  delete process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE;
  delete process.env.CLOUDFLARE_TURNSTILE_SITE_KEY;
  delete process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY;
  delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  delete process.env.ALTCHA_HMAC_KEY;
}

beforeEach(() => {
  clearAll();
});

afterEach(() => {
  clearAll();
  for (const [k, v] of Object.entries(SAVED)) {
    if (v !== undefined) {
      const envKey =
        k === 'TURNSTILE_TEST_MODE'
          ? 'NEXT_PUBLIC_TURNSTILE_TEST_MODE'
          : k === 'TURNSTILE_PUBLIC_SITE_KEY'
            ? 'NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY'
            : k === 'TURNSTILE_SITE_KEY'
              ? 'CLOUDFLARE_TURNSTILE_SITE_KEY'
              : k === 'TURNSTILE_SECRET_KEY'
                ? 'CLOUDFLARE_TURNSTILE_SECRET_KEY'
                : 'ALTCHA_HMAC_KEY';
      process.env[envKey] = v;
    }
  }
});

describe('getCaptchaConfig', () => {
  it('returns turnstile config when both site key and secret key are set', () => {
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY = 'turnstile-site-key';
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'turnstile-secret';

    const config = getCaptchaConfig();

    expect(config.provider).toBe('turnstile');
    expect(config.siteKey).toBe('turnstile-site-key');
    expect(config.scriptUrl).toContain('challenges.cloudflare.com');
    expect(config.scriptUrl).toContain('turnstile');
    expect(config.widgetTag).toBe('turnstile');
    expect(config.challengeUrl).toBeNull();
  });

  it('accepts NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY as a turnstile site key source', () => {
    process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY = 'public-site-key';
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'turnstile-secret';

    const config = getCaptchaConfig();

    expect(config.provider).toBe('turnstile');
    expect(config.siteKey).toBe('public-site-key');
  });

  it('falls back to altcha when only ALTCHA_HMAC_KEY is set', () => {
    process.env.ALTCHA_HMAC_KEY = 'hmac-key';

    const config = getCaptchaConfig();

    expect(config.provider).toBe('altcha');
    expect(config.siteKey).toBeNull();
    expect(config.scriptUrl).toContain('altcha');
    // Must use the DEFAULT build (bundles the SHA-256 PoW worker), never the
    // `external` build, which ships without workers and can never solve.
    expect(config.scriptUrl).toContain('/dist/main/');
    expect(config.scriptUrl).not.toContain('/dist/external/');
    expect(config.widgetTag).toBe('altcha-widget');
    expect(config.challengeUrl).toBe('/api/captcha/challenge');
  });

  it('prefers turnstile over altcha when both are configured', () => {
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY = 'turnstile-site-key';
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'turnstile-secret';
    process.env.ALTCHA_HMAC_KEY = 'hmac-key';

    const config = getCaptchaConfig();

    expect(config.provider).toBe('turnstile');
  });

  it('returns none when no provider env is set', () => {
    const config = getCaptchaConfig();

    expect(config.provider).toBe('none');
    expect(config.siteKey).toBeNull();
    expect(config.scriptUrl).toBeNull();
    expect(config.widgetTag).toBeNull();
    expect(config.challengeUrl).toBeNull();
  });

  it('returns none when test-mode flag is set even if provider env is present', () => {
    process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE = 'true';
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY = 'turnstile-site-key';
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'turnstile-secret';

    const config = getCaptchaConfig();

    expect(config.provider).toBe('none');
  });

  it('returns none when turnstile site key is set but secret key is missing (broken config)', () => {
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY = 'turnstile-site-key';

    const config = getCaptchaConfig();

    expect(config.provider).toBe('none');
  });

  it('falls back to altcha when turnstile site key is present but secret key is missing AND altcha is configured', () => {
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY = 'turnstile-site-key';
    process.env.ALTCHA_HMAC_KEY = 'hmac-key';

    const config = getCaptchaConfig();

    expect(config.provider).toBe('altcha');
  });
});
