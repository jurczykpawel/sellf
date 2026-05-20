import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildRuntimeConfig } from '@/lib/runtime-config';

const SAVED = {
  TURNSTILE_TEST_MODE: process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE,
  TURNSTILE_SITE_KEY: process.env.CLOUDFLARE_TURNSTILE_SITE_KEY,
  TURNSTILE_PUBLIC_SITE_KEY: process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY,
  TURNSTILE_SECRET_KEY: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY,
  ALTCHA_HMAC_KEY: process.env.ALTCHA_HMAC_KEY,
};

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE;
  delete process.env.CLOUDFLARE_TURNSTILE_SITE_KEY;
  delete process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY;
  delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  delete process.env.ALTCHA_HMAC_KEY;
});

afterEach(() => {
  if (SAVED.TURNSTILE_TEST_MODE !== undefined) process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE = SAVED.TURNSTILE_TEST_MODE;
  if (SAVED.TURNSTILE_SITE_KEY !== undefined) process.env.CLOUDFLARE_TURNSTILE_SITE_KEY = SAVED.TURNSTILE_SITE_KEY;
  if (SAVED.TURNSTILE_PUBLIC_SITE_KEY !== undefined) process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY = SAVED.TURNSTILE_PUBLIC_SITE_KEY;
  if (SAVED.TURNSTILE_SECRET_KEY !== undefined) process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = SAVED.TURNSTILE_SECRET_KEY;
  if (SAVED.ALTCHA_HMAC_KEY !== undefined) process.env.ALTCHA_HMAC_KEY = SAVED.ALTCHA_HMAC_KEY;
});

describe('buildRuntimeConfig — captcha facade', () => {
  it('exposes captcha as a single CaptchaConfig object (not separate fields)', () => {
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY = 'ts-key';
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'ts-secret';

    const config = buildRuntimeConfig();

    expect(config.captcha).toBeDefined();
    expect(config.captcha.provider).toBe('turnstile');
    expect(config.captcha.siteKey).toBe('ts-key');
    expect(config.captcha.scriptUrl).toContain('challenges.cloudflare.com');
  });

  it('returns altcha config when only ALTCHA_HMAC_KEY is set', () => {
    process.env.ALTCHA_HMAC_KEY = 'hmac';

    const config = buildRuntimeConfig();

    expect(config.captcha.provider).toBe('altcha');
    expect(config.captcha.siteKey).toBeNull();
    expect(config.captcha.challengeUrl).toBe('/api/captcha/challenge');
  });

  it('returns none provider when no captcha env is set', () => {
    const config = buildRuntimeConfig();

    expect(config.captcha.provider).toBe('none');
  });

  it('no longer exposes the legacy cloudflareSiteKey / captchaProvider top-level fields', () => {
    process.env.CLOUDFLARE_TURNSTILE_SITE_KEY = 'ts-key';
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'ts-secret';

    const config = buildRuntimeConfig() as Record<string, unknown>;

    expect(config.cloudflareSiteKey).toBeUndefined();
    expect(config.captchaProvider).toBeUndefined();
  });
});
