/**
 * ============================================================================
 * SECURITY TESTS: Coupon & Sale RPC Functions
 * ============================================================================
 *
 * Tests database functions:
 * - find_auto_apply_coupon: finds coupons that auto-apply based on email/product
 * - cleanup_expired_oto_coupons: removes expired OTO coupons
 * - verify_coupon: verifies coupon validity (rate limiting, restrictions)
 * - increment_sale_quantity_sold: atomically increments sale counter
 *
 * Uses service_role Supabase client to call RPC directly.
 *
 * @see supabase/migrations/20250103000000_features.sql
 * @see supabase/migrations/20251229120000_omnibus_directive.sql
 * @see supabase/migrations/20251230000000_oto_system.sql
 * @see supabase/migrations/20260306173137_pentest_security_hardening.sql
 * ============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const supabaseAnon = createClient(SUPABASE_URL, ANON_KEY);

/** Unique suffix to avoid collisions between test runs */
const TS = Date.now();

// ============================================================================
// Shared test data tracking for cleanup
// ============================================================================

const createdProductIds: string[] = [];
const createdCouponIds: string[] = [];

async function createProduct(overrides: Record<string, unknown> = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      name: `Test Product ${TS}-${suffix}`,
      slug: `test-product-${TS}-${suffix}`,
      price: 100.0,
      currency: 'USD',
      is_active: true,
      ...overrides,
    })
    .select()
    .single();
  if (error) throw error;
  createdProductIds.push(data.id);
  return data;
}

async function createCoupon(overrides: Record<string, unknown> = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const { data, error } = await supabaseAdmin
    .from('coupons')
    .insert({
      code: `TEST-${TS}-${suffix}`,
      name: `Test Coupon ${TS}-${suffix}`,
      discount_type: 'percentage',
      discount_value: 20,
      is_active: true,
      usage_limit_global: 100,
      usage_limit_per_user: 1,
      current_usage_count: 0,
      starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ...overrides,
    })
    .select()
    .single();
  if (error) throw error;
  createdCouponIds.push(data.id);
  return data;
}

// ============================================================================
// Global setup & teardown
// ============================================================================

beforeAll(async () => {
  // Clear rate limits to avoid interference
  await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');
});

afterAll(async () => {
  // Clean up in dependency order
  for (const cid of createdCouponIds) {
    await supabaseAdmin.from('coupon_redemptions').delete().eq('coupon_id', cid);
    await supabaseAdmin.from('coupon_reservations').delete().eq('coupon_id', cid);
    await supabaseAdmin.from('coupons').delete().eq('id', cid);
  }
  for (const pid of createdProductIds) {
    // Reset sale_quantity_sold before deleting
    await supabaseAdmin
      .from('products')
      .update({ sale_quantity_sold: 0 })
      .eq('id', pid);
    await supabaseAdmin.from('products').delete().eq('id', pid);
  }
});

// ============================================================================
// find_auto_apply_coupon
// ============================================================================

