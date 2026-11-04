import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  checkRateLimit: vi.fn(),
  checkRateLimitForIdentifier: vi.fn(),
  createCheckoutSession: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: mocks.checkRateLimit,
  checkRateLimitForIdentifier: mocks.checkRateLimitForIdentifier,
  getRateLimitIdentifier: vi.fn().mockResolvedValue('ip:203.0.113.9'),
}));

vi.mock('@/lib/services/checkout', () => ({
  CheckoutService: vi.fn().mockImplementation(function () {
    return {
      createCheckoutSession: mocks.createCheckoutSession,
    };
  }),
}));

import { POST } from '@/app/api/embed/checkout-session/route';
import { CheckoutError, CheckoutErrorType } from '@/types/checkout';

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
    rpc: vi.fn().mockResolvedValue({ error: null }),
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
  process.env.SITE_URL = 'https://sellf.example.com';
  delete process.env.SELLF_EMBED_ALLOWED_ORIGINS;
  delete process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE;
  delete process.env.CLOUDFLARE_TURNSTILE_SITE_KEY;
  delete process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY;
  delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  delete process.env.ALTCHA_HMAC_KEY;
  mocks.createAdminClient.mockReturnValue(makeDbMock());
  mocks.checkRateLimit.mockResolvedValue(true);
  mocks.checkRateLimitForIdentifier.mockResolvedValue(true);
  mocks.createCheckoutSession.mockResolvedValue({
    clientSecret: 'cs_test_secret',
    sessionId: 'cs_test_session',
  });
});

