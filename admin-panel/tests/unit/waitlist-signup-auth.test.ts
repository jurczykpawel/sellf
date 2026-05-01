/**
 * `/api/waitlist/signup` skips captcha + body email validation when the
 * caller is authenticated and falls back to session email. Anonymous
 * callers retain the email + captcha contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/services/webhook-service', () => ({
  WebhookService: { trigger: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/captcha/verify', () => ({
  verifyCaptchaToken: vi.fn(),
}));

import { POST } from '@/app/api/waitlist/signup/route';
import { createClient } from '@/lib/supabase/server';
import { verifyCaptchaToken } from '@/lib/captcha/verify';

const VALID_PRODUCT_ID = '11111111-2222-3333-4444-555555555555';

function buildSupabase(opts: {
  userEmail: string | null;
  product?: { enable_waitlist: boolean } | null;
}) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: opts.userEmail ? { id: 'user-1', email: opts.userEmail } : null },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: opts.product
              ? {
                  id: VALID_PRODUCT_ID,
                  name: 'Test Product',
                  slug: 'test-product',
                  price: 0,
                  currency: 'PLN',
                  icon: null,
                  enable_waitlist: opts.product.enable_waitlist,
                }
              : null,
            error: opts.product ? null : { message: 'not found' },
          }),
        }),
      }),
    }),
  };
}

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/waitlist/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = 'production';
});

describe('POST /api/waitlist/signup — authenticated user', () => {
  it('uses session email and skips captcha verification', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildSupabase({
        userEmail: 'authed@example.com',
        product: { enable_waitlist: true },
      }) as never,
    );

    const res = await POST(
      buildRequest({ productId: VALID_PRODUCT_ID }),
    );
    expect(res.status).toBe(200);
    expect(verifyCaptchaToken).not.toHaveBeenCalled();
  });

  it('ignores body email and trusts session email even if body sends a different one', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildSupabase({
        userEmail: 'authed@example.com',
        product: { enable_waitlist: true },
      }) as never,
    );

    const res = await POST(
      buildRequest({
        email: 'spoofed@evil.example',
        productId: VALID_PRODUCT_ID,
      }),
    );
    expect(res.status).toBe(200);
    expect(verifyCaptchaToken).not.toHaveBeenCalled();
  });
});

describe('POST /api/waitlist/signup — anonymous user', () => {
  it('rejects when captcha verification fails', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildSupabase({
        userEmail: null,
        product: { enable_waitlist: true },
      }) as never,
    );
    (verifyCaptchaToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: 'Security verification failed',
    });

    const res = await POST(
      buildRequest({
        email: 'anon@example.com',
        productId: VALID_PRODUCT_ID,
        captchaToken: 'bad',
      }),
    );
    expect(res.status).toBe(400);
    expect(verifyCaptchaToken).toHaveBeenCalledTimes(1);
  });

  it('accepts when captcha verifies', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildSupabase({
        userEmail: null,
        product: { enable_waitlist: true },
      }) as never,
    );
    (verifyCaptchaToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    });

    const res = await POST(
      buildRequest({
        email: 'anon@example.com',
        productId: VALID_PRODUCT_ID,
        captchaToken: 'valid',
      }),
    );
    expect(res.status).toBe(200);
  });

  it('rejects when body has no email', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildSupabase({
        userEmail: null,
        product: { enable_waitlist: true },
      }) as never,
    );

    const res = await POST(
      buildRequest({ productId: VALID_PRODUCT_ID }),
    );
    expect(res.status).toBe(400);
    expect(verifyCaptchaToken).not.toHaveBeenCalled();
  });

  it('rejects malformed product id without consulting session', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildSupabase({ userEmail: null }) as never,
    );

    const res = await POST(
      buildRequest({ email: 'a@b.co', productId: 'not-a-uuid' }),
    );
    expect(res.status).toBe(400);
  });
});
