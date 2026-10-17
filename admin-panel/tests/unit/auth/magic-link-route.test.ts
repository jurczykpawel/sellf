import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestMagicLink = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth/magic-link/request', () => ({ requestMagicLink }));

import { POST } from '@/app/api/auth/magic-link/route';

function jsonRequest(body: unknown, contentType = 'application/json') {
  return new Request('http://localhost/api/auth/magic-link', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/auth/magic-link', () => {
  beforeEach(() => {
    requestMagicLink.mockReset();
  });

  it('accepts a partner application return path', async () => {
    requestMagicLink.mockResolvedValue({ ok: true });
    const res = await POST(jsonRequest({ email: 'a@b.com', captchaToken: 't', flow: 'login', redirectTo: '/pl/affiliates/apply' }));
    expect(res.status).toBe(200);
    expect(requestMagicLink).toHaveBeenCalledWith(expect.objectContaining({ redirectTo: '/pl/affiliates/apply' }));
  });

  it.each(['en', 'pl'])('retains %s checkout context at the gateway', async locale => {
    requestMagicLink.mockResolvedValue({ ok: true });
    const res = await POST(jsonRequest({ email: 'a@b.com', captchaToken: 't', flow: 'post_checkout', productSlug: 'course', locale }));
    expect(res.status).toBe(200);
    expect(requestMagicLink).toHaveBeenCalledWith(expect.objectContaining({ flow: 'post_checkout', productSlug: 'course', locale }));
  });

  it.each(['//elsewhere.test', '/%2f%2felsewhere.test', '/pl/affiliates/apply\n', '/pl/%61ffiliates/apply', '/pl/affiliates/apply?next=/dashboard', '/auth/product-access?product=course&return_url=https://elsewhere.test'])('rejects unsupported destination %j before the gateway', async redirectTo => {
    const res = await POST(jsonRequest({ email: 'a@b.com', captchaToken: 't', flow: 'login', redirectTo }));
    expect(res.status).toBe(400);
    expect(requestMagicLink).not.toHaveBeenCalled();
  });

  it.each(['/\t/elsewhere.test', '/\n/elsewhere.test', '/\r/elsewhere.test', '/%09/elsewhere.test', '/%250a/elsewhere.test', '//elsewhere.test', 'https://elsewhere.test/thanks'])('declines unsupported success destination %j', async successUrl => {
    const res = await POST(jsonRequest({ email: 'a@b.com', captchaToken: 't', flow: 'free_product', productSlug: 'course', successUrl }));
    expect(res.status).toBe(400);
    expect(requestMagicLink).not.toHaveBeenCalled();
  });

  it('keeps a success destination with its complete query', async () => {
    requestMagicLink.mockResolvedValue({ ok: true });
    const res = await POST(jsonRequest({ email: 'a@b.com', captchaToken: 't', flow: 'free_product', productSlug: 'course', successUrl: '/thanks?a=1&b=2' }));
    expect(res.status).toBe(200);
    expect(requestMagicLink).toHaveBeenCalledWith(expect.objectContaining({ successUrl: '/thanks?a=1&b=2' }));
  });

  it('rejects non-JSON content-type with 415', async () => {
    const res = await POST(jsonRequest({ email: 'a@b.com', captchaToken: 't', flow: 'login' }, 'text/plain'));
    expect(res.status).toBe(415);
  });

  it('rejects invalid JSON with 400 invalid_request', async () => {
    const res = await POST(jsonRequest('{not json'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('rejects unknown top-level keys with 400 invalid_request', async () => {
    const res = await POST(
      jsonRequest({ email: 'a@b.com', captchaToken: 't', flow: 'login', extra: 'nope' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('rejects a non-string email with 400 invalid_request', async () => {
    const res = await POST(jsonRequest({ email: 123, captchaToken: 't', flow: 'login' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('rejects an email over 254 chars with 400 invalid_request', async () => {
    const longEmail = `${'a'.repeat(250)}@b.com`;
    const res = await POST(jsonRequest({ email: longEmail, captchaToken: 't', flow: 'login' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('rejects an unknown flow with 400 invalid_request', async () => {
    const res = await POST(jsonRequest({ email: 'a@b.com', captchaToken: 't', flow: 'bogus' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('rejects a productSlug with invalid characters with 400 invalid_request', async () => {
    const res = await POST(
      jsonRequest({
        email: 'a@b.com',
        captchaToken: 't',
        flow: 'free_product',
        productSlug: 'not valid!',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('rejects a couponCode over 64 chars with 400 invalid_request', async () => {
    const res = await POST(
      jsonRequest({
        email: 'a@b.com',
        captchaToken: 't',
        flow: 'free_product',
        productSlug: 'widget',
        couponCode: 'x'.repeat(65),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('rejects a successUrl over 2048 chars with 400 invalid_request', async () => {
    const res = await POST(
      jsonRequest({
        email: 'a@b.com',
        captchaToken: 't',
        flow: 'free_product',
        productSlug: 'widget',
        successUrl: `https://example.com/${'x'.repeat(2048)}`,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_request');
  });

  it('does not pass any client-supplied IP field to requestMagicLink', async () => {
    requestMagicLink.mockResolvedValue({ ok: true });
    await POST(jsonRequest({ email: 'a@b.com', captchaToken: 't', flow: 'login' }));
    const call = requestMagicLink.mock.calls[0][0];
    expect(call).not.toHaveProperty('ip');
  });

  it('returns 200 ok:true on success', async () => {
    requestMagicLink.mockResolvedValue({ ok: true });
    const res = await POST(jsonRequest({ email: 'a@b.com', captchaToken: 't', flow: 'login' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it.each([
    ['demo_mode', 403],
    ['invalid_request', 400],
    ['captcha_failed', 400],
    ['invalid_email', 400],
    ['rate_limited', 429],
    ['send_failed', 502],
  ] as const)('maps result code %s to status %d', async (code, status) => {
    requestMagicLink.mockResolvedValue({ ok: false, code });
    const res = await POST(jsonRequest({ email: 'a@b.com', captchaToken: 't', flow: 'login' }));
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });
});
