import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMagicLinkRequest = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/magic-link/client', () => ({ sendMagicLinkRequest }));

import { magicLinkRetryAt, submitMagicLink } from '@/lib/auth/magic-link/submit';

function makeCaptcha(token: string | null) {
  return {
    token,
    isLoading: false,
    resetTrigger: 0,
    reset: vi.fn(),
    onVerify: vi.fn(),
    onError: vi.fn(),
    onTimeout: vi.fn(),
  };
}

describe('submitMagicLink', () => {
  beforeEach(() => {
    sendMagicLinkRequest.mockReset();
  });

  it('returns captcha_missing without calling the server when there is no token', async () => {
    const captcha = makeCaptcha(null);

    const result = await submitMagicLink({ email: 'a@b.com', captcha, flow: 'login' });

    expect(result).toEqual({ ok: false, reason: 'captcha_missing' });
    expect(sendMagicLinkRequest).not.toHaveBeenCalled();
    expect(captcha.reset).not.toHaveBeenCalled();
  });

  it('sends the request with the captcha token and flow-specific fields', async () => {
    sendMagicLinkRequest.mockResolvedValue({ ok: true });
    const captcha = makeCaptcha('tok-123');

    const result = await submitMagicLink({
      email: 'a@b.com',
      captcha,
      flow: 'free_product',
      productSlug: 'widget',
      couponCode: 'SAVE10',
      successUrl: 'https://example.com/thanks',
    });

    expect(result).toEqual({ ok: true });
    expect(sendMagicLinkRequest).toHaveBeenCalledWith({
      email: 'a@b.com',
      captchaToken: 'tok-123',
      flow: 'free_product',
      productSlug: 'widget',
      couponCode: 'SAVE10',
      successUrl: 'https://example.com/thanks',
    });
    expect(captcha.reset).not.toHaveBeenCalled();
  });

  it('resets the captcha and maps the error code on failure', async () => {
    sendMagicLinkRequest.mockResolvedValue({ ok: false, code: 'rate_limited' });
    const captcha = makeCaptcha('tok-123');

    const result = await submitMagicLink({ email: 'a@b.com', captcha, flow: 'login' });

    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
    expect(captcha.reset).toHaveBeenCalledTimes(1);
  });

  it('passes the queued flag through (W147-9)', async () => {
    sendMagicLinkRequest.mockResolvedValue({ ok: false, code: 'rate_limited', queued: true });
    expect(await submitMagicLink({ email: 'a@b.com', captcha: makeCaptcha('t'), flow: 'post_checkout', productSlug: 'p' }))
      .toEqual({ ok: false, reason: 'rate_limited', queued: true });
  });
});

describe('magicLinkRetryAt', () => {
  // The daily-limit notice names the minute the inbox opens again, never seconds (REG-rc5-A uwaga 1).
  it.each(['en', 'pl'])('shows the retry time without seconds, with the time zone (%s)', locale => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T10:15:42Z'));
    try {
      const text = magicLinkRetryAt(3600, locale);
      expect(text).toMatch(/\d{1,2}:\d{2}(?!:\d)/);
      expect(text).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
      expect(text).toMatch(/2026/);
      expect(text).toMatch(/GMT|UTC|CES?T/);
    } finally {
      vi.useRealTimers();
    }
  });
});
