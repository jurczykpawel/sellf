import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/embed/checkout-embed', async () => {
  const actual = await vi.importActual<typeof import('@/lib/embed/checkout-embed')>('@/lib/embed/checkout-embed');
  return { ...actual, loadAllowedOriginsForProduct: vi.fn() };
});
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import { checkRateLimit } from '@/lib/rate-limiting';
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

function post(opts: {
  token?: string;
  product?: string;
  queryProduct?: string;
  body?: Record<string, unknown>;
  origin?: string;
}): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.origin) headers['Origin'] = opts.origin;
  const url =
    opts.queryProduct !== undefined
      ? `https://sellf.example/api/loginwall/verify?product=${encodeURIComponent(opts.queryProduct)}`
      : 'https://sellf.example/api/loginwall/verify';
  const bodyPayload = opts.body !== undefined ? opts.body : { product: opts.product ?? SLUG };
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyPayload),
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
  vi.mocked(checkRateLimit).mockReset();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
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

  it('denies a product outside the token\'s requested set, even with live access', async () => {
    const other = signGateToken({ userId: USER_ID, authenticated: true, requested: ['other-kit'], owned: ['other-kit'], secret: SECRET }).token;
    const res = await POST(post({ token: other, product: SLUG, origin: CUSTOMER_ORIGIN }));
    expect(await res.json()).toEqual({ access: false });
  });

  it('429s when rate limited', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const res = await POST(post({ token: token({ authenticated: true, owned: [SLUG] }), origin: CUSTOMER_ORIGIN }));
    expect(res.status).toBe(429);
  });

  it('denies when the query product differs from the body product', async () => {
    const res = await POST(
      post({
        token: token({ authenticated: true, owned: [SLUG] }),
        origin: CUSTOMER_ORIGIN,
        queryProduct: 'other-kit',
        product: SLUG,
      }),
    );
    expect(await res.json()).toEqual({ access: false });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('grants access when only the query carries the product (no product in the body)', async () => {
    const res = await POST(
      post({
        token: token({ authenticated: true, owned: [SLUG] }),
        origin: CUSTOMER_ORIGIN,
        queryProduct: SLUG,
        body: {},
      }),
    );
    expect(await res.json()).toEqual({ access: true });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(CUSTOMER_ORIGIN);
  });

  it('still works with only the body product and no Origin header (server-to-server, unchanged)', async () => {
    const res = await POST(post({ token: token({ authenticated: true, owned: [SLUG] }), product: SLUG }));
    expect(await res.json()).toEqual({ access: true });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('OPTIONS /api/loginwall/verify', () => {
  function options(opts: { origin?: string; product?: string }): NextRequest {
    const url =
      opts.product !== undefined
        ? `https://sellf.example/api/loginwall/verify?product=${encodeURIComponent(opts.product)}`
        : 'https://sellf.example/api/loginwall/verify';
    const headers: Record<string, string> = { 'Access-Control-Request-Method': 'POST' };
    if (opts.origin) headers['Origin'] = opts.origin;
    return new NextRequest(url, { method: 'OPTIONS', headers });
  }

  it('answers preflight without a credentials header', async () => {
    const res = await OPTIONS(options({ origin: CUSTOMER_ORIGIN, product: SLUG }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('reflects an allowlisted origin for the product in the query', async () => {
    const res = await OPTIONS(options({ origin: CUSTOMER_ORIGIN, product: SLUG }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(CUSTOMER_ORIGIN);
  });

  it('does not reflect an origin outside the product\'s seller allowlist', async () => {
    const res = await OPTIONS(options({ origin: 'https://evil.example', product: SLUG }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not reflect when there is no product param', async () => {
    const res = await OPTIONS(options({ origin: CUSTOMER_ORIGIN }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not reflect when the product param fails the slug pattern', async () => {
    const res = await OPTIONS(options({ origin: CUSTOMER_ORIGIN, product: 'Bad_Slug' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not reflect when the product is unknown', async () => {
    vi.mocked(createClient).mockResolvedValueOnce({ from: () => chainReturning(null) } as never);
    const res = await OPTIONS(options({ origin: CUSTOMER_ORIGIN, product: SLUG }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not reflect a malformed Origin header even for an allowlisted product', async () => {
    const res = await OPTIONS(options({ origin: 'not-a-valid-origin', product: SLUG }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('429s when rate limited, without reflecting the origin', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const res = await OPTIONS(options({ origin: CUSTOMER_ORIGIN, product: SLUG }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
