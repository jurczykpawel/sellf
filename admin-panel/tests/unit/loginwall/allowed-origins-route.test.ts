import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth-server', () => ({
  requireAdminApiWithRequest: vi.fn(),
}));

const adminClient = {
  from: vi.fn(),
};

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminClient,
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

import { requireAdminApiWithRequest } from '@/lib/auth-server';
import { loadAllowedOriginsForProduct } from '@/lib/embed/checkout-embed';
import { GET } from '@/app/api/admin/embed/allowed-origins/route';

const PRODUCT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
const SELLER_ID = '33333333-3333-3333-3333-333333333333';

function makeRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/embed/allowed-origins${query}`);
}

function mockProductLookup(seller_id: string | null | undefined) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({ data: seller_id === undefined ? null : { seller_id }, error: null }),
  };
  adminClient.from.mockReturnValue(chain);
}

beforeEach(() => {
  vi.mocked(requireAdminApiWithRequest).mockReset();
  vi.mocked(loadAllowedOriginsForProduct).mockReset();
  adminClient.from.mockReset();
});

describe('GET /api/admin/embed/allowed-origins', () => {
  it('401s when the caller is not authenticated', async () => {
    vi.mocked(requireAdminApiWithRequest).mockRejectedValue(new Error('Unauthorized'));
    const res = await GET(makeRequest(`?productId=${PRODUCT_ID}`));
    expect(res.status).toBe(401);
  });

  it('403s when the caller is not an admin', async () => {
    vi.mocked(requireAdminApiWithRequest).mockRejectedValue(new Error('Forbidden'));
    const res = await GET(makeRequest(`?productId=${PRODUCT_ID}`));
    expect(res.status).toBe(403);
  });

  it('400s when productId is missing', async () => {
    vi.mocked(requireAdminApiWithRequest).mockResolvedValue({} as never);
    const res = await GET(makeRequest(''));
    expect(res.status).toBe(400);
  });

  it('400s when productId is not a UUID', async () => {
    vi.mocked(requireAdminApiWithRequest).mockResolvedValue({} as never);
    const res = await GET(makeRequest('?productId=nope'));
    expect(res.status).toBe(400);
  });

  it('404s when the product does not exist', async () => {
    vi.mocked(requireAdminApiWithRequest).mockResolvedValue({} as never);
    mockProductLookup(undefined);
    const res = await GET(makeRequest(`?productId=${PRODUCT_ID}`));
    expect(res.status).toBe(404);
  });

  it('returns the configured origins for the product seller', async () => {
    vi.mocked(requireAdminApiWithRequest).mockResolvedValue({} as never);
    mockProductLookup(SELLER_ID);
    vi.mocked(loadAllowedOriginsForProduct).mockResolvedValue(['https://customer.example']);
    const res = await GET(makeRequest(`?productId=${PRODUCT_ID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ origins: ['https://customer.example'] });
  });

  it('returns an empty array when no origins are configured', async () => {
    vi.mocked(requireAdminApiWithRequest).mockResolvedValue({} as never);
    mockProductLookup(SELLER_ID);
    vi.mocked(loadAllowedOriginsForProduct).mockResolvedValue([]);
    const res = await GET(makeRequest(`?productId=${PRODUCT_ID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ origins: [] });
  });
});
