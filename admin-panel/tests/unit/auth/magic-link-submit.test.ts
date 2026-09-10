import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMagicLinkRequest = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/magic-link/client', () => ({ sendMagicLinkRequest }));

import { submitMagicLink } from '@/lib/auth/magic-link/submit';

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
});