describe('find_auto_apply_coupon', () => {
  it('finds coupon matching email + product', async () => {
    const email = `auto-match-${TS}@example.com`;
    const product = await createProduct();
    const coupon = await createCoupon({
      allowed_emails: [email],
      allowed_product_ids: [product.id],
    });

    const { data, error } = await supabaseAdmin.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.found).toBe(true);
    expect(data.code).toBe(coupon.code);
    expect(data.discount_type).toBe('percentage');
    expect(data.discount_value).toBe(20);
  });

  it('works with anon client (function is grantable to anon)', async () => {
    const email = `auto-anon-${TS}@example.com`;
    const product = await createProduct();
    const coupon = await createCoupon({
      allowed_emails: [email],
      allowed_product_ids: [product.id],
    });

    const { data, error } = await supabaseAnon.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.found).toBe(true);
    expect(data.code).toBe(coupon.code);
  });

  it('finds coupon matching email with empty allowed_product_ids (any product)', async () => {
    const email = `auto-any-product-${TS}@example.com`;
    const product = await createProduct();
    const coupon = await createCoupon({
      allowed_emails: [email],
      allowed_product_ids: [],
    });

    const { data, error } = await supabaseAdmin.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.found).toBe(true);
    expect(data.code).toBe(coupon.code);
  });

  it('returns found=false when no matching coupon exists', async () => {
    const email = `no-match-${TS}@example.com`;
    const product = await createProduct();

    const { data, error } = await supabaseAdmin.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.found).toBe(false);
  });

  it('returns found=false when email does not match', async () => {
    const email = `wrong-email-${TS}@example.com`;
    const product = await createProduct();
    await createCoupon({
      allowed_emails: [`other-${TS}@example.com`],
      allowed_product_ids: [product.id],
    });

    const { data, error } = await supabaseAdmin.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.found).toBe(false);
  });

  it('respects usage_limit_global (exhausted coupon not returned)', async () => {
    const email = `usage-limit-${TS}@example.com`;
    const product = await createProduct();
    await createCoupon({
      allowed_emails: [email],
      allowed_product_ids: [product.id],
      usage_limit_global: 5,
      current_usage_count: 5,
    });

    const { data, error } = await supabaseAdmin.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.found).toBe(false);
  });

  it('respects usage_limit_global=null (unlimited usage)', async () => {
    const email = `unlimited-${TS}@example.com`;
    const product = await createProduct();
    const coupon = await createCoupon({
      allowed_emails: [email],
      allowed_product_ids: [product.id],
      usage_limit_global: null,
      current_usage_count: 999,
    });

    const { data, error } = await supabaseAdmin.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.found).toBe(true);
    expect(data.code).toBe(coupon.code);
  });

  it('respects expires_at (expired coupon not returned)', async () => {
    const email = `expired-auto-${TS}@example.com`;
    const product = await createProduct();
    await createCoupon({
      allowed_emails: [email],
      allowed_product_ids: [product.id],
      expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    const { data, error } = await supabaseAdmin.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.found).toBe(false);
  });

  it('respects starts_at (future coupon not returned)', async () => {
    const email = `future-auto-${TS}@example.com`;
    const product = await createProduct();
    await createCoupon({
      allowed_emails: [email],
      allowed_product_ids: [product.id],
      starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    const { data, error } = await supabaseAdmin.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.found).toBe(false);
  });

  it('does not return inactive coupons', async () => {
    const email = `inactive-auto-${TS}@example.com`;
    const product = await createProduct();
    await createCoupon({
      allowed_emails: [email],
      allowed_product_ids: [product.id],
      is_active: false,
    });

    const { data, error } = await supabaseAdmin.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.found).toBe(false);
  });

  it('returns the most recently created coupon when multiple match', async () => {
    const email = `multi-match-${TS}@example.com`;
    const product = await createProduct();

    // Create older coupon first
    await createCoupon({
      code: `OLDER-${TS}`,
      allowed_emails: [email],
      allowed_product_ids: [product.id],
      discount_value: 10,
    });

    // Small delay to ensure different created_at timestamps
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Create newer coupon
    const newerCoupon = await createCoupon({
      code: `NEWER-${TS}`,
      allowed_emails: [email],
      allowed_product_ids: [product.id],
      discount_value: 25,
    });

    const { data, error } = await supabaseAdmin.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.found).toBe(true);
    // ORDER BY created_at DESC LIMIT 1 - should return the newer one
    expect(data.code).toBe(newerCoupon.code);
    expect(data.discount_value).toBe(25);
  });

  it('does not return coupon for wrong product_id', async () => {
    const email = `wrong-product-${TS}@example.com`;
    const product1 = await createProduct();
    const product2 = await createProduct();
    await createCoupon({
      allowed_emails: [email],
      allowed_product_ids: [product1.id],
    });

    const { data, error } = await supabaseAdmin.rpc('find_auto_apply_coupon', {
      customer_email_param: email,
      product_id_param: product2.id,
    });

    expect(error).toBeNull();
    expect(data.found).toBe(false);
  });
});

// ============================================================================
// cleanup_expired_oto_coupons
// ============================================================================

