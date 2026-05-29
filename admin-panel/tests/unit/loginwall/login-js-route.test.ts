import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: vi.fn(),
}));

import { checkRateLimit } from '@/lib/rate-limiting';
import { GET } from '@/app/api/loginwall/login.js/route';

const PRODUCT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
const SITE_URL = 'http://localhost:3000';

function makeRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockReset();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  process.env.NEXT_PUBLIC_SITE_URL = SITE_URL;
});

describe('GET /api/loginwall/login.js', () => {
  it('400s when the id is missing', async () => {
    const res = await GET(makeRequest(`${SITE_URL}/api/loginwall/login.js`));
    expect(res.status).toBe(400);
  });

  it('400s when the id is not a UUID', async () => {
    const res = await GET(makeRequest(`${SITE_URL}/api/loginwall/login.js?id=not-a-uuid`));
    expect(res.status).toBe(400);
  });

  it('returns 200 application/javascript for a valid id', async () => {
    const res = await GET(makeRequest(`${SITE_URL}/api/loginwall/login.js?id=${PRODUCT_ID}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/javascript/);
    const body = await res.text();
    expect(body).toContain(PRODUCT_ID);
    expect(body).toContain(SITE_URL);
  });

  it('sets a public cache header (script body is per-product, no secrets)', async () => {
    const res = await GET(makeRequest(`${SITE_URL}/api/loginwall/login.js?id=${PRODUCT_ID}`));
    expect(res.headers.get('cache-control') ?? '').toMatch(/public/);
  });

  it('429s when the per-ip rate limit denies', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    const res = await GET(makeRequest(`${SITE_URL}/api/loginwall/login.js?id=${PRODUCT_ID}`, {
      'x-forwarded-for': '203.0.113.5',
    }));
    expect(res.status).toBe(429);
  });
});
