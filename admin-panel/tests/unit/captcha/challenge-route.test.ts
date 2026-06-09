import { beforeEach, describe, expect, it, vi } from 'vitest';

// The ALTCHA widget runs on the seller's page (cross-origin) and fetches the
// challenge from Sellf. Without CORS headers the browser blocks the response and
// the widget shows "Verification failed" — breaking BOTH the free email gate and
// the paid captcha gate (paid mounts Stripe only after the captcha passes).
// The challenge is a public proof-of-work, so we reflect CORS for any origin the
// product's seller has allowlisted (same allowlist the embed checkout uses).

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

import { GET, OPTIONS } from '@/app/api/captcha/challenge/route';

function makeDbMock(allowedOrigins: string[] = ['https://captions.techskills.academy']) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'products') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { seller_id: 'seller-1' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'seller_embed_settings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { allowed_embed_origins: allowedOrigins },
                error: null,
              }),
            }),
            limit: vi.fn().mockResolvedValue({
              data: [{ allowed_embed_origins: allowedOrigins }],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function makeRequest(
  { origin, productSlug }: { origin?: string; productSlug?: string } = {},
  method = 'GET',
): Request {
  const headers = new Headers();
  if (origin) headers.set('Origin', origin);
  const url = new URL('http://localhost/api/captcha/challenge');
  if (productSlug) url.searchParams.set('productSlug', productSlug);
  return new Request(url, { method, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SELLF_EMBED_ALLOWED_ORIGINS;
  process.env.ALTCHA_HMAC_KEY = 'test-hmac-key';
  mocks.createAdminClient.mockReturnValue(makeDbMock());
  mocks.checkRateLimit.mockResolvedValue(true);
});

describe('GET /api/captcha/challenge', () => {
  it('returns a solvable challenge (unchanged core behavior)', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ algorithm: 'SHA-256' });
    expect(typeof body.challenge).toBe('string');
    expect(typeof body.salt).toBe('string');
    expect(typeof body.signature).toBe('string');
  });

  it('500s when ALTCHA is not configured', async () => {
    delete process.env.ALTCHA_HMAC_KEY;
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });

  it('reflects CORS for an allowlisted embed origin (with productSlug)', async () => {
    const res = await GET(
      makeRequest({ origin: 'https://captions.techskills.academy', productSlug: 'captions-basic-styles' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://captions.techskills.academy');
    expect(res.headers.get('Vary')).toContain('Origin');
    // The challenge must still be readable by the widget.
    const body = await res.json();
    expect(typeof body.challenge).toBe('string');
  });

  it('does not reflect CORS for a non-allowlisted origin', async () => {
    const res = await GET(
      makeRequest({ origin: 'https://evil.example.com', productSlug: 'captions-basic-styles' }),
    );
    // Still 200 (public challenge) but no ACAO → browser blocks the cross-origin read.
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('same-origin admin call (no origin, no slug) returns no CORS header', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('falls back to env allowlist when DB has none', async () => {
    process.env.SELLF_EMBED_ALLOWED_ORIGINS = 'https://captions.techskills.academy';
    mocks.createAdminClient.mockReturnValue(makeDbMock([]));
    const res = await GET(
      makeRequest({ origin: 'https://captions.techskills.academy', productSlug: 'captions-basic-styles' }),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://captions.techskills.academy');
  });
});

describe('OPTIONS /api/captcha/challenge', () => {
  it('returns 204 with GET in the allowed methods for an allowlisted origin', async () => {
    const res = await OPTIONS(
      makeRequest(
        { origin: 'https://captions.techskills.academy', productSlug: 'captions-basic-styles' },
        'OPTIONS',
      ),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://captions.techskills.academy');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('403s the preflight for a non-allowlisted origin', async () => {
    const res = await OPTIONS(
      makeRequest({ origin: 'https://evil.example.com', productSlug: 'captions-basic-styles' }, 'OPTIONS'),
    );
    expect(res.status).toBe(403);
  });
});
