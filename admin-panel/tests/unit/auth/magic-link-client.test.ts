import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { sendMagicLinkRequest } from '@/lib/auth/magic-link/client';

describe('sendMagicLinkRequest', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts to /api/auth/magic-link with a JSON body omitting null/undefined optional fields', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await sendMagicLinkRequest({
      email: 'a@b.com',
      captchaToken: 'tok',
      flow: 'login',
      productSlug: undefined,
      couponCode: null,
      successUrl: null,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/magic-link',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toEqual({ email: 'a@b.com', captchaToken: 'tok', flow: 'login' });
  });

  it('returns the parsed ok:false body on a 4xx/5xx response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ ok: false, code: 'rate_limited' }),
    });

    const result = await sendMagicLinkRequest({ email: 'a@b.com', captchaToken: 'tok', flow: 'login' });
    expect(result).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('returns send_failed when fetch throws', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    const result = await sendMagicLinkRequest({ email: 'a@b.com', captchaToken: 'tok', flow: 'login' });
    expect(result).toEqual({ ok: false, code: 'send_failed' });
  });

  it('returns send_failed when the response carries an unknown code', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, code: 'totally_unknown' }),
    });

    const result = await sendMagicLinkRequest({ email: 'a@b.com', captchaToken: 'tok', flow: 'login' });
    expect(result).toEqual({ ok: false, code: 'send_failed' });
  });
});
