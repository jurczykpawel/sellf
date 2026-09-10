import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkRateLimit: vi.fn(),
  requestMagicLink: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock('@/lib/auth/magic-link/request', () => ({
  requestMagicLink: mocks.requestMagicLink,
}));

import { POST } from '@/app/api/embed/free-access/route';

const product = {
  id: 'product-free',
  slug: 'free-guide',
  name: 'Free Guide',
  price: 0,
  is_active: true,
  available_from: null,
  available_until: null,
  embed_enabled: true,
  seller_id: 'seller-1',
};

function makeDbMock(overrides: {
  allowedOrigins?: string[];
  product?: typeof product | null;
} = {}) {
  const allowedOrigins = overrides.allowedOrigins ?? ['https://landing.example.com'];
  const selectedProduct = overrides.product === undefined ? product : overrides.product;

  return {
    from: vi.fn((table: string) => {
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

      if (table === 'products') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: selectedProduct,
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === 'embed_checkout_log') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function makeRequest(body: unknown, origin?: string): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (origin) headers.set('Origin', origin);

  return new Request('http://localhost/api/embed/free-access', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_BASE_URL = 'https://sellf.example.com';
  delete process.env.SELLF_EMBED_ALLOWED_ORIGINS;
  mocks.createAdminClient.mockReturnValue(makeDbMock());
  mocks.checkRateLimit.mockResolvedValue(true);
  mocks.requestMagicLink.mockResolvedValue({ ok: true });
});

describe('POST /api/embed/free-access', () => {
  it('requires an explicitly allowed request origin', async () => {
    const response = await POST(makeRequest({ productSlug: 'free-guide', email: 'lead@example.com' }));

    expect(response.status).toBe(403);
    expect(mocks.requestMagicLink).not.toHaveBeenCalled();
  });

  it('sends via the shared magic-link gateway, not the delivery primitive directly', async () => {
    const response = await POST(
      makeRequest(
        { productSlug: 'free-guide', email: 'lead@example.com', turnstileToken: 'tok-abc' },
        'https://landing.example.com',
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://landing.example.com');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(payload.success).toBe(true);
    expect(mocks.requestMagicLink).toHaveBeenCalledWith({
      flow: 'free_product',
      productSlug: 'free-guide',
      email: 'lead@example.com',
      captchaToken: 'tok-abc',
    });
  });

  it('returns env origins when DB seller_embed_settings is empty', async () => {
    process.env.SELLF_EMBED_ALLOWED_ORIGINS = 'https://env-landing.example.com';
    mocks.createAdminClient.mockReturnValue(makeDbMock({ allowedOrigins: [] }));

    const response = await POST(
      makeRequest({ productSlug: 'free-guide', email: 'lead@example.com' }, 'https://env-landing.example.com'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://env-landing.example.com');
    expect(mocks.requestMagicLink).toHaveBeenCalled();
  });

  it('uses DB origins before env origins', async () => {
    process.env.SELLF_EMBED_ALLOWED_ORIGINS = 'https://env-landing.example.com';
    mocks.createAdminClient.mockReturnValue(makeDbMock({ allowedOrigins: ['https://db-landing.example.com'] }));

    const dbOriginResponse = await POST(
      makeRequest({ productSlug: 'free-guide', email: 'lead@example.com' }, 'https://db-landing.example.com'),
    );
    const envOriginResponse = await POST(
      makeRequest({ productSlug: 'free-guide', email: 'lead@example.com' }, 'https://env-landing.example.com'),
    );

    expect(dbOriginResponse.status).toBe(200);
    expect(dbOriginResponse.headers.get('Access-Control-Allow-Origin')).toBe('https://db-landing.example.com');
    expect(envOriginResponse.status).toBe(403);
    expect(envOriginResponse.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('returns 403 when both DB and env origins are empty', async () => {
    mocks.createAdminClient.mockReturnValue(makeDbMock({ allowedOrigins: [] }));

    const response = await POST(
      makeRequest({ productSlug: 'free-guide', email: 'lead@example.com' }, 'https://landing.example.com'),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(mocks.requestMagicLink).not.toHaveBeenCalled();
  });

  it('rejects paid products on the free access route', async () => {
    mocks.createAdminClient.mockReturnValue(
      makeDbMock({ product: { ...product, price: 9900 } }),
    );

    const response = await POST(
      makeRequest({ productSlug: 'free-guide', email: 'lead@example.com' }, 'https://landing.example.com'),
    );

    expect(response.status).toBe(404);
    expect(mocks.requestMagicLink).not.toHaveBeenCalled();
  });

  it('silently accepts honeypot submissions without sending a magic link', async () => {
    const response = await POST(
      makeRequest(
        { productSlug: 'free-guide', email: 'lead@example.com', website: 'https://spam.example' },
        'https://landing.example.com',
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mocks.requestMagicLink).not.toHaveBeenCalled();
  });

  it('maps a captcha_failed gateway result to 400', async () => {
    mocks.requestMagicLink.mockResolvedValue({ ok: false, code: 'captcha_failed' });

    const response = await POST(
      makeRequest({ productSlug: 'free-guide', email: 'lead@example.com' }, 'https://landing.example.com'),
    );

    expect(response.status).toBe(400);
  });

  it('maps an invalid_email gateway result to 400', async () => {
    mocks.requestMagicLink.mockResolvedValue({ ok: false, code: 'invalid_email' });

    const response = await POST(
      makeRequest({ productSlug: 'free-guide', email: 'lead@example.com' }, 'https://landing.example.com'),
    );

    expect(response.status).toBe(400);
  });

  it('maps a rate-limited gateway result to 429', async () => {
    mocks.requestMagicLink.mockResolvedValue({ ok: false, code: 'rate_limited' });

    const response = await POST(
      makeRequest({ productSlug: 'free-guide', email: 'lead@example.com' }, 'https://landing.example.com'),
    );

    expect(response.status).toBe(429);
  });

  it('maps a delivery failure to 500', async () => {
    mocks.requestMagicLink.mockResolvedValue({ ok: false, code: 'send_failed' });

    const response = await POST(
      makeRequest({ productSlug: 'free-guide', email: 'lead@example.com' }, 'https://landing.example.com'),
    );

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Failed to send access link');
  });
});