describe('cleanup_expired_oto_coupons', () => {
  it('removes expired, unused OTO coupons (expired > 1 hour ago)', async () => {
    const product = await createProduct();

    // Create an OTO coupon that expired more than 1 hour ago
    const expiredOtoCoupon = await createCoupon({
      code: `OTO-CLEANUP-EXP-${TS}`,
      is_oto_coupon: true,
      current_usage_count: 0,
      expires_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      allowed_product_ids: [product.id],
      allowed_emails: [`cleanup-exp-${TS}@example.com`],
    });

    const { data: deletedCount, error } = await supabaseAdmin.rpc(
      'cleanup_expired_oto_coupons'
    );

    expect(error).toBeNull();
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    // Verify coupon was actually deleted
    const { data: remaining } = await supabaseAdmin
      .from('coupons')
      .select('id')
      .eq('id', expiredOtoCoupon.id)
      .single();

    expect(remaining).toBeNull();
    // Remove from cleanup tracking since it's already deleted
    const idx = createdCouponIds.indexOf(expiredOtoCoupon.id);
    if (idx > -1) createdCouponIds.splice(idx, 1);
  });

  it('keeps OTO coupons that expired less than 1 hour ago (grace period)', async () => {
    const product = await createProduct();

    // Create an OTO coupon that expired 30 minutes ago (within grace period)
    const recentlyExpired = await createCoupon({
      code: `OTO-CLEANUP-GRACE-${TS}`,
      is_oto_coupon: true,
      current_usage_count: 0,
      expires_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
      allowed_product_ids: [product.id],
      allowed_emails: [`cleanup-grace-${TS}@example.com`],
    });

    await supabaseAdmin.rpc('cleanup_expired_oto_coupons');

    // Verify coupon still exists (within 1-hour grace period)
    const { data: remaining } = await supabaseAdmin
      .from('coupons')
      .select('id')
      .eq('id', recentlyExpired.id)
      .single();

    expect(remaining).not.toBeNull();
    expect(remaining!.id).toBe(recentlyExpired.id);
  });

  it('keeps non-expired OTO coupons', async () => {
    const product = await createProduct();

    const activeOtoCoupon = await createCoupon({
      code: `OTO-CLEANUP-ACTIVE-${TS}`,
      is_oto_coupon: true,
      current_usage_count: 0,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
      allowed_product_ids: [product.id],
      allowed_emails: [`cleanup-active-${TS}@example.com`],
    });

    await supabaseAdmin.rpc('cleanup_expired_oto_coupons');

    // Verify coupon still exists
    const { data: remaining } = await supabaseAdmin
      .from('coupons')
      .select('id')
      .eq('id', activeOtoCoupon.id)
      .single();

    expect(remaining).not.toBeNull();
    expect(remaining!.id).toBe(activeOtoCoupon.id);
  });

  it('keeps non-OTO coupons even if expired', async () => {
    const product = await createProduct();

    const regularExpired = await createCoupon({
      code: `REG-CLEANUP-EXP-${TS}`,
      is_oto_coupon: false,
      current_usage_count: 0,
      expires_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      allowed_product_ids: [product.id],
      allowed_emails: [`cleanup-reg-${TS}@example.com`],
    });

    await supabaseAdmin.rpc('cleanup_expired_oto_coupons');

    // Verify regular coupon still exists
    const { data: remaining } = await supabaseAdmin
      .from('coupons')
      .select('id')
      .eq('id', regularExpired.id)
      .single();

    expect(remaining).not.toBeNull();
    expect(remaining!.id).toBe(regularExpired.id);
  });

  it('keeps expired OTO coupons that have been used', async () => {
    const product = await createProduct();

    const usedOtoCoupon = await createCoupon({
      code: `OTO-CLEANUP-USED-${TS}`,
      is_oto_coupon: true,
      current_usage_count: 1, // has been used
      expires_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      allowed_product_ids: [product.id],
      allowed_emails: [`cleanup-used-${TS}@example.com`],
    });

    await supabaseAdmin.rpc('cleanup_expired_oto_coupons');

    // Verify used coupon still exists
    const { data: remaining } = await supabaseAdmin
      .from('coupons')
      .select('id')
      .eq('id', usedOtoCoupon.id)
      .single();

    expect(remaining).not.toBeNull();
    expect(remaining!.id).toBe(usedOtoCoupon.id);
  });

  it('returns 0 when no expired OTO coupons exist', async () => {
    // Self-contained: insert a known expired OTO coupon, clean it up, then verify
    // the second cleanup returns 0. This avoids depending on test ordering or
    // assuming no expired OTO coupons exist from previous tests.
    const product = await createProduct();
    const expiredOto = await createCoupon({
      code: `OTO-ZERO-CHECK-${TS}`,
      is_oto_coupon: true,
      current_usage_count: 0,
      expires_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      allowed_product_ids: [product.id],
      allowed_emails: [`zero-check-${TS}@example.com`],
    });

    // First call: purge all expired OTO coupons (including the one we just created)
    const { data: firstCount } = await supabaseAdmin.rpc('cleanup_expired_oto_coupons');
    expect(firstCount).toBeGreaterThanOrEqual(1);

    // Remove from cleanup tracking since it's already deleted
    const idx = createdCouponIds.indexOf(expiredOto.id);
    if (idx > -1) createdCouponIds.splice(idx, 1);

    // Second call: with no expired OTO coupons remaining, this must return 0.
    const { data: deletedCount, error } = await supabaseAdmin.rpc(
      'cleanup_expired_oto_coupons'
    );

    expect(error).toBeNull();
    expect(deletedCount).toBe(0);
  });
});

