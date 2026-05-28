import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}));
vi.mock('@/lib/loginwall/store', () => ({
  storeLoginwallNonce: vi.fn(),
}));
vi.mock('@/lib/embed/checkout-embed', async () => {
  const actual = await vi.importActual<typeof import('@/lib/embed/checkout-embed')>(
    '@/lib/embed/checkout-embed',
  );
  return {
    ...actual,
    loadAllowedOriginsForProduct: vi.fn(),
  };
});

import { createClient } from '@/lib/supabase/server';
import { storeLoginwallNonce } from '@/lib/loginwall/store';
import { loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import { GET } from '@/app/[locale]/loginwall/protect/route';

const PRODUCT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
const SELLER_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SITE_URL = 'http://localhost:3000';
const CUSTOMER_PAGE = 'https://customer.example/page';
const CUSTOMER_ORIGIN = 'https://customer.example';

interface MockChain {
  select: () => MockChain;
  eq: () => MockChain;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
}

function makeSupabaseMock(opts: {
  user: { id: string } | null;
  product?: { id: string; slug: string; is_active: boolean; seller_id: string | null } | null;
  access?: { access_expires_at: string | null } | null;
}) {
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user }, error: null }) };
  const from = vi.fn().mockImplementation((table: string) => {
    const result =
      table === 'products' ? opts.product :
      table === 'user_product_access' ? opts.access :
      null;
    const chain: MockChain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: result ?? null, error: null }),
    };
    return chain;
  });
  return { auth, from };
}

function makeRequest(path: string): NextRequest {
  return new NextRequest(`${SITE_URL}${path}`);
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.mocked(storeLoginwallNonce).mockReset();
  vi.mocked(storeLoginwallNonce).mockResolvedValue();
  vi.mocked(loadAllowedOriginsForProduct).mockReset();
  vi.mocked(loadAllowedOriginsForProduct).mockResolvedValue([CUSTOMER_ORIGIN]);
  process.env.NEXT_PUBLIC_SITE_URL = SITE_URL;
  process.env.LOGINWALL_SECRET = 'a'.repeat(64);
});

