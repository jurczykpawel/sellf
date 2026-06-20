/**
 * Security hardening probes for POST /api/embed/checkout-session
 *
 * These tests retarget the input-hardening cases that were previously
 * exercised against the retired /api/create-embedded-checkout route
 * (removed in commit 92dc72d3). Each probe is sent with an ALLOWLISTED
 * origin so the request gets past the CORS gate and actually exercises
 * body-level validation and hardening logic.
 *
 * @see tests/unit/embed/checkout-session-route.test.ts — pattern file
 * @see src/app/api/embed/checkout-session/route.ts — production route
 * @see src/lib/embed/checkout-embed.ts — parseEmbedCheckoutBody, PAID_CHECKOUT_KEYS
 */

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

// ===== SHARED FIXTURES =====

const ALLOWED_ORIGIN = 'https://landing.example.com';

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

function makeDbMock(opts: { product?: typeof product | null } = {}) {
  const selectedProduct = opts.product === undefined ? product : opts.product;

  return {
    from: vi.fn((table: string) => {
      if (table === 'seller_embed_settings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { allowed_embed_origins: [ALLOWED_ORIGIN] },
                error: null,
              }),
            }),
            limit: vi.fn().mockResolvedValue({
              data: [{ allowed_embed_origins: [ALLOWED_ORIGIN] }],
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
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

/** Build a request with the allowed origin so the CORS gate passes. */
function makeRequest(body: unknown, origin = ALLOWED_ORIGIN): Request {
  return new Request('http://localhost/api/embed/checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_BASE_URL = 'https://sellf.example.com';
  // Use captcha test-mode so paid products do NOT require a turnstile token
  process.env.NEXT_PUBLIC_TURNSTILE_TEST_MODE = 'true';
  delete process.env.SELLF_EMBED_ALLOWED_ORIGINS;
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

// ===== CAT 6: Array injection =====

describe('Cat 6: Input Validation — array injection', () => {
  it('rejects productSlug supplied as an array', async () => {
    // Old probe: { productId: ['id1', 'id2'] } on the dead route
    // Retargeted: productSlug as array on the live embed route.
    // parseEmbedCheckoutBody must reject non-string productSlug.
    const response = await POST(makeRequest({ productSlug: ['kurs-ai', 'other'] }));

    expect(response.status).toBe(400);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });
});

// ===== CAT 14: CSRF / Content-Type =====

describe('Cat 14: CSRF & Content-Type', () => {
  it('text/plain POST to embed checkout route does not bypass CORS protection', async () => {
    // Old probe targeted dead route with Content-Type: text/plain expecting 415/400.
    //
    // The embed route's CSRF protection is the Origin allowlist, NOT Content-Type
    // enforcement. A text/plain body from an un-allowlisted origin is still blocked
    // by the CORS gate (403); from an allowlisted origin, the route processes it
    // because request.json() succeeds regardless of Content-Type.
    //
    // Key security invariant: a text/plain request from a NON-allowlisted origin
    // must be blocked the same way as any other origin-blocked request.
    const reqFromEvilOrigin = new Request('http://localhost/api/embed/checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Origin: 'https://evil.example.com',
      },
      body: '{"productSlug":"kurs-ai"}',
    });
    const res = await POST(reqFromEvilOrigin);

    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });
});

// ===== CAT 22: Prototype Pollution =====

describe('Cat 22: Prototype Pollution', () => {
  it('__proto__ in embed checkout body has no effect and does not crash the server', async () => {
    // Old probe: { productId: 'test', __proto__: { isAdmin: true }, constructor: ... }
    // Retargeted to embed route: extra keys should cause 400 (unknown key rejection).
    const response = await POST(
      makeRequest({
        productSlug: 'kurs-ai',
        __proto__: { isAdmin: true },
        constructor: { prototype: { isAdmin: true } },
      }),
    );

    // parseEmbedCheckoutBody uses hasOnlyKeys() — unknown keys → 400
    expect(response.status).toBe(400);
    const body = await response.json();
    // Error message must not mention isAdmin or expose the payload
    expect(JSON.stringify(body)).not.toContain('isAdmin');
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });
});

// ===== CAT 31: Mass Assignment =====

describe('Cat 31: Mass Assignment', () => {
  it('ignores bypass_payment and price_override extra fields in embed checkout', async () => {
    // Old probe: { productId, is_admin, bypass_payment, price_override }
    // Retargeted: embed route uses productSlug; extra fields are rejected.
    const response = await POST(
      makeRequest({
        productSlug: 'kurs-ai',
        is_admin: true,
        bypass_payment: true,
        price_override: 0,
      }),
    );

    // hasOnlyKeys check rejects unknown fields before any DB call
    expect(response.status).toBe(400);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });
});

// ===== CAT 33: HTTP Method Fuzzing =====

describe('Cat 33: HTTP Method Fuzzing', () => {
  it.each(['GET', 'PUT', 'DELETE', 'PATCH'])(
    'non-POST method (%s) on /api/embed/checkout-session does not invoke POST handler',
    async (method) => {
      // The Next.js App Router will return 405 for methods with no exported
      // handler. We verify that at least the POST handler is NOT triggered —
      // testing the module directly only exposes POST/OPTIONS, so we confirm
      // other methods are not present on the exports.
      const mod = await import('@/app/api/embed/checkout-session/route');
      expect(typeof (mod as Record<string, unknown>)[method]).not.toBe('function');
    },
  );
});

// ===== CAT 41: Stripe Metadata Tampering =====

describe('Cat 41: Stripe Metadata Tampering', () => {
  it('metadata field in embed checkout body is rejected (not passed to Stripe)', async () => {
    // Old probe: { productId, metadata: { product_id: 'evil', price: 0 } }
    // Retargeted: metadata is not in PAID_CHECKOUT_KEYS → 400.
    const response = await POST(
      makeRequest({
        productSlug: 'kurs-ai',
        metadata: { product_id: 'evil', price: 0 },
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });
});

// ===== CAT 11: Payment Flow (non-existent product + bypass fields) =====

describe('Cat 11: Payment Flow', () => {
  it('returns 403 (not 200) for a non-existent product slug in embed checkout', async () => {
    // Old probe: { productId: '00000000-0000-0000-0000-000000000000' } → expected 400/404.
    // Retargeted: productSlug lookup returns null → loadEmbedContext also returns
    // allowedOrigins:[] (no product means no seller, no CORS allowlist), so the
    // CORS gate fires BEFORE the product-not-found check → 403 Forbidden.
    //
    // This is intentional: it prevents enumeration of valid product slugs via
    // response-code differences. Non-existent slugs always look "forbidden"
    // from an un-authorized context.
    mocks.createAdminClient.mockReturnValue(makeDbMock({ product: null }));

    const response = await POST(makeRequest({ productSlug: 'does-not-exist' }));

    expect(response.status).toBe(403);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('ignores bypass_payment and price_override in embed checkout even with valid slug', async () => {
    // Old probe: { productId, bypass_payment, price_override, currency, quantity: -1 }
    // Retargeted: extra fields cause 400 before any DB/Stripe call.
    const response = await POST(
      makeRequest({
        productSlug: 'kurs-ai',
        bypass_payment: true,
        price_override: 0,
        quantity: -1,
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });
});

// ===== CAT 15: Body Size / DoS =====

describe('Cat 15: Body Size / DoS', () => {
  it('returns 400 (not a server crash) for an oversized body', async () => {
    // Old probe: 1.1 MB body on dead route. Retargeted to embed route.
    // Next.js may truncate / return 413, or the JSON parse will succeed
    // but parseEmbedCheckoutBody will reject the unknown keys. Either way,
    // must not be 200 and must not crash.
    const bigPayload = JSON.stringify({ productSlug: 'kurs-ai', a: 'x'.repeat(1_100_000) });
    const req = new Request('http://localhost/api/embed/checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: bigPayload,
    });
    const response = await POST(req);

    // 400 (unknown key 'a'), 413 (body limit), or 0 (connection drop) — not 200
    expect([400, 413]).toContain(response.status);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('does not crash for deeply nested JSON (200-level depth)', async () => {
    // Old probe: 200-level deep nested object.
    // Retargeted to embed route: the JSON parses fine but
    // parseEmbedCheckoutBody rejects it (no productSlug at root).
    let obj: unknown = { leaf: true };
    for (let i = 0; i < 200; i++) {
      obj = { x: obj };
    }
    const req = new Request('http://localhost/api/embed/checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify(obj),
    });
    const response = await POST(req);

    expect([400, 413]).toContain(response.status);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });
});

// ===== CAT 40: Coupon Stacking =====

describe('Cat 40: Coupon Stacking', () => {
  it('rejects a request with an extra couponCode2 field in embed checkout', async () => {
    // Old probe: { productId, couponCode, couponCode2 }
    // Retargeted: the embed route accepts productSlug/email/turnstileToken only.
    // Any coupon field is not in PAID_CHECKOUT_KEYS → 400.
    const response = await POST(
      makeRequest({
        productSlug: 'kurs-ai',
        couponCode: 'VALID',
        couponCode2: 'ALSO_VALID',
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects a request with even a single couponCode field in embed checkout body', async () => {
    // The embed route has no coupon support. Sending couponCode is an unknown
    // key — rejected before any Stripe interaction.
    const response = await POST(
      makeRequest({
        productSlug: 'kurs-ai',
        couponCode: 'EVIL',
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });
});

// ===== CAT 28: Error Leakage =====

describe('Cat 28: Error Leakage', () => {
  it('inactive product and embed-disabled product return the same generic error shape', async () => {
    // Old probe compared non-existent vs inactive on the dead route.
    // Retargeted: on the live embed route, both "inactive" and "embed_enabled=false"
    // products pass the CORS gate (they have a seller_id → allowedOrigins populated)
    // then fail the isEmbeddableProduct() check → both return 404 with the same body.
    //
    // This verifies that the route uses a single generic error message and
    // does not leak WHY the product is unavailable (is_active=false vs embed_enabled=false).

    // "inactive" — product exists but is_active=false
    const inactiveProduct = { ...product, is_active: false };
    mocks.createAdminClient.mockReturnValue(makeDbMock({ product: inactiveProduct }));
    const r1 = await POST(makeRequest({ productSlug: 'inactive-product' }));

    // "embed disabled" — product exists but embed_enabled=false
    const embedDisabledProduct = { ...product, embed_enabled: false };
    mocks.createAdminClient.mockReturnValue(makeDbMock({ product: embedDisabledProduct }));
    const r2 = await POST(makeRequest({ productSlug: 'embed-disabled-product' }));

    // Both must return the same status code
    expect(r1.status).toBe(r2.status);
    expect(r1.status).toBe(404);

    const d1 = await r1.json();
    const d2 = await r2.json();
    // Both must return the same generic error — not differentiating the cause
    expect(d1.error).toBe(d2.error);
    // Neither must expose internal details
    expect(JSON.stringify(d1)).not.toMatch(/is_active|embed_enabled|seller_id/);
    expect(JSON.stringify(d2)).not.toMatch(/is_active|embed_enabled|seller_id/);
  });
});