// ============================================================================
// verify_coupon
// ============================================================================

describe('verify_coupon', () => {
  it('rejects coupon with allowed_product_ids restriction for wrong product', async () => {
    const product1 = await createProduct();
    const product2 = await createProduct();
    const coupon = await createCoupon({
      code: `PROD-RESTRICT-${TS}`,
      allowed_product_ids: [product1.id],
      allowed_emails: [],
    });

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product2.id,
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Code not valid for this product');
  });

  it('accepts coupon with allowed_product_ids matching the product', async () => {
    const email = `prod-match-${TS}@example.com`;
    const product = await createProduct();
    const coupon = await createCoupon({
      code: `PROD-MATCH-${TS}`,
      allowed_product_ids: [product.id],
      allowed_emails: [],
    });

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      customer_email_param: email,
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(true);
    expect(data.code).toBe(coupon.code);

    // Verify reservation was created as a side effect of valid verification
    const { data: reservations } = await supabaseAdmin
      .from('coupon_reservations')
      .select('coupon_id, customer_email, reserved_at')
      .eq('coupon_id', coupon.id);

    expect(reservations).not.toBeNull();
    expect(reservations!.length).toBeGreaterThanOrEqual(1);
    const reservation = reservations![0];
    expect(reservation.coupon_id).toBe(coupon.id);
    // reserved_at should be recent (within last 30 seconds)
    const reservedAt = new Date(reservation.reserved_at).getTime();
    expect(Date.now() - reservedAt).toBeLessThan(30_000);
  });

  it('rejects coupon with allowed_emails restriction for wrong email', async () => {
    const product = await createProduct();
    const coupon = await createCoupon({
      code: `EMAIL-RESTRICT-${TS}`,
      allowed_emails: [`allowed-${TS}@example.com`],
      allowed_product_ids: [],
    });

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      customer_email_param: `wrong-${TS}@example.com`,
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Code not authorized for this email');
  });

  it('accepts coupon with allowed_emails matching the email', async () => {
    const email = `allowed-verify-${TS}@example.com`;
    const product = await createProduct();
    const coupon = await createCoupon({
      code: `EMAIL-MATCH-${TS}`,
      allowed_emails: [email],
      allowed_product_ids: [],
    });

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      customer_email_param: email,
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(true);
    expect(data.code).toBe(coupon.code);

    // Verify reservation was created as a side effect of valid verification
    const { data: reservations } = await supabaseAdmin
      .from('coupon_reservations')
      .select('coupon_id, customer_email, reserved_at')
      .eq('coupon_id', coupon.id);

    expect(reservations).not.toBeNull();
    expect(reservations!.length).toBeGreaterThanOrEqual(1);
    expect(reservations![0].coupon_id).toBe(coupon.id);
  });

  it('rejects coupon with allowed_emails when no email provided', async () => {
    const product = await createProduct();
    const coupon = await createCoupon({
      code: `EMAIL-NULL-${TS}`,
      allowed_emails: [`someone-${TS}@example.com`],
      allowed_product_ids: [],
    });

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      // no customer_email_param
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Code not authorized for this email');
  });

  it('rejects expired coupon', async () => {
    const product = await createProduct();
    const coupon = await createCoupon({
      code: `EXPIRED-VERIFY-${TS}`,
      expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      allowed_emails: [],
      allowed_product_ids: [],
    });

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Code expired');
  });

  it('rejects inactive coupon', async () => {
    const product = await createProduct();
    await createCoupon({
      code: `INACTIVE-VERIFY-${TS}`,
      is_active: false,
      allowed_emails: [],
      allowed_product_ids: [],
    });

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: `INACTIVE-VERIFY-${TS}`,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Invalid code');
  });

  it('rejects coupon that has not started yet (starts_at in future)', async () => {
    const product = await createProduct();
    const coupon = await createCoupon({
      code: `FUTURE-VERIFY-${TS}`,
      starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      allowed_emails: [],
      allowed_product_ids: [],
    });

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Code not active yet');
  });

  it('rejects non-existent coupon code', async () => {
    const product = await createProduct();

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: `NONEXISTENT-${TS}-${Math.random()}`,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Invalid code');
  });

  it('rejects fixed-amount coupon with currency mismatch', async () => {
    const product = await createProduct();
    const coupon = await createCoupon({
      code: `CURRENCY-MISMATCH-${TS}`,
      discount_type: 'fixed',
      discount_value: 10,
      currency: 'USD',
      allowed_emails: [],
      allowed_product_ids: [],
    });

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      currency_param: 'PLN',
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Code invalid for this currency');
  });

  it('rejects coupon when global usage limit is reached (with reservations)', async () => {
    const product = await createProduct();
    const coupon = await createCoupon({
      code: `GLOBAL-LIMIT-${TS}`,
      usage_limit_global: 2,
      current_usage_count: 2,
      allowed_emails: [],
      allowed_product_ids: [],
    });

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Code usage limit reached');
  });

  it('rate limits verify_coupon after too many attempts', async () => {
    // Clear rate limits before this test to ensure a clean baseline
    await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');

    const product = await createProduct();
    const coupon = await createCoupon({
      code: `RATE-LIMIT-${TS}`,
      allowed_emails: [],
      allowed_product_ids: [],
    });

    // Use the anon client to simulate the real threat model: anonymous brute-force.
    // Rate limit key for anon users is derived from inet_client_addr() (TCP connection IP)
    // with a fallback to pg_backend_pid() + time bucket. In local test environments,
    // inet_client_addr() may return NULL (e.g. via Unix socket or connection pooling),
    // so rate limiting falls back to the pg_backend_pid-based key. This key may differ
    // across calls if connection pooling rotates backends. However, the global anonymous
    // backup rate limit ('global_anon_verify_coupon') provides a second layer that
    // catches this scenario since it uses a single deterministic key for ALL anonymous
    // callers of the same function.
    //
    // We make enough calls (42) to exceed both the per-connection limit (20) AND the
    // global anonymous backup limit (max(10, 20*2) = 40) to guarantee rate limiting
    // triggers regardless of connection pooling behavior.
    const results = [];
    for (let i = 0; i < 42; i++) {
      const { data } = await supabaseAnon.rpc('verify_coupon', {
        code_param: coupon.code,
        product_id_param: product.id,
      });
      results.push(data);
    }

    // At least the last call must be rate-limited. Depending on connection pooling,
    // either the per-connection limit (20) or global anon limit (40) will trigger.
    const lastResult = results[results.length - 1];
    expect(lastResult?.valid).toBe(false);
    expect(lastResult?.error).toContain('Too many attempts');

    // Verify that rate limiting kicked in at some point during the run
    const rateLimitedCount = results.filter(
      (r) => r?.valid === false && r?.error?.includes('Too many attempts')
    ).length;
    expect(rateLimitedCount).toBeGreaterThanOrEqual(1);

    // FRAGILITY NOTE: The exact call at which rate limiting triggers depends on
    // connection pooling behavior. inet_client_addr() may return NULL in local/test
    // environments, causing fallback to pg_backend_pid-based keys. Connection pooling
    // may rotate backends, distributing calls across different rate limit keys.
    // The global anonymous backup limit (40 calls) provides a second layer.
    // If this test becomes flaky, consider seeding rate_limit entries directly to
    // guarantee the limit is hit deterministically.

    // Verify that rate_limits table has entries showing calls were tracked
    const { data: rateLimitEntries } = await supabaseAdmin
      .from('rate_limits')
      .select('function_name, call_count, created_at')
      .like('function_name', '%verify_coupon%');

    expect(rateLimitEntries).not.toBeNull();
    expect(rateLimitEntries!.length).toBeGreaterThan(0);
    expect(rateLimitEntries!.length).toBeGreaterThanOrEqual(1);
  });

  it('returns valid coupon details on success', async () => {
    // Clear rate limits before this test
    await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');

    const email = `valid-full-${TS}@example.com`;
    const product = await createProduct();
    const coupon = await createCoupon({
      code: `VALID-FULL-${TS}`,
      discount_type: 'percentage',
      discount_value: 15,
      exclude_order_bumps: true,
      allowed_emails: [],
      allowed_product_ids: [],
    });

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      customer_email_param: email,
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(true);
    expect(data.code).toBe(coupon.code);
    expect(data.discount_type).toBe('percentage');
    expect(data.discount_value).toBe(15);
    expect(data.exclude_order_bumps).toBe(true);

    // Verify reservation was created as a side effect of valid verification
    const { data: reservations } = await supabaseAdmin
      .from('coupon_reservations')
      .select('coupon_id, customer_email')
      .eq('coupon_id', coupon.id);

    expect(reservations).not.toBeNull();
    expect(reservations!.length).toBeGreaterThanOrEqual(1);
  });

  it('validates email format and rejects non-printable characters', async () => {
    // Clear rate limits
    await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');

    const product = await createProduct();
    const coupon = await createCoupon({
      code: `EMAIL-FORMAT-${TS}`,
      allowed_emails: [],
      allowed_product_ids: [],
    });

    // Non-printable control character (backspace \x08) in email
    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      customer_email_param: 'test\x08@example.com',
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Invalid email format');
  });

  it('rejects empty email string', async () => {
    // Clear rate limits
    await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');

    const product = await createProduct();
    const coupon = await createCoupon({
      code: `EMPTY-EMAIL-${TS}`,
      allowed_emails: [],
      allowed_product_ids: [],
    });

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      customer_email_param: '',
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Invalid email');
  });

  it('rejects coupon when per-user usage limit is exceeded', async () => {
    // Clear rate limits
    await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');

    const email = `per-user-limit-${TS}@example.com`;
    const product = await createProduct();
    const coupon = await createCoupon({
      code: `PER-USER-LIMIT-${TS}`,
      usage_limit_per_user: 1,
      allowed_emails: [],
      allowed_product_ids: [],
    });

    // First call should be valid
    const { data: first, error: firstError } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      customer_email_param: email,
    });

    expect(firstError).toBeNull();
    expect(first.valid).toBe(true);

    // Simulate a redemption for this user to exhaust the per-user limit
    const { error: redemptionErr } = await supabaseAdmin.from('coupon_redemptions').insert({
      coupon_id: coupon.id,
      customer_email: email,
      discount_amount: 10,
    });
    if (redemptionErr) throw new Error(`Failed to insert redemption: ${redemptionErr.message}`);

    // Second call for the same user should be rejected
    const { data: second, error: secondError } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      customer_email_param: email,
    });

    expect(secondError).toBeNull();
    expect(second.valid).toBe(false);
    expect(second.error).toBe('You have already used this code');
  });

  it('handles reservation re-use (already_reserved path) gracefully', async () => {
    // Clear rate limits
    await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');

    const email = `reservation-reuse-${TS}@example.com`;
    const product = await createProduct();
    const coupon = await createCoupon({
      code: `RESERVATION-REUSE-${TS}`,
      allowed_emails: [],
      allowed_product_ids: [],
    });

    // First verify call - creates a reservation
    const { data: first, error: firstError } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      customer_email_param: email,
    });

    expect(firstError).toBeNull();
    expect(first.valid).toBe(true);

    // Count reservations after first call
    const { data: reservationsAfterFirst } = await supabaseAdmin
      .from('coupon_reservations')
      .select('id')
      .eq('coupon_id', coupon.id);

    const countAfterFirst = reservationsAfterFirst?.length ?? 0;

    // Second verify call for the same coupon+product+email - should still be valid
    const { data: second, error: secondError } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      customer_email_param: email,
    });

    expect(secondError).toBeNull();
    expect(second.valid).toBe(true);
    expect(second.code).toBe(coupon.code);

    // Verify reservation count did not grow uncontrollably (reused or at most +1)
    const { data: reservationsAfterSecond } = await supabaseAdmin
      .from('coupon_reservations')
      .select('id')
      .eq('coupon_id', coupon.id);

    const countAfterSecond = reservationsAfterSecond?.length ?? 0;
    // Should either reuse the existing reservation or create at most one more
    expect(countAfterSecond).toBeLessThanOrEqual(countAfterFirst + 1);
  });

  it('rejects SQL injection attempts in coupon code parameter', async () => {
    // Clear rate limits
    await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');

    const product = await createProduct();

    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: "'; DROP TABLE coupons; --",
      product_id_param: product.id,
      customer_email_param: "test@example.com",
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);

    // Verify coupons table still exists by querying it
    const { error: tableCheckError } = await supabaseAdmin
      .from('coupons')
      .select('id')
      .limit(1);
    expect(tableCheckError).toBeNull();
  });

  it('rejects SQL injection attempts in email parameter', async () => {
    // Clear rate limits
    await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');

    const safeEmail = `sqli-safe-${TS}@example.com`;
    const product = await createProduct();
    // Use allowed_emails restriction so the email actually matters for validation
    const coupon = await createCoupon({
      code: `SQLI-EMAIL-${TS}`,
      allowed_emails: [safeEmail],
      allowed_product_ids: [],
    });

    // SQL injection attempt should not bypass email restriction
    const { data, error } = await supabaseAdmin.rpc('verify_coupon', {
      code_param: coupon.code,
      product_id_param: product.id,
      customer_email_param: `${safeEmail}' OR '1'='1`,
    });

    expect(error).toBeNull();
    expect(data.valid).toBe(false);

    // Verify coupons table still exists
    const { error: tableCheckError } = await supabaseAdmin
      .from('coupons')
      .select('id')
      .limit(1);
    expect(tableCheckError).toBeNull();
  });
});

