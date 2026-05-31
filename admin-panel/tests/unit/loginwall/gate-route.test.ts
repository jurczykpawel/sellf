import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock('@/lib/embed/checkout-embed', async () => {
  const actual = await vi.importActual<typeof import('@/lib/embed/checkout-embed')>('@/lib/embed/checkout-embed');
  return { ...actual, loadAllowedOriginsForProduct: vi.fn() };
});
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import { checkRateLimit } from '@/lib/rate-limiting';
import { verifyGateToken } from '@/lib/loginwall/token';
import { GET } from '@/app/[locale]/loginwall/gate/route';

const SELLER_ID = '33333333-3333-3333-3333-333333333333';
const SELLER_B = '44444444-4444-4444-4444-444444444444';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SECRET = 'a'.repeat(64);
const SITE_URL = 'http://localhost:3000';
const CUSTOMER_PAGE = 'https://customer.example/page';
const CUSTOMER_ORIGIN = 'https://customer.example';

interface Product { id: string; slug: string; is_active: boolean; seller_id: string | null }
interface AccessRow { product_id: string; access_expires_at: string | null }

function makeSupabaseMock(opts: {
  user: { id: string } | null;
  products?: Product[];
  access?: AccessRow[];
}) {
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user }, error: null }) };
  const from = vi.fn().mockImplementation((table: string) => {
    const data = table === 'products' ? (opts.products ?? []) : table === 'user_product_access' ? (opts.access ?? []) : [];
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => Promise.resolve({ data, error: null }),
    };
    return chain;
  });
  return { auth, from };
}

function req(query: string): NextRequest {
  return new NextRequest(`${SITE_URL}/loginwall/gate?${query}`);
}

function q(products: string, redirect = CUSTOMER_PAGE): string {
  return `products=${products}&redirect=${encodeURIComponent(redirect)}`;
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(loadAllowedOriginsForProduct).mockReset();
  vi.mocked(loadAllowedOriginsForProduct).mockResolvedValue([CUSTOMER_ORIGIN]);
  vi.mocked(checkRateLimit).mockReset();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  process.env.NEXT_PUBLIC_SITE_URL = SITE_URL;
  process.env.LOGINWALL_SECRET = SECRET;
});

function tokenFrom(res: Response): ReturnType<typeof verifyGateToken> {
  const loc = res.headers.get('location') ?? '';
  const m = loc.match(/#(?:.*&)?_sf_token=([^&]+)$/);
  return verifyGateToken(m ? m[1] : '', { secret: SECRET });
}

describe('GET /loginwall/gate', () => {
  it('400s on missing products', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ user: { id: USER_ID } }) as never);
    expect((await GET(req(`redirect=${encodeURIComponent(CUSTOMER_PAGE)}`))).status).toBe(400);
  });

  it('400s on an invalid slug', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ user: { id: USER_ID } }) as never);
    expect((await GET(req(q('Bad_Slug')))).status).toBe(400);
  });

  it('400s on more than 20 products', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ user: { id: USER_ID } }) as never);
    const many = Array.from({ length: 21 }, (_, i) => `s${i}`).join(',');
    expect((await GET(req(q(many)))).status).toBe(400);
  });

  it('400s when a requested slug does not exist', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      products: [{ id: 'p1', slug: 'a', is_active: true, seller_id: SELLER_ID }],
    }) as never);
    expect((await GET(req(q('a,b')))).status).toBe(400);
  });

  it('400s when products span multiple sellers', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      products: [
        { id: 'p1', slug: 'a', is_active: true, seller_id: SELLER_ID },
        { id: 'p2', slug: 'b', is_active: true, seller_id: SELLER_B },
      ],
    }) as never);
    expect((await GET(req(q('a,b')))).status).toBe(400);
  });

  it('400s when redirect origin is not in the seller allowlist', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      products: [{ id: 'p1', slug: 'a', is_active: true, seller_id: SELLER_ID }],
    }) as never);
    const res = await GET(req(q('a', 'https://not-allowed.example.com/x')));
    expect(res.status).toBe(400);
  });

  it('does NOT bounce an unauthenticated visitor — returns a token with auth:false', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: null,
      products: [{ id: 'p1', slug: 'a', is_active: true, seller_id: SELLER_ID }],
    }) as never);
    const res = await GET(req(q('a')));
    expect(res.status).toBe(307);
    const loc = res.headers.get('location') ?? '';
    expect(loc.startsWith(CUSTOMER_PAGE)).toBe(true);
    expect(loc).not.toContain('/login');
    const v = tokenFrom(res);
    expect(v).toMatchObject({ valid: true, auth: false, owned: [] });
  });

  it('returns owned subset for an authenticated partial owner', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      products: [
        { id: 'p1', slug: 'a', is_active: true, seller_id: SELLER_ID },
        { id: 'p2', slug: 'b', is_active: true, seller_id: SELLER_ID },
      ],
      access: [{ product_id: 'p1', access_expires_at: null }],
    }) as never);
    const res = await GET(req(q('a,b')));
    expect(res.status).toBe(307);
    const v = tokenFrom(res);
    expect(v).toMatchObject({ valid: true, auth: true });
    if (v.valid) {
      expect(v.owned).toEqual(['a']);
      expect(v.req.sort()).toEqual(['a', 'b']);
    }
  });

  it('excludes expired access from owned', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      products: [{ id: 'p1', slug: 'a', is_active: true, seller_id: SELLER_ID }],
      access: [{ product_id: 'p1', access_expires_at: new Date(Date.now() - 60_000).toISOString() }],
    }) as never);
    const v = tokenFrom(await GET(req(q('a'))));
    if (v.valid) expect(v.owned).toEqual([]);
    else throw new Error('expected valid token');
  });

  it('puts the token in the fragment, never the query string', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      products: [{ id: 'p1', slug: 'a', is_active: true, seller_id: SELLER_ID }],
      access: [{ product_id: 'p1', access_expires_at: null }],
    }) as never);
    const loc = (await GET(req(q('a')))).headers.get('location') ?? '';
    expect(loc).toMatch(/#_sf_token=/);
    expect(loc).not.toMatch(/[?&]_sf_token=/);
  });

  it('429s when the per-ip rate limit denies', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ user: { id: USER_ID } }) as never);
    expect((await GET(req(q('a')))).status).toBe(429);
  });

  it('500s when LOGINWALL_SECRET is missing', async () => {
    delete process.env.LOGINWALL_SECRET;
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      products: [{ id: 'p1', slug: 'a', is_active: true, seller_id: SELLER_ID }],
      access: [{ product_id: 'p1', access_expires_at: null }],
    }) as never);
    expect((await GET(req(q('a')))).status).toBe(500);
  });
});