describe('GET /loginwall/protect', () => {
  it('400s when id is missing', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ user: { id: USER_ID } }) as never);
    const res = await GET(makeRequest('/loginwall/protect?redirect=' + encodeURIComponent(CUSTOMER_PAGE)));
    expect(res.status).toBe(400);
  });

  it('400s when id is not a UUID', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ user: { id: USER_ID } }) as never);
    const res = await GET(makeRequest('/loginwall/protect?id=nope&redirect=' + encodeURIComponent(CUSTOMER_PAGE)));
    expect(res.status).toBe(400);
  });

  it('400s when redirect is missing', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ user: { id: USER_ID } }) as never);
    const res = await GET(makeRequest(`/loginwall/protect?id=${PRODUCT_ID}`));
    expect(res.status).toBe(400);
  });

  it('400s when redirect is not http(s)', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ user: { id: USER_ID } }) as never);
    const res = await GET(makeRequest(`/loginwall/protect?id=${PRODUCT_ID}&redirect=` + encodeURIComponent('javascript:alert(1)')));
    expect(res.status).toBe(400);
  });

  it('400s when redirect points at an internal/private host', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ user: { id: USER_ID } }) as never);
    const res = await GET(makeRequest(`/loginwall/protect?id=${PRODUCT_ID}&redirect=` + encodeURIComponent('http://169.254.169.254/meta')));
    expect(res.status).toBe(400);
  });

  it('400s when redirect origin is not in the seller allowlist', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      product: { id: PRODUCT_ID, slug: 'demo-product', is_active: true, seller_id: SELLER_ID },
      access: { access_expires_at: null },
    }) as never);
    vi.mocked(loadAllowedOriginsForProduct).mockResolvedValue([CUSTOMER_ORIGIN]);
    const disallowedUrl = 'https://not-allowed.example.com/blocked';
    const res = await GET(makeRequest(`/loginwall/protect?id=${PRODUCT_ID}&redirect=` + encodeURIComponent(disallowedUrl)));
    expect(res.status).toBe(400);
    expect(vi.mocked(storeLoginwallNonce)).not.toHaveBeenCalled();
  });

  it('redirects to /login when there is no session', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({ user: null }) as never);
    const res = await GET(makeRequest(`/loginwall/protect?id=${PRODUCT_ID}&redirect=` + encodeURIComponent(CUSTOMER_PAGE)));
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('redirect_to=');
    expect(location).toContain(encodeURIComponent('/loginwall/protect'));
  });

  it('404s when the product does not exist', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      product: null,
    }) as never);
    const res = await GET(makeRequest(`/loginwall/protect?id=${PRODUCT_ID}&redirect=` + encodeURIComponent(CUSTOMER_PAGE)));
    expect(res.status).toBe(404);
  });

  it('redirects to /p/{slug} when the user has no access', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      product: { id: PRODUCT_ID, slug: 'demo-product', is_active: true, seller_id: SELLER_ID },
      access: null,
    }) as never);
    const res = await GET(makeRequest(`/loginwall/protect?id=${PRODUCT_ID}&redirect=` + encodeURIComponent(CUSTOMER_PAGE)));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/p/demo-product');
  });

  it('redirects back to the customer page with the token in the URL fragment when access is granted', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      product: { id: PRODUCT_ID, slug: 'demo-product', is_active: true, seller_id: SELLER_ID },
      access: { access_expires_at: null },
    }) as never);
    const res = await GET(makeRequest(`/loginwall/protect?id=${PRODUCT_ID}&redirect=` + encodeURIComponent(CUSTOMER_PAGE)));
    expect(res.status).toBe(307);
    const target = res.headers.get('location') ?? '';
    expect(target.startsWith(CUSTOMER_PAGE)).toBe(true);
    expect(target).toMatch(/#_sf_token=[A-Za-z0-9_.-]+$/);
    expect(target).not.toMatch(/[?&]_sf_token=/);
    expect(vi.mocked(storeLoginwallNonce)).toHaveBeenCalledOnce();
  });

  it('preserves any existing fragment on the customer URL when appending the token', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      product: { id: PRODUCT_ID, slug: 'demo-product', is_active: true, seller_id: SELLER_ID },
      access: { access_expires_at: null },
    }) as never);
    const pageWithHash = `${CUSTOMER_PAGE}#section-2`;
    const res = await GET(makeRequest(`/loginwall/protect?id=${PRODUCT_ID}&redirect=` + encodeURIComponent(pageWithHash)));
    expect(res.status).toBe(307);
    const target = res.headers.get('location') ?? '';
    expect(target).toContain('#section-2&_sf_token=');
  });

it('redirects to /p/{slug} when the access has expired', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      product: { id: PRODUCT_ID, slug: 'demo-product', is_active: true, seller_id: SELLER_ID },
      access: { access_expires_at: new Date(Date.now() - 60_000).toISOString() },
    }) as never);
    const res = await GET(makeRequest(`/loginwall/protect?id=${PRODUCT_ID}&redirect=` + encodeURIComponent(CUSTOMER_PAGE)));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/p/demo-product');
  });

  it('500s when LOGINWALL_SECRET is missing', async () => {
    delete process.env.LOGINWALL_SECRET;
    vi.mocked(createClient).mockResolvedValue(makeSupabaseMock({
      user: { id: USER_ID },
      product: { id: PRODUCT_ID, slug: 'demo-product', is_active: true, seller_id: SELLER_ID },
      access: { access_expires_at: null },
    }) as never);
    const res = await GET(makeRequest(`/loginwall/protect?id=${PRODUCT_ID}&redirect=` + encodeURIComponent(CUSTOMER_PAGE)));
    expect(res.status).toBe(500);
  });
});
