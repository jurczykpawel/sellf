/**
 * Integration Tests: /auth/product-access GET handler
 *
 * Exercises the real handler against local Supabase, with next/headers and
 * next/navigation mocked so we can assert redirect targets without running
 * a full Next.js server.
 *
 * WHY these matter: the callback is the magic-link landing spot. It owns the
 * "user just confirmed their email, now grant + bounce to the right page"
 * orchestration. It has path-specific behaviour (coupon vs free vs paid) that
 * is NOT covered by the service-level integration tests.
 *
 * Requires: npx supabase start + migrations applied.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const TS = Date.now();

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'seller_main' as 'public' },
});

// ============================================================================
// Mocks that make the Next.js GET handler runnable in vitest.
//
// We stub @/lib/supabase/server::createClient so the handler uses a client
// we control (authenticated as a specific test user). next/navigation::redirect
// is captured so we can assert the redirect target.
// ============================================================================

type RedirectCall = { url: string };
const redirectCalls: RedirectCall[] = [];

class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.name = 'RedirectError';
  }
}

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectCalls.push({ url });
    // Next.js throws internally to unwind; we mimic that so the handler stops.
    throw new RedirectError(url);
  },
}));

// Holder for the current authenticated client — swapped per test.
let currentAuthedClient: any = null;

vi.mock('@/lib/supabase/server', async () => ({
  createClient: async () => currentAuthedClient,
}));

vi.mock('@/lib/supabase/admin', async () => ({
  createAdminClient: () => supabaseAdmin,
}));

// Import the handler AFTER the mocks are in place.
const { GET } = await import('@/app/[locale]/auth/product-access/route');

// ============================================================================
// Helpers
// ============================================================================

async function createUser(email: string, password = 'test-password-123') {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user!;
}

async function signInAs(email: string, password = 'test-password-123') {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function createProduct(overrides: Record<string, unknown> = {}) {
  const slug = `cb-${TS}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      name: `Callback Test ${slug}`,
      slug,
      price: 0,
      currency: 'USD',
      is_active: true,
      ...overrides,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function createCoupon(overrides: Record<string, unknown> = {}) {
  const code = `CB-${TS}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const { data, error } = await supabaseAdmin
    .from('coupons')
    .insert({
      code,
      name: `Callback coupon ${code}`,
      discount_type: 'percentage',
      discount_value: 100,
      is_active: true,
      usage_limit_global: 100,
      usage_limit_per_user: 1,
      current_usage_count: 0,
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ...overrides,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function runCallback(url: string): Promise<string> {
  redirectCalls.length = 0;
  try {
    await GET(new Request(url) as any);
  } catch (err) {
    if (err instanceof RedirectError) return err.url;
    // Re-throw anything else; it's a real failure.
    throw err;
  }
  if (redirectCalls.length === 0) {
    throw new Error('Handler returned without calling redirect');
  }
  return redirectCalls[redirectCalls.length - 1].url;
}

// Cleanup
const userIds: string[] = [];
const productIds: string[] = [];
const couponIds: string[] = [];

afterAll(async () => {
  if (couponIds.length) {
    await supabaseAdmin.from('coupon_redemptions').delete().in('coupon_id', couponIds);
    await supabaseAdmin.from('coupons').delete().in('id', couponIds);
  }
  if (productIds.length) {
    await supabaseAdmin.from('user_product_access').delete().in('product_id', productIds);
    await supabaseAdmin.from('products').delete().in('id', productIds);
  }
  for (const id of userIds) {
    await supabaseAdmin.auth.admin.deleteUser(id).catch(() => void 0);
  }
});

// ============================================================================
// URL param handling
// ============================================================================

describe('/auth/product-access — URL params', () => {
  it('redirects to / when no product slug is provided', async () => {
    currentAuthedClient = createClient(SUPABASE_URL, ANON_KEY);
    const target = await runCallback('http://localhost/auth/product-access');
    expect(target).toBe('/');
  });

  it('redirects to prodUrl when user is not authenticated', async () => {
    // Unauthenticated client: getUser() returns null
    currentAuthedClient = createClient(SUPABASE_URL, ANON_KEY);
    const product = await createProduct({ price: 0 });
    productIds.push(product.id);

    const target = await runCallback(`http://localhost/auth/product-access?product=${product.slug}`);
    expect(target).toBe(`/p/${product.slug}`);
  });
});

// ============================================================================
// Grant paths
// ============================================================================

describe('/auth/product-access — grant flows', () => {
  it('grants a free product (price=0) and redirects to payment-status', async () => {
    const email = `cb-free-${TS}@example.com`;
    const user = await createUser(email);
    userIds.push(user.id);
    const product = await createProduct({ price: 0 });
    productIds.push(product.id);

    currentAuthedClient = await signInAs(email);

    const target = await runCallback(`http://localhost/auth/product-access?product=${product.slug}`);
    expect(target).toBe(`/p/${product.slug}/payment-status`);

    const { data: upa } = await supabaseAdmin
      .from('user_product_access')
      .select('id')
      .eq('user_id', user.id)
      .eq('product_id', product.id)
      .maybeSingle();
    expect(upa).not.toBeNull();
  });

  it('grants PWYW-free product and redirects to payment-status', async () => {
    const email = `cb-pwyw-${TS}@example.com`;
    const user = await createUser(email);
    userIds.push(user.id);
    const product = await createProduct({
      price: 20,
      allow_custom_price: true,
      custom_price_min: 0,
    });
    productIds.push(product.id);

    currentAuthedClient = await signInAs(email);

    const target = await runCallback(`http://localhost/auth/product-access?product=${product.slug}`);
    expect(target).toBe(`/p/${product.slug}/payment-status`);
  });

  it('grants paid product when a valid 100% coupon is supplied + records redemption', async () => {
    const email = `cb-coupon-${TS}@example.com`;
    const user = await createUser(email);
    userIds.push(user.id);
    const product = await createProduct({ price: 99, currency: 'PLN' });
    productIds.push(product.id);
    const coupon = await createCoupon({ discount_value: 100 });
    couponIds.push(coupon.id);

    currentAuthedClient = await signInAs(email);

    const target = await runCallback(
      `http://localhost/auth/product-access?product=${product.slug}&coupon=${coupon.code}`,
    );
    expect(target).toBe(`/p/${product.slug}/payment-status`);

    const { data: upa } = await supabaseAdmin
      .from('user_product_access')
      .select('id')
      .eq('user_id', user.id)
      .eq('product_id', product.id)
      .maybeSingle();
    expect(upa).not.toBeNull();

    const { data: redemptions } = await supabaseAdmin
      .from('coupon_redemptions')
      .select('id, user_id')
      .eq('coupon_id', coupon.id);
    expect(redemptions).toHaveLength(1);
    expect(redemptions![0].user_id).toBe(user.id);
  });

  it('falls back to prodUrl when paid product is visited WITHOUT a coupon', async () => {
    const email = `cb-paid-no-coupon-${TS}@example.com`;
    const user = await createUser(email);
    userIds.push(user.id);
    const product = await createProduct({ price: 99 });
    productIds.push(product.id);

    currentAuthedClient = await signInAs(email);

    const target = await runCallback(`http://localhost/auth/product-access?product=${product.slug}`);
    expect(target).toBe(`/p/${product.slug}`);

    const { data: upa } = await supabaseAdmin
      .from('user_product_access')
      .select('id')
      .eq('user_id', user.id)
      .eq('product_id', product.id)
      .maybeSingle();
    expect(upa).toBeNull();
  });

  it('falls back to prodUrl when the supplied coupon is invalid', async () => {
    const email = `cb-bad-coupon-${TS}@example.com`;
    const user = await createUser(email);
    userIds.push(user.id);
    const product = await createProduct({ price: 99, currency: 'PLN' });
    productIds.push(product.id);

    currentAuthedClient = await signInAs(email);

    const target = await runCallback(
      `http://localhost/auth/product-access?product=${product.slug}&coupon=DOES-NOT-EXIST`,
    );
    expect(target).toBe(`/p/${product.slug}`);

    const { data: upa } = await supabaseAdmin
      .from('user_product_access')
      .select('id')
      .eq('user_id', user.id)
      .eq('product_id', product.id)
      .maybeSingle();
    expect(upa).toBeNull();
  });

  it('preserves success_url when redirecting to payment-status', async () => {
    const email = `cb-success-url-${TS}@example.com`;
    const user = await createUser(email);
    userIds.push(user.id);
    const product = await createProduct({ price: 0 });
    productIds.push(product.id);

    currentAuthedClient = await signInAs(email);

    const successUrl = 'https://example.com/thanks';
    const target = await runCallback(
      `http://localhost/auth/product-access?product=${product.slug}&success_url=${encodeURIComponent(successUrl)}`,
    );
    // success_url is encoded into the status URL query.
    expect(target).toContain(`/p/${product.slug}/payment-status`);
    expect(target).toContain('success_url=');
  });
});

// ============================================================================
// Existing access
// ============================================================================

describe('/auth/product-access — existing access', () => {
  it('redirects to prodUrl when user already has access (no regrant)', async () => {
    const email = `cb-has-access-${TS}@example.com`;
    const user = await createUser(email);
    userIds.push(user.id);
    const product = await createProduct({ price: 0 });
    productIds.push(product.id);

    // Pre-grant access
    await supabaseAdmin.from('user_product_access').insert({
      user_id: user.id,
      product_id: product.id,
      access_expires_at: null,
    });

    currentAuthedClient = await signInAs(email);

    const target = await runCallback(`http://localhost/auth/product-access?product=${product.slug}`);
    expect(target).toBe(`/p/${product.slug}`);
  });
});
