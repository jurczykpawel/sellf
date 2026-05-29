import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/embed/checkout-embed', async () => {
  const actual = await vi.importActual<typeof import('@/lib/embed/checkout-embed')>('@/lib/embed/checkout-embed');
  return { ...actual, loadAllowedOriginsForProduct: vi.fn() };
});
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimitForIdentifier: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import { checkRateLimitForIdentifier } from '@/lib/rate-limiting';
import { signGateToken } from '@/lib/loginwall/token';
import { POST, OPTIONS } from '@/app/api/loginwall/verify/route';

const SELLER_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SECRET = 'a'.repeat(64);
const CUSTOMER_ORIGIN = 'https://customer.example';
const SLUG = 'pro-kit';

type AccessRow = { access_expires_at: string | null } | null;

// Live access state for user_product_access lookups (the source of truth).
let liveAccess: AccessRow = { access_expires_at: null };

function chainReturning(data: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data, error: null }),
  };
  return chain;
}

// createClient → products lookup (slug → id/seller_id)
function serverClient() {
  return { from: () => chainReturning({ id: 'p1', slug: SLUG, seller_id: SELLER_ID }) };
}
// createAdminClient → user_product_access lookup (live ownership)
function adminClient() {
  return { from: () => chainReturning(liveAccess) };
}

function token(opts: { authenticated: boolean; owned: string[] }): string {
  return signGateToken({ userId: USER_ID, authenticated: opts.authenticated, requested: [SLUG], owned: opts.owned, secret: SECRET }).token;
}

function post(opts: { token?: string; product?: string; origin?: string }): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.origin) headers['Origin'] = opts.origin;
  return new NextRequest('https://sellf.example/api/loginwall/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify({ product: opts.product ?? SLUG }),
  });
}

beforeEach(() => {
  liveAccess = { access_expires_at: null }; // default: user currently owns the product
  vi.mocked(createClient).mockReset();
  vi.mocked(createClient).mockResolvedValue(serverClient() as never);
  vi.mocked(createAdminClient).mockReset();
  vi.mocked(createAdminClient).mockReturnValue(adminClient() as never);
  vi.mocked(loadAllowedOriginsForProduct).mockReset();
  vi.mocked(loadAllowedOriginsForProduct).mockResolvedValue([CUSTOMER_ORIGIN]);
  vi.mocked(checkRateLimitForIdentifier).mockReset();
  vi.mocked(checkRateLimitForIdentifier).mockResolvedValue(true);
  process.env.LOGINWALL_SECRET = SECRET;
});

describe('POST /api/loginwall/verify', () => {
  it('grants access for an authenticated user with live access; reflects allowlisted Origin without credentials', async () => {
    const res = await POST(post({ token: token({ authenticated: true, owned: [SLUG] }), origin: CUSTOMER_ORIGIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access: true });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(CUSTOMER_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('denies when there is no live access row, even if the token claims ownership', async () => {
    liveAccess = null; // access was revoked / never granted in the DB
    const res = await POST(post({ token: token({ authenticated: true, owned: [SLUG] }), origin: CUSTOMER_ORIGIN }));
    expect(await res.json()).toEqual({ access: false });
  });

  it('denies when live access has expired, even if the token claims ownership', async () => {
    liveAccess = { access_expires_at: new Date(Date.now() - 60_000).toISOString() };
    const res = await POST(post({ token: token({ authenticated: true, owned: [SLUG] }), origin: CUSTOMER_ORIGIN }));
    expect(await res.json()).toEqual({ access: false });
  });

  it('grants when live access has a future expiry', async () => {
    liveAccess = { access_expires_at: new Date(Date.now() + 60_000).toISOString() };
    const res = await POST(post({ token: token({ authenticated: true, owned: [SLUG] }), origin: CUSTOMER_ORIGIN }));
    expect(await res.json()).toEqual({ access: true });
  });

  it('denies an unauthenticated token regardless of live access', async () => {
    const res = await POST(post({ token: token({ authenticated: false, owned: [] }), origin: CUSTOMER_ORIGIN }));
    expect(await res.json()).toEqual({ access: false });
  });

  it('denies a missing or malformed bearer token', async () => {
    expect(await (await POST(post({ origin: CUSTOMER_ORIGIN }))).json()).toEqual({ access: false });
    expect(await (await POST(post({ token: 'garbage', origin: CUSTOMER_ORIGIN }))).json()).toEqual({ access: false });
  });

  it('denies an expired token', async () => {
    const expired = signGateToken({ userId: USER_ID, authenticated: true, requested: [SLUG], owned: [SLUG], secret: SECRET, ttlSeconds: -1 }).token;
    expect(await (await POST(post({ token: expired, origin: CUSTOMER_ORIGIN }))).json()).toEqual({ access: false });
  });

  it('does NOT reflect a non-allowlisted Origin', async () => {
    const res = await POST(post({ token: token({ authenticated: true, owned: [SLUG] }), origin: 'https://not-allowed.example.com' }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('429s when rate limited', async () => {
    vi.mocked(checkRateLimitForIdentifier).mockResolvedValue(false);
    const res = await POST(post({ token: token({ authenticated: true, owned: [SLUG] }), origin: CUSTOMER_ORIGIN }));
    expect(res.status).toBe(429);
  });
});

describe('OPTIONS /api/loginwall/verify', () => {
  it('answers preflight without a credentials header', async () => {
    const req = new NextRequest('https://sellf.example/api/loginwall/verify', {
      method: 'OPTIONS',
      headers: { Origin: CUSTOMER_ORIGIN, 'Access-Control-Request-Method': 'POST' },
    });
    const res = await OPTIONS(req);
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
});