// ============================================================================
// increment_sale_quantity_sold
// ============================================================================

describe('increment_sale_quantity_sold', () => {
  it('increments sale_quantity_sold for a product with active sale', async () => {
    const product = await createProduct({
      sale_price: 50,
      sale_price_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      sale_quantity_limit: 10,
      sale_quantity_sold: 0,
    });

    const { data: result, error } = await supabaseAdmin.rpc(
      'increment_sale_quantity_sold',
      { p_product_id: product.id }
    );

    expect(error).toBeNull();
    expect(result).toBe(true);

    // Verify the counter was incremented
    const { data: updated } = await supabaseAdmin
      .from('products')
      .select('sale_quantity_sold')
      .eq('id', product.id)
      .single();

    expect(updated!.sale_quantity_sold).toBe(1);
  });

  it('returns false for product without sale_price', async () => {
    const product = await createProduct({
      sale_price: null,
      sale_quantity_sold: 0,
    });

    const { data: result, error } = await supabaseAdmin.rpc(
      'increment_sale_quantity_sold',
      { p_product_id: product.id }
    );

    expect(error).toBeNull();
    expect(result).toBe(false);

    // Verify counter was NOT incremented
    const { data: after } = await supabaseAdmin
      .from('products')
      .select('sale_quantity_sold')
      .eq('id', product.id)
      .single();
    expect(after!.sale_quantity_sold).toBe(0);
  });

  it('returns false when sale has expired (sale_price_until in past)', async () => {
    const product = await createProduct({
      sale_price: 50,
      sale_price_until: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      sale_quantity_sold: 0,
    });

    const { data: result, error } = await supabaseAdmin.rpc(
      'increment_sale_quantity_sold',
      { p_product_id: product.id }
    );

    expect(error).toBeNull();
    expect(result).toBe(false);

    // Verify counter was NOT incremented
    const { data: after } = await supabaseAdmin
      .from('products')
      .select('sale_quantity_sold')
      .eq('id', product.id)
      .single();
    expect(after!.sale_quantity_sold).toBe(0);
  });

  it('returns false when sale quantity limit is reached', async () => {
    const product = await createProduct({
      sale_price: 50,
      sale_price_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      sale_quantity_limit: 5,
      sale_quantity_sold: 5,
    });

    const { data: result, error } = await supabaseAdmin.rpc(
      'increment_sale_quantity_sold',
      { p_product_id: product.id }
    );

    expect(error).toBeNull();
    expect(result).toBe(false);

    // Verify counter was NOT incremented (still at the limit, not beyond)
    const { data: after } = await supabaseAdmin
      .from('products')
      .select('sale_quantity_sold')
      .eq('id', product.id)
      .single();
    expect(after!.sale_quantity_sold).toBe(5);
  });

  it('works with no quantity limit (sale_quantity_limit = null)', async () => {
    const product = await createProduct({
      sale_price: 50,
      sale_quantity_limit: null,
      sale_quantity_sold: 0,
    });

    // Read current value before increment
    const { data: before } = await supabaseAdmin
      .from('products')
      .select('sale_quantity_sold')
      .eq('id', product.id)
      .single();
    expect(before!.sale_quantity_sold).toBe(0);

    const { data: result, error } = await supabaseAdmin.rpc(
      'increment_sale_quantity_sold',
      { p_product_id: product.id }
    );

    expect(error).toBeNull();
    expect(result).toBe(true);

    // Verify counter was actually incremented
    const { data: after } = await supabaseAdmin
      .from('products')
      .select('sale_quantity_sold')
      .eq('id', product.id)
      .single();
    expect(after!.sale_quantity_sold).toBe(before!.sale_quantity_sold + 1);
  });

  it('works with no time limit (sale_price_until = null)', async () => {
    const product = await createProduct({
      sale_price: 50,
      sale_price_until: null,
      sale_quantity_limit: null,
      sale_quantity_sold: 0,
    });

    // Read current value before increment
    const { data: before } = await supabaseAdmin
      .from('products')
      .select('sale_quantity_sold')
      .eq('id', product.id)
      .single();
    expect(before!.sale_quantity_sold).toBe(0);

    const { data: result, error } = await supabaseAdmin.rpc(
      'increment_sale_quantity_sold',
      { p_product_id: product.id }
    );

    expect(error).toBeNull();
    expect(result).toBe(true);

    // Verify counter was actually incremented
    const { data: after } = await supabaseAdmin
      .from('products')
      .select('sale_quantity_sold')
      .eq('id', product.id)
      .single();
    expect(after!.sale_quantity_sold).toBe(before!.sale_quantity_sold + 1);
  });

  it('returns false for non-existent product_id', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const { data: result, error } = await supabaseAdmin.rpc(
      'increment_sale_quantity_sold',
      { p_product_id: fakeId }
    );

    expect(error).toBeNull();
    expect(result).toBe(false);
  });

  it('increments multiple times correctly', async () => {
    const product = await createProduct({
      sale_price: 50,
      sale_quantity_limit: 10,
      sale_quantity_sold: 0,
    });

    // Increment 3 times
    for (let i = 0; i < 3; i++) {
      await supabaseAdmin.rpc('increment_sale_quantity_sold', {
        p_product_id: product.id,
      });
    }

    const { data: updated } = await supabaseAdmin
      .from('products')
      .select('sale_quantity_sold')
      .eq('id', product.id)
      .single();

    expect(updated!.sale_quantity_sold).toBe(3);
  });

  it('stops incrementing at the quantity limit boundary', async () => {
    const product = await createProduct({
      sale_price: 50,
      sale_quantity_limit: 2,
      sale_quantity_sold: 1,
    });

    // First increment should succeed (1 -> 2)
    const { data: r1 } = await supabaseAdmin.rpc('increment_sale_quantity_sold', {
      p_product_id: product.id,
    });
    expect(r1).toBe(true);

    // Second increment should fail (at limit)
    const { data: r2 } = await supabaseAdmin.rpc('increment_sale_quantity_sold', {
      p_product_id: product.id,
    });
    expect(r2).toBe(false);

    // Verify final count
    const { data: updated } = await supabaseAdmin
      .from('products')
      .select('sale_quantity_sold')
      .eq('id', product.id)
      .single();

    expect(updated!.sale_quantity_sold).toBe(2);
  });
});
