/**
 * Integration Tests: grantFreeProductAccess
 *
 * Hits the local Supabase stack — NO mocks for the service under test.
 *
 * WHY: a prior mock-based suite proved insufficient — it couldn't catch DB
 * contract mismatches. These integration tests capture the OBSERVABLE BEHAVIOUR
 * (what rows exist after the call) so any refactor that preserves the same
 * behaviour stays green, and any regression shows up immediately.
 *
 * Requires: npx supabase start + migrations applied (npx supabase db reset)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { grantFreeProductAccess } from '@/lib/services/free-product-access';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const TS = Date.now();

// Admin client — bypasses RLS. Targets seller_main schema for all seller data.
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'seller_main' as 'public' },
});

// Helpers target internal tables that the service itself reads/writes.
async function createUser(email: string, password = 'test-password-123') {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user!;
}

async function signInAs(email: string, password = 'test-password-123'): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function createProduct(overrides: Record<string, unknown> = {}) {
  const slug = `svc-${TS}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      name: `Svc Test ${slug}`,
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
  const code = `SVC-${TS}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const { data, error } = await supabaseAdmin
    .from('coupons')
    .insert({
      code,
      name: `Svc coupon ${code}`,
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

async function getUpa(userId: string, productId: string) {
  const { data } = await supabaseAdmin
    .from('user_product_access')
    .select('*')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .maybeSingle();
  return data;
}

async function getCouponById(id: string) {
  const { data } = await supabaseAdmin.from('coupons').select('*').eq('id', id).single();
  return data;
}

// Cleanup registry
const userIds: string[] = [];
const productIds: string[] = [];
const couponIds: string[] = [];

afterAll(async () => {
  if (couponIds.length) {
    await supabaseAdmin.from('coupon_redemptions').delete().in('coupon_id', couponIds);
    await supabaseAdmin.from('coupon_reservations').delete().in('coupon_id', couponIds);
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
// grantFreeProductAccess — end-to-end against real Supabase
// ============================================================================

describe('grantFreeProductAccess (integration)', () => {
  describe('regular free product (price=0)', () => {
    it('grants access via grant_free_product_access and creates a UPA row', async () => {
      const email = `svc-free-${TS}@example.com`;
      const user = await createUser(email);
      userIds.push(user.id);
      const product = await createProduct({ price: 0 });
      productIds.push(product.id);
      const userClient = await signInAs(email);

      const result = await grantFreeProductAccess(userClient, supabaseAdmin as any, {
        product: { id: product.id, slug: product.slug },
        user: { id: user.id, email },
      });

      expect(result.accessGranted).toBe(true);
      expect(result.alreadyHadAccess).toBe(false);

      const upa = await getUpa(user.id, product.id);
      expect(upa).not.toBeNull();
    });

    it('is idempotent: second call returns alreadyHadAccess=true, no duplicate rows', async () => {
      const email = `svc-free-idem-${TS}@example.com`;
      const user = await createUser(email);
      userIds.push(user.id);
      const product = await createProduct({ price: 0 });
      productIds.push(product.id);
      const userClient = await signInAs(email);

      await grantFreeProductAccess(userClient, supabaseAdmin as any, {
        product: { id: product.id, slug: product.slug },
        user: { id: user.id, email },
      });

      const second = await grantFreeProductAccess(userClient, supabaseAdmin as any, {
        product: { id: product.id, slug: product.slug },
        user: { id: user.id, email },
      });

      expect(second.accessGranted).toBe(true);
      expect(second.alreadyHadAccess).toBe(true);

      const { data: rows } = await supabaseAdmin
        .from('user_product_access')
        .select('id')
        .eq('user_id', user.id)
        .eq('product_id', product.id);
      expect(rows).toHaveLength(1);
    });
  });

  describe('PWYW-free product (price>0, custom_price_min=0)', () => {
    it('grants access via the unified RPC without a coupon code', async () => {
      const email = `svc-pwyw-${TS}@example.com`;
      const user = await createUser(email);
      userIds.push(user.id);
      const product = await createProduct({
        price: 25,
        allow_custom_price: true,
        custom_price_min: 0,
      });
      productIds.push(product.id);
      const userClient = await signInAs(email);

      const result = await grantFreeProductAccess(userClient, supabaseAdmin as any, {
        product: { id: product.id, slug: product.slug },
        user: { id: user.id, email },
      });

      expect(result.accessGranted).toBe(true);
      const upa = await getUpa(user.id, product.id);
      expect(upa).not.toBeNull();
    });
  });

  describe('100% coupon on a paid product', () => {
    it('grants access + records redemption + bumps usage counter', async () => {
      const email = `svc-coupon-${TS}@example.com`;
      const user = await createUser(email);
      userIds.push(user.id);
      const product = await createProduct({ price: 99, currency: 'PLN' });
      productIds.push(product.id);
      const coupon = await createCoupon({ discount_value: 100, current_usage_count: 0 });
      couponIds.push(coupon.id);
      const userClient = await signInAs(email);

      const result = await grantFreeProductAccess(userClient, supabaseAdmin as any, {
        product: { id: product.id, slug: product.slug },
        user: { id: user.id, email },
        couponCode: coupon.code,
      });

      expect(result.accessGranted).toBe(true);
      expect(result.alreadyHadAccess).toBe(false);

      // UPA row created
      const upa = await getUpa(user.id, product.id);
      expect(upa).not.toBeNull();
      expect(upa!.access_expires_at).toBeNull();

      // Redemption row created atomically inside the RPC
      const { data: redemptions } = await supabaseAdmin
        .from('coupon_redemptions')
        .select('*')
        .eq('coupon_id', coupon.id);
      expect(redemptions).toHaveLength(1);
      expect(redemptions![0].user_id).toBe(user.id);
      expect(redemptions![0].customer_email).toBe(email);
      expect(Number(redemptions![0].discount_amount)).toBe(99);
      expect(redemptions![0].transaction_id).toBeNull();

      // Global usage counter bumped
      const updated = await getCouponById(coupon.id);
      expect(updated.current_usage_count).toBe(1);
    });

    it('does NOT record a second redemption when user already has access (idempotent)', async () => {
      const email = `svc-coupon-idem-${TS}@example.com`;
      const user = await createUser(email);
      userIds.push(user.id);
      const product = await createProduct({ price: 99, currency: 'PLN' });
      productIds.push(product.id);
      const coupon = await createCoupon({ discount_value: 100, usage_limit_per_user: 1 });
      couponIds.push(coupon.id);
      const userClient = await signInAs(email);

      await grantFreeProductAccess(userClient, supabaseAdmin as any, {
        product: { id: product.id, slug: product.slug },
        user: { id: user.id, email },
        couponCode: coupon.code,
      });

      const second = await grantFreeProductAccess(userClient, supabaseAdmin as any, {
        product: { id: product.id, slug: product.slug },
        user: { id: user.id, email },
        couponCode: coupon.code,
      });

      expect(second.accessGranted).toBe(true);
      expect(second.alreadyHadAccess).toBe(true);

      const { data: redemptions } = await supabaseAdmin
        .from('coupon_redemptions')
        .select('id')
        .eq('coupon_id', coupon.id);
      expect(redemptions).toHaveLength(1);

      const updated = await getCouponById(coupon.id);
      expect(updated.current_usage_count).toBe(1);
    });

    it('cleans up any outstanding reservation for this coupon+email', async () => {
      const email = `svc-coupon-res-${TS}@example.com`;
      const user = await createUser(email);
      userIds.push(user.id);
      const product = await createProduct({ price: 50, currency: 'PLN' });
      productIds.push(product.id);
      const coupon = await createCoupon({ discount_value: 100 });
      couponIds.push(coupon.id);
      const userClient = await signInAs(email);

      // Pre-insert a reservation as if a prior flow had made one
      await supabaseAdmin.from('coupon_reservations').insert({
        coupon_id: coupon.id,
        customer_email: email,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });

      await grantFreeProductAccess(userClient, supabaseAdmin as any, {
        product: { id: product.id, slug: product.slug },
        user: { id: user.id, email },
        couponCode: coupon.code,
      });

      const { data: remaining } = await supabaseAdmin
        .from('coupon_reservations')
        .select('id')
        .eq('coupon_id', coupon.id)
        .eq('customer_email', email);
      expect(remaining).toHaveLength(0);
    });

    it('rejects a 99% coupon (not full discount)', async () => {
      const email = `svc-coupon-99-${TS}@example.com`;
      const user = await createUser(email);
      userIds.push(user.id);
      const product = await createProduct({ price: 100, currency: 'PLN' });
      productIds.push(product.id);
      const coupon = await createCoupon({ discount_value: 99 });
      couponIds.push(coupon.id);
      const userClient = await signInAs(email);

      const result = await grantFreeProductAccess(userClient, supabaseAdmin as any, {
        product: { id: product.id, slug: product.slug },
        user: { id: user.id, email },
        couponCode: coupon.code,
      });

      expect(result.accessGranted).toBe(false);

      const upa = await getUpa(user.id, product.id);
      expect(upa).toBeNull();
      const { data: redemptions } = await supabaseAdmin
        .from('coupon_redemptions')
        .select('id')
        .eq('coupon_id', coupon.id);
      expect(redemptions).toHaveLength(0);
    });

    it('rejects an expired 100% coupon', async () => {
      const email = `svc-coupon-exp-${TS}@example.com`;
      const user = await createUser(email);
      userIds.push(user.id);
      const product = await createProduct({ price: 50, currency: 'PLN' });
      productIds.push(product.id);
      const coupon = await createCoupon({
        discount_value: 100,
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      });
      couponIds.push(coupon.id);
      const userClient = await signInAs(email);

      const result = await grantFreeProductAccess(userClient, supabaseAdmin as any, {
        product: { id: product.id, slug: product.slug },
        user: { id: user.id, email },
        couponCode: coupon.code,
      });

      expect(result.accessGranted).toBe(false);
      const upa = await getUpa(user.id, product.id);
      expect(upa).toBeNull();
    });

    it('rejects a nonexistent coupon', async () => {
      const email = `svc-coupon-none-${TS}@example.com`;
      const user = await createUser(email);
      userIds.push(user.id);
      const product = await createProduct({ price: 50, currency: 'PLN' });
      productIds.push(product.id);
      const userClient = await signInAs(email);

      const result = await grantFreeProductAccess(userClient, supabaseAdmin as any, {
        product: { id: product.id, slug: product.slug },
        user: { id: user.id, email },
        couponCode: `NOPE-${TS}`,
      });

      expect(result.accessGranted).toBe(false);
      const upa = await getUpa(user.id, product.id);
      expect(upa).toBeNull();
    });

    it('rejects a coupon whose global usage limit has been reached', async () => {
      const email = `svc-coupon-limit-${TS}@example.com`;
      const user = await createUser(email);
      userIds.push(user.id);
      const product = await createProduct({ price: 50, currency: 'PLN' });
      productIds.push(product.id);
      const coupon = await createCoupon({
        discount_value: 100,
        usage_limit_global: 1,
        current_usage_count: 1,
      });
      couponIds.push(coupon.id);
      const userClient = await signInAs(email);

      const result = await grantFreeProductAccess(userClient, supabaseAdmin as any, {
        product: { id: product.id, slug: product.slug },
        user: { id: user.id, email },
        couponCode: coupon.code,
      });

      expect(result.accessGranted).toBe(false);
      const upa = await getUpa(user.id, product.id);
      expect(upa).toBeNull();
    });
  });
});
