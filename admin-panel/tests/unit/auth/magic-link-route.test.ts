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
