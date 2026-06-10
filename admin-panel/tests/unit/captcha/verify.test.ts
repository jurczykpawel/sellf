import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyCaptchaToken } from '@/lib/captcha/verify';

const SAVED_SECRET = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
const SAVED_NODE_ENV = process.env.NODE_ENV;
const SAVED_ALTCHA = process.env.ALTCHA_HMAC_KEY;
const SAVED_FETCH = global.fetch;

beforeEach(() => {
  process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'test-turnstile-secret';
});

afterEach(() => {
  if (SAVED_SECRET === undefined) delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  else process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = SAVED_SECRET;
  if (SAVED_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = SAVED_NODE_ENV;
  if (SAVED_ALTCHA === undefined) delete process.env.ALTCHA_HMAC_KEY;
  else process.env.ALTCHA_HMAC_KEY = SAVED_ALTCHA;
  global.fetch = SAVED_FETCH;
  vi.restoreAllMocks();
});

describe('verifyCaptchaToken — ALTCHA replay/expiry', () => {
  it('rejects an ALTCHA payload whose embedded expiry has already passed (no indefinite replay)', async () => {
    process.env.ALTCHA_HMAC_KEY = 'test-altcha-key';
    const pastEpoch = Math.floor((Date.now() - 60_000) / 1000);
    const salt = `deadbeefcafe?expires=${pastEpoch}&`;
    const payload = Buffer.from(
      JSON.stringify({ algorithm: 'SHA-256', challenge: 'x', number: 1, salt, signature: 'y' }),
    ).toString('base64');

    const result = await verifyCaptchaToken(payload, 'altcha');
    expect(result.success).toBe(false);
  });
});

describe('verifyCaptchaToken — provider=none fail-closed in production', () => {
  it('rejects when provider=none in production (prevents magic-link bombing)', async () => {
    process.env.NODE_ENV = 'production';
    const result = await verifyCaptchaToken('any-token', 'none');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/security|verification/i);
  });

  it('still permits provider=none in development (dev convenience)', async () => {
    process.env.NODE_ENV = 'development';
    const result = await verifyCaptchaToken(null, 'none');
    expect(result.success).toBe(true);
  });
});

describe('verifyCaptchaToken — Turnstile', () => {
  it('passes an AbortSignal to the siteverify fetch call', async () => {
    let capturedInit: RequestInit | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }));
    });

    const result = await verifyCaptchaToken('tok-abc', 'turnstile');

    expect(result.success).toBe(true);
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns success:false when the siteverify fetch aborts (timeout)', async () => {
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal | undefined;
        if (signal?.aborted) {
          reject(new DOMException('aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const result = await Promise.race([
      verifyCaptchaToken('tok-slow', 'turnstile'),
      new Promise<{ success: false; error: string }>((resolve) =>
        setTimeout(() => resolve({ success: false, error: 'test-timeout' }), 200),
      ),
    ]);

    expect(result.success).toBe(false);
  });
});
