import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limiting', () => ({ checkRateLimitForIdentifier: vi.fn() }));

import { checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { GET } from '@/app/api/loginwall/gate.js/route';

const SITE_URL = 'http://localhost:3000';

function makeRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  vi.mocked(checkRateLimitForIdentifier).mockReset();
  vi.mocked(checkRateLimitForIdentifier).mockResolvedValue(true);
  process.env.NEXT_PUBLIC_SITE_URL = SITE_URL;
});

describe('GET /api/loginwall/gate.js', () => {
  it('400s when products is missing', async () => {
    expect((await GET(makeRequest(`${SITE_URL}/api/loginwall/gate.js`))).status).toBe(400);
  });

  it('400s when a slug is invalid', async () => {
    expect((await GET(makeRequest(`${SITE_URL}/api/loginwall/gate.js?products=Bad_Slug`))).status).toBe(400);
  });

  it('returns 200 application/javascript with the runtime body', async () => {
    const res = await GET(makeRequest(`${SITE_URL}/api/loginwall/gate.js?products=pro-kit,addon`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/javascript/);
    const body = await res.text();
    expect(body).toContain('SellfGate');
    expect(body).toContain(SITE_URL);
  });

  it('sets a public cache header', async () => {
    const res = await GET(makeRequest(`${SITE_URL}/api/loginwall/gate.js?products=pro-kit`));
    expect(res.headers.get('cache-control') ?? '').toMatch(/public/);
  });

  it('429s when rate limited', async () => {
    vi.mocked(checkRateLimitForIdentifier).mockResolvedValueOnce(false);
    const res = await GET(makeRequest(`${SITE_URL}/api/loginwall/gate.js?products=pro-kit`, { 'x-forwarded-for': '203.0.113.5' }));
    expect(res.status).toBe(429);
  });
});
