import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUserMock = vi.fn();
const adminSingleMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: adminSingleMock,
        }),
      }),
    }),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
  createPlatformClient: vi.fn(() => ({ rpc: vi.fn(), from: vi.fn() })),
}));

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  checkRateLimitForIdentifier: vi.fn().mockResolvedValue(true),
  getRateLimitIdentifier: vi.fn(),
}));

import { authenticate } from '@/lib/api/middleware';

const SITE_URL = 'https://shop.example.com';

function makeRequest(options: {
  method: string;
  origin?: string | null;
  contentType?: string | null;
}): NextRequest {
  const headers = new Headers();
  if (options.origin) headers.set('origin', options.origin);
  if (options.contentType) {
    headers.set('content-type', options.contentType);
    headers.set('content-length', '2'); // non-zero so the guard treats it as a real body
  }
  return new NextRequest('http://localhost/api/v1/api-keys', {
    method: options.method,
    headers,
  });
}

describe('authenticate() — session-cookie mutations require same-origin JSON', () => {
  const originalSiteUrl = process.env.SITE_URL;

  beforeEach(() => {
    process.env.SITE_URL = SITE_URL;
    getUserMock.mockReset();
    adminSingleMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'admin@shop.example.com' } }, error: null });
    adminSingleMock.mockResolvedValue({ data: { id: 'admin-row-1' }, error: null });
  });

  afterEach(() => {
    process.env.SITE_URL = originalSiteUrl;
  });

  it('allows a same-origin JSON POST from an admin session', async () => {
    const req = makeRequest({ method: 'POST', origin: SITE_URL, contentType: 'application/json' });
    const auth = await authenticate(req);
    expect(auth.method).toBe('session');
  });

  it('rejects a POST from another origin sent as text/plain', async () => {
    const req = makeRequest({ method: 'POST', origin: 'https://other.shop.example.com', contentType: 'text/plain' });
    await expect(authenticate(req)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects a same-origin POST whose body is text/plain', async () => {
    const req = makeRequest({ method: 'POST', origin: SITE_URL, contentType: 'text/plain' });
    await expect(authenticate(req)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('still allows a plain GET regardless of origin', async () => {
    const req = makeRequest({ method: 'GET', origin: 'https://other.shop.example.com' });
    const auth = await authenticate(req);
    expect(auth.method).toBe('session');
  });
});
