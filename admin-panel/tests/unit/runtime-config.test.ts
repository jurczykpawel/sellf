import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildRuntimeConfig } from '@/lib/runtime-config';

const DOWNLOAD_DOMAINS_KEY = 'NEXT_PUBLIC_SELLF_ALLOWED_DOWNLOAD_DOMAINS';

const SAVED = {
  TURNSTILE_TEST_MODE: process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE,
  TURNSTILE_SITE_KEY: process.env.CLOUDFLARE_TURNSTILE_SITE_KEY,
  TURNSTILE_PUBLIC_SITE_KEY: process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY,
  TURNSTILE_SECRET_KEY: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY,
  ALTCHA_HMAC_KEY: process.env.ALTCHA_HMAC_KEY,
  DOWNLOAD_DOMAINS: process.env[DOWNLOAD_DOMAINS_KEY],
};

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE;
  delete process.env.CLOUDFLARE_TURNSTILE_SITE_KEY;
  delete process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY;
  delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  delete process.env.ALTCHA_HMAC_KEY;
  delete process.env[DOWNLOAD_DOMAINS_KEY];
});

afterEach(() => {
  if (SAVED.TURNSTILE_TEST_MODE !== undefined) process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE = SAVED.TURNSTILE_TEST_MODE;
  if (SAVED.TURNSTILE_SITE_KEY !== undefined) process.env.CLOUDFLARE_TURNSTILE_SITE_KEY = SAVED.TURNSTILE_SITE_KEY;
  if (SAVED.TURNSTILE_PUBLIC_SITE_KEY !== undefined) process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY = SAVED.TURNSTILE_PUBLIC_SITE_KEY;
  if (SAVED.TURNSTILE_SECRET_KEY !== undefined) process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = SAVED.TURNSTILE_SECRET_KEY;
  if (SAVED.ALTCHA_HMAC_KEY !== undefined) process.env.ALTCHA_HMAC_KEY = SAVED.ALTCHA_HMAC_KEY;
  if (SAVED.DOWNLOAD_DOMAINS !== undefined) process.env[DOWNLOAD_DOMAINS_KEY] = SAVED.DOWNLOAD_DOMAINS;
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

describe('buildRuntimeConfig — server-only var wins over NEXT_PUBLIC_* (build-time inlining trap)', () => {
  const KEYS = ['PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SITE_URL', 'NEXT_PUBLIC_SITE_URL'] as const;
  const savedUrls: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      savedUrls[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (savedUrls[key] !== undefined) process.env[key] = savedUrls[key];
      else delete process.env[key];
    }
  });

  // DO NOT "fix" these to prefer NEXT_PUBLIC_* — see the comment in
  // runtime-config.ts. Verified against a real `next build`: Next.js
  // statically inlines process.env.NEXT_PUBLIC_* everywhere (including
  // server bundles), so the moment it's a non-empty build-time string
  // (which build-release.yml's CI build always sets it to — a placeholder,
  // by design), the SUPABASE_URL/SITE_URL fallback gets constant-folded
  // away entirely. A test can't reproduce that build-time inlining, so
  // this only guards the source-level precedence — the inlining trap
  // itself was confirmed by inspecting a real compiled build's output.
  it('prefers the server-only SUPABASE_URL over NEXT_PUBLIC_SUPABASE_URL (which CI builds with a placeholder)', () => {
    process.env.SUPABASE_URL = 'https://real-runtime-value.example.com';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co';

    expect(buildRuntimeConfig().supabaseUrl).toBe('https://real-runtime-value.example.com');
  });

  it('falls back to NEXT_PUBLIC_SUPABASE_URL when SUPABASE_URL is not set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://api.example.com';

    expect(buildRuntimeConfig().supabaseUrl).toBe('https://api.example.com');
  });

  it('prefers SUPABASE_ANON_KEY over NEXT_PUBLIC_SUPABASE_ANON_KEY', () => {
    process.env.SUPABASE_ANON_KEY = 'real-runtime-key';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon-key';

    expect(buildRuntimeConfig().supabaseAnonKey).toBe('real-runtime-key');
  });

  it('prefers SITE_URL over NEXT_PUBLIC_SITE_URL', () => {
    process.env.SITE_URL = 'https://real-runtime-site.example.com';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://placeholder.example.com';

    expect(buildRuntimeConfig().siteUrl).toBe('https://real-runtime-site.example.com');
  });

  // PUBLIC_SUPABASE_URL exists for deployments where SUPABASE_URL is only
  // reachable on the internal network (e.g. Coolify's docker-compose
  // pointing the server at http://kong:8000) — the browser needs a
  // separate, publicly reachable URL. It must NOT be NEXT_PUBLIC_-prefixed,
  // or Next.js inlines it at build time (see the comment in
  // runtime-config.ts) instead of reading it live at request time.
  it('prefers PUBLIC_SUPABASE_URL over SUPABASE_URL for the browser-facing value', () => {
    process.env.SUPABASE_URL = 'http://kong:8000';
    process.env.PUBLIC_SUPABASE_URL = 'https://supabase.example.com';

    expect(buildRuntimeConfig().supabaseUrl).toBe('https://supabase.example.com');
  });

  it('falls back to the existing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL order when PUBLIC_SUPABASE_URL is unset', () => {
    process.env.SUPABASE_URL = 'https://real-runtime-value.example.com';

    expect(buildRuntimeConfig().supabaseUrl).toBe('https://real-runtime-value.example.com');
  });
});

describe('buildRuntimeConfig — trustedDownloadDomains', () => {
  it('includes the baseline provider list when env is unset', () => {
    const config = buildRuntimeConfig();
    expect(config.trustedDownloadDomains).toContain('cloudflarestorage.com');
    expect(config.trustedDownloadDomains).toContain('amazonaws.com');
    expect(config.trustedDownloadDomains).not.toContain('lm.techskills.academy');
  });

  it('appends operator additions from NEXT_PUBLIC_SELLF_ALLOWED_DOWNLOAD_DOMAINS', () => {
    process.env[DOWNLOAD_DOMAINS_KEY] = 'lm.techskills.academy, assets.example.com';
    const config = buildRuntimeConfig();
    expect(config.trustedDownloadDomains).toContain('lm.techskills.academy');
    expect(config.trustedDownloadDomains).toContain('assets.example.com');
    expect(config.trustedDownloadDomains).toContain('cloudflarestorage.com');
  });
});