describe('POST /api/embed/checkout-session', () => {
  it.each(['pl', 'en', 'de', null, 42, {}, undefined])('passes the supported session locale for %j', async locale => {
    const response = await POST(makeRequest({ productSlug: 'kurs-ai', locale }, 'https://landing.example.com'));
    expect(response.status).toBe(200);
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      expect.any(Object), expect.any(String), undefined,
      { embedSessionId: expect.any(String), attributionRef: expect.any(String), locale: locale === 'pl' || locale === 'en' ? locale : 'auto' },
    );
  });

  it('answers 422 AMOUNT_BELOW_MINIMUM for a legacy price under the Stripe minimum, before captcha or Stripe (W146 B6)', async () => {
    mocks.createAdminClient.mockReturnValue(makeDbMock({ product: { ...product, price: 0.49, currency: 'USD' } }));
    const response = await POST(makeRequest({ productSlug: 'kurs-ai' }, 'https://landing.example.com'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'AMOUNT_BELOW_MINIMUM' });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://landing.example.com');
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('tells the loader when a coupon discount stopped at the minimum payment (W146 B6)', async () => {
    mocks.createCheckoutSession.mockResolvedValueOnce({ clientSecret: 'cs_test_secret', sessionId: 'cs_test_session', minimumApplied: true });
    mocks.createAdminClient.mockReturnValue(makeDbMock({ product: { ...product, price: 2, currency: 'PLN' } }));
    const response = await POST(makeRequest({ productSlug: 'kurs-ai', couponCode: 'W150P80' }, 'https://landing.example.com'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: 'paid', minimumApplied: true, minimumAmount: 2, product: { currency: 'PLN' } });
  });

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
      { embedSessionId: expect.any(String), attributionRef: expect.any(String), locale: 'auto' },
    );
  });

  it('hands the seller-page purchase source to the order snapshot under the Stripe session @J172', async () => {
    const db = makeDbMock();
    mocks.createAdminClient.mockReturnValue(db);
    const attribution = { v: 1, consent: 'none', mode: 'url', last: { source: 'listmonk', medium: 'email', campaign: 'mail-05' } };
    const response = await POST(makeRequest({ productSlug: 'kurs-ai', attribution }, 'https://landing.example.com'));
    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith('store_checkout_attribution', expect.objectContaining({
      p_ref: 'cs_test_session',
      p_payload: expect.objectContaining({ last: expect.objectContaining({ source: 'listmonk', campaign: 'mail-05' }) }),
    }));
  });

  describe('coupon codes', () => {
    const origin = 'https://landing.example.com';

    it.each(['SAVE20', ' save20 ', '\tsave20\r\n'])('passes the normalized coupon to checkout: %j', async couponCode => {
      const response = await POST(
        makeRequest({ productSlug: 'kurs-ai', couponCode }, origin),
      );

      expect(response.status).toBe(200);
      expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
        { productId: 'product-1', couponCode: 'SAVE20' },
        'https://sellf.example.com/p/kurs-ai/payment-status?session_id={CHECKOUT_SESSION_ID}',
        undefined,
        { embedSessionId: expect.any(String), attributionRef: expect.any(String), locale: 'auto' },
      );
    });

    // Same rule as /api/coupons/verify (W148-11): a valid code re-sent on every embed load
    // never spends the per-code budget; only rejected codes do.
    it('creates the session for a valid code even when the per-code budget is spent @J311', async () => {
      mocks.checkRateLimitForIdentifier.mockResolvedValue(false);

      const response = await POST(
        makeRequest({ productSlug: 'kurs-ai', couponCode: '\t save20 \n' }, origin),
      );

      expect(response.status).toBe(200);
      expect(mocks.createCheckoutSession).toHaveBeenCalled();
      expect(mocks.checkRateLimitForIdentifier).not.toHaveBeenCalled();
    });

    it('counts a rejected code per code and client and answers 429 once that budget is spent @J311', async () => {
      mocks.checkRateLimitForIdentifier.mockResolvedValue(false);
      mocks.createCheckoutSession.mockRejectedValue(
        new CheckoutError(CheckoutErrorType.VALIDATION_ERROR, 'Invalid code', 400, 'COUPON_REJECTED'),
      );

      const response = await POST(
        makeRequest({ productSlug: 'kurs-ai', couponCode: '\t save20 \n' }, origin),
      );

      expect(response.status).toBe(429);
      expect(mocks.checkRateLimitForIdentifier).toHaveBeenCalledWith(
        'coupon_verify_code',
        5,
        60,
        'code:SAVE20:ip:203.0.113.9',
      );
    });

    it('returns the rejection while the per-code budget lasts', async () => {
      mocks.createCheckoutSession.mockRejectedValue(
        new CheckoutError(CheckoutErrorType.VALIDATION_ERROR, 'Invalid code', 400, 'COUPON_REJECTED'),
      );

      const response = await POST(makeRequest({ productSlug: 'kurs-ai', couponCode: 'NOPE' }, origin));

      expect(response.status).toBe(400);
      expect(mocks.checkRateLimitForIdentifier).toHaveBeenCalledTimes(1);
    });

    it('does not apply the per-code throttle when no coupon is sent', async () => {
      await POST(makeRequest({ productSlug: 'kurs-ai' }, origin));

      expect(mocks.checkRateLimitForIdentifier).not.toHaveBeenCalled();
    });

    it('returns the validation error for an invalid coupon with CORS headers', async () => {
      mocks.createCheckoutSession.mockRejectedValue(
        new CheckoutError(CheckoutErrorType.VALIDATION_ERROR, 'Invalid coupon code', 400),
      );

      const response = await POST(
        makeRequest({ productSlug: 'kurs-ai', couponCode: 'NOPE' }, origin),
      );
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(payload).toEqual({ error: 'Invalid coupon code', type: CheckoutErrorType.VALIDATION_ERROR });
    });
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


describe('embed error response origins', () => {
  it.each(['https://landing.example.com', 'https://other.example.com'])('keeps validation errors readable only for the allowed origin: %s', async (origin) => {
    const response = await POST(makeRequest({ productSlug: 'kurs-ai', couponCode: 'W82 CODE' }, origin));
    expect(response.status).toBe(400);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin === 'https://landing.example.com' ? origin : null);
  });
  it('keeps malformed JSON readable using the product query', async () => {
    const response = await POST(new Request('http://localhost/api/embed/checkout-session?productSlug=kurs-ai', {
      method: 'POST', headers: { Origin: 'https://landing.example.com', 'Content-Type': 'application/json' }, body: '{',
    }));
    expect(response.status).toBe(400);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://landing.example.com');
  });
  it.each([404, 429])('includes CORS for a %s response', async (status) => {
    if (status === 404) mocks.createAdminClient.mockReturnValue(makeDbMock({ product: { ...product, is_active: false } }));
    else mocks.checkRateLimit.mockResolvedValue(false);
    const response = await POST(makeRequest({ productSlug: 'kurs-ai', email: 'buyer@example.com' }, 'https://landing.example.com'));
    expect(response.status).toBe(status);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://landing.example.com');
  });
});
