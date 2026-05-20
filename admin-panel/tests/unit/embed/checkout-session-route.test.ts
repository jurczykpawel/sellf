import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkRateLimit: vi.fn(),
  createCheckoutSession: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock('@/lib/services/checkout', () => ({
  CheckoutService: vi.fn().mockImplementation(function () {
    return {
      createCheckoutSession: mocks.createCheckoutSession,
    };
  }),
}));

import { POST } from '@/app/api/embed/checkout-session/route';

const product = {
  id: 'product-1',
  slug: 'kurs-ai',
  name: 'Kurs AI',
  price: 9900,
  currency: 'PLN',
  is_active: true,
  available_from: null,
  available_until: null,
  product_type: 'one_time',
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

  return new Request('http://localhost/api/embed/checkout-session', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_BASE_URL = 'https://sellf.example.com';
  delete process.env.SELLF_EMBED_ALLOWED_ORIGINS;
  delete process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE;
  delete process.env.CLOUDFLARE_TURNSTILE_SITE_KEY;
  delete process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY;
  delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  delete process.env.ALTCHA_HMAC_KEY;
  mocks.createAdminClient.mockReturnValue(makeDbMock());
  mocks.checkRateLimit.mockResolvedValue(true);
  mocks.createCheckoutSession.mockResolvedValue({
    clientSecret: 'cs_test_secret',
    sessionId: 'cs_test_session',
  });
});

describe('POST /api/embed/checkout-session', () => {
  it('requires an explicitly allowed request origin', async () => {
    const response = await POST(makeRequest({ productSlug: 'kurs-ai' }));

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('does not create a Stripe session for an unlisted origin', async () => {
    const response = await POST(
      makeRequest({ productSlug: 'kurs-ai' }, 'https://evil.example.com'),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('creates a session from product slug without trusting redirect fields from the embed body', async () => {
    const response = await POST(
      makeRequest({ productSlug: 'kurs-ai', email: 'buyer@example.com' }, 'https://landing.example.com'),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://landing.example.com');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(payload).toMatchObject({
      clientSecret: 'cs_test_secret',
      sessionId: 'cs_test_session',
    });
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      { productId: 'product-1', email: 'buyer@example.com' },
      'https://sellf.example.com/p/kurs-ai/payment-status?session_id={CHECKOUT_SESSION_ID}',
      undefined,
      { embedSessionId: expect.any(String) },
    );
  });

  it('returns env origins when DB seller_embed_settings is empty', async () => {
    process.env.SELLF_EMBED_ALLOWED_ORIGINS = 'https://env-landing.example.com';
    mocks.createAdminClient.mockReturnValue(makeDbMock({ allowedOrigins: [] }));

    const response = await POST(
      makeRequest({ productSlug: 'kurs-ai' }, 'https://env-landing.example.com'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://env-landing.example.com');
    expect(mocks.createCheckoutSession).toHaveBeenCalled();
  });

  it('uses DB origins before env origins', async () => {
    process.env.SELLF_EMBED_ALLOWED_ORIGINS = 'https://env-landing.example.com';
    mocks.createAdminClient.mockReturnValue(makeDbMock({ allowedOrigins: ['https://db-landing.example.com'] }));

    const dbOriginResponse = await POST(
      makeRequest({ productSlug: 'kurs-ai' }, 'https://db-landing.example.com'),
    );
    const envOriginResponse = await POST(
      makeRequest({ productSlug: 'kurs-ai' }, 'https://env-landing.example.com'),
    );

    expect(dbOriginResponse.status).toBe(200);
    expect(dbOriginResponse.headers.get('Access-Control-Allow-Origin')).toBe('https://db-landing.example.com');
    expect(envOriginResponse.status).toBe(403);
    expect(envOriginResponse.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('returns 403 when both DB and env origins are empty', async () => {
    mocks.createAdminClient.mockReturnValue(makeDbMock({ allowedOrigins: [] }));

    const response = await POST(
      makeRequest({ productSlug: 'kurs-ai' }, 'https://landing.example.com'),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects unsafe fields before creating a Stripe session', async () => {
    const response = await POST(
      makeRequest(
        { productSlug: 'kurs-ai', successUrl: 'https://evil.example.com/after-pay' },
        'https://landing.example.com',
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  // Dispatcher behavior: the same endpoint handles both paid and free products.
  // The SDK no longer reads data-sellf-mode — it discriminates on `kind`.
  describe('dispatcher response shape', () => {
    it('returns kind:"paid" with clientSecret for paid products', async () => {
      const response = await POST(
        makeRequest({ productSlug: 'kurs-ai' }, 'https://landing.example.com'),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.kind).toBe('paid');
      expect(payload.clientSecret).toBe('cs_test_secret');
      expect(payload.sessionId).toBe('cs_test_session');
    });

    it('returns kind:"free" without creating a Stripe session when price is 0', async () => {
      const freeProduct = { ...product, price: 0 };
      mocks.createAdminClient.mockReturnValue(makeDbMock({ product: freeProduct }));

      const response = await POST(
        makeRequest({ productSlug: 'kurs-ai' }, 'https://landing.example.com'),
      );
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.kind).toBe('free');
      expect(payload.product).toMatchObject({ slug: 'kurs-ai', name: 'Kurs AI', price: 0 });
      expect(payload).not.toHaveProperty('clientSecret');
      // Free flow does not hit Stripe — completion goes through /api/embed/free-access
      expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    });

    it('includes captcha config on free response so the SDK can render Turnstile', async () => {
      process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY = 'turnstile-test-key';
      process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = 'turnstile-secret';
      const freeProduct = { ...product, price: 0 };
      mocks.createAdminClient.mockReturnValue(makeDbMock({ product: freeProduct }));

      const response = await POST(
        makeRequest({ productSlug: 'kurs-ai' }, 'https://landing.example.com'),
      );
      const payload = await response.json();

      expect(payload.kind).toBe('free');
      expect(payload.captcha).toMatchObject({
        provider: 'turnstile',
        siteKey: 'turnstile-test-key',
      });
      expect(payload.captcha.scriptUrl).toContain('challenges.cloudflare.com');
      expect(payload).not.toHaveProperty('captchaSiteKey');
    });

    it('includes ALTCHA captcha config on free response when only ALTCHA is configured', async () => {
      process.env.ALTCHA_HMAC_KEY = 'hmac-key';
      const freeProduct = { ...product, price: 0 };
      mocks.createAdminClient.mockReturnValue(makeDbMock({ product: freeProduct }));

      const response = await POST(
        makeRequest({ productSlug: 'kurs-ai' }, 'https://landing.example.com'),
      );
      const payload = await response.json();

      expect(payload.kind).toBe('free');
      expect(payload.captcha).toMatchObject({
        provider: 'altcha',
        siteKey: null,
        widgetTag: 'altcha-widget',
        challengeUrl: '/api/captcha/challenge',
      });
      expect(payload.captcha.scriptUrl).toContain('altcha');
    });
  });
});
