/**
 * ============================================================================
 * SECURITY TEST: get_oto_coupon_info RPC
 * ============================================================================
 *
 * Tests all branches of the OTO coupon lookup database function.
 * Uses service_role Supabase client to call RPC directly.
 *
 * Covered scenarios:
 * 1. Valid OTO coupon lookup (returns offer details)
 * 2. Expired coupon code
 * 3. Coupon for wrong email
 * 4. Non-existent coupon code
 * 5. Null parameters
 * 6. Used coupon (usage_count >= limit)
 * 7. Inactive coupon
 *
 * @see supabase/migrations/20251230000000_oto_system.sql
 * ============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

/** Unique suffix to avoid collisions between test runs */
const TS = Date.now();

// ============================================================================
// Shared test data
// ============================================================================

let sourceProduct: { id: string };
let otoProduct: { id: string; price: number; slug: string; name: string; currency: string };
let otoOffer: { id: string; duration_minutes: number };
let validCoupon: { id: string; code: string; expires_at: string };
let expiredCoupon: { id: string; code: string };
let usedCoupon: { id: string; code: string };
let inactiveCoupon: { id: string; code: string };

const testEmail = `oto-test-${TS}@example.com`;
const expiredEmail = `oto-expired-${TS}@example.com`;
const usedEmail = `oto-used-${TS}@example.com`;
const inactiveEmail = `oto-inactive-${TS}@example.com`;
const wrongEmail = `wrong-${TS}@example.com`;

// IDs to clean up
const createdProductIds: string[] = [];
const createdCouponIds: string[] = [];
let createdOtoOfferId: string | null = null;

// ============================================================================
// Setup & Teardown
// ============================================================================

beforeAll(async () => {
  // Clear rate limits
  await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');

  // --- Source product ---
  const { data: sp, error: spErr } = await supabaseAdmin
    .from('products')
    .insert({
      name: `OTO Source ${TS}`,
      slug: `oto-source-${TS}`,
      price: 50.0,
      currency: 'USD',
      is_active: true,
    })
    .select()
    .single();
  if (spErr) throw spErr;
  sourceProduct = { id: sp.id };
  createdProductIds.push(sp.id);

  // --- OTO target product ---
  const { data: op, error: opErr } = await supabaseAdmin
    .from('products')
    .insert({
      name: `OTO Target ${TS}`,
      slug: `oto-target-${TS}`,
      price: 99.0,
      currency: 'USD',
      is_active: true,
    })
    .select()
    .single();
  if (opErr) throw opErr;
  otoProduct = { id: op.id, price: op.price, slug: op.slug, name: op.name, currency: op.currency };
  createdProductIds.push(op.id);

  // --- OTO offer ---
  const { data: oo, error: ooErr } = await supabaseAdmin
    .from('oto_offers')
    .insert({
      source_product_id: sourceProduct.id,
      oto_product_id: otoProduct.id,
      discount_type: 'percentage',
      discount_value: 30,
      duration_minutes: 15,
      is_active: true,
    })
    .select()
    .single();
  if (ooErr) throw ooErr;
  otoOffer = { id: oo.id, duration_minutes: oo.duration_minutes };
  createdOtoOfferId = oo.id;

  // --- Valid OTO coupon (expires in 30 minutes) ---
  const validExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { data: vc, error: vcErr } = await supabaseAdmin
    .from('coupons')
    .insert({
      code: `OTO-VALID-${TS}`,
      name: `OTO: ${testEmail}`,
      discount_type: 'percentage',
      discount_value: 30,
      allowed_emails: [testEmail],
      allowed_product_ids: [otoProduct.id],
      usage_limit_global: 1,
      usage_limit_per_user: 1,
      current_usage_count: 0,
      expires_at: validExpiresAt,
      is_active: true,
      is_oto_coupon: true,
      oto_offer_id: otoOffer.id,
    })
    .select()
    .single();
  if (vcErr) throw vcErr;
  validCoupon = { id: vc.id, code: vc.code, expires_at: vc.expires_at };
  createdCouponIds.push(vc.id);

  // --- Expired OTO coupon (different email to avoid unique index conflict) ---
  const expiredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: ec, error: ecErr } = await supabaseAdmin
    .from('coupons')
    .insert({
      code: `OTO-EXPIRED-${TS}`,
      name: `OTO expired: ${expiredEmail}`,
      discount_type: 'percentage',
      discount_value: 30,
      allowed_emails: [expiredEmail],
      allowed_product_ids: [otoProduct.id],
      usage_limit_global: 1,
      usage_limit_per_user: 1,
      current_usage_count: 0,
      expires_at: expiredAt,
      is_active: true,
      is_oto_coupon: true,
      oto_offer_id: otoOffer.id,
    })
    .select()
    .single();
  if (ecErr) throw ecErr;
  expiredCoupon = { id: ec.id, code: ec.code };
  createdCouponIds.push(ec.id);

  // --- Used OTO coupon (usage_count >= limit, different email) ---
  const usedExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { data: uc, error: ucErr } = await supabaseAdmin
    .from('coupons')
    .insert({
      code: `OTO-USED-${TS}`,
      name: `OTO used: ${usedEmail}`,
      discount_type: 'percentage',
      discount_value: 30,
      allowed_emails: [usedEmail],
      allowed_product_ids: [otoProduct.id],
      usage_limit_global: 1,
      usage_limit_per_user: 1,
      current_usage_count: 1,
      expires_at: usedExpiresAt,
      is_active: true,
      is_oto_coupon: true,
      oto_offer_id: otoOffer.id,
    })
    .select()
    .single();
  if (ucErr) throw ucErr;
  usedCoupon = { id: uc.id, code: uc.code };
  createdCouponIds.push(uc.id);

  // --- Inactive OTO coupon (different email) ---
  const inactiveExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { data: ic, error: icErr } = await supabaseAdmin
    .from('coupons')
    .insert({
      code: `OTO-INACTIVE-${TS}`,
      name: `OTO inactive: ${inactiveEmail}`,
      discount_type: 'percentage',
      discount_value: 30,
      allowed_emails: [inactiveEmail],
      allowed_product_ids: [otoProduct.id],
      usage_limit_global: 1,
      usage_limit_per_user: 1,
      current_usage_count: 0,
      expires_at: inactiveExpiresAt,
      is_active: false,
      is_oto_coupon: true,
      oto_offer_id: otoOffer.id,
    })
    .select()
    .single();
  if (icErr) throw icErr;
  inactiveCoupon = { id: ic.id, code: ic.code };
  createdCouponIds.push(ic.id);
});

afterAll(async () => {
  // Clean up in dependency order
  for (const cid of createdCouponIds) {
    await supabaseAdmin.from('coupon_redemptions').delete().eq('coupon_id', cid);
    await supabaseAdmin.from('coupon_reservations').delete().eq('coupon_id', cid);
    await supabaseAdmin.from('coupons').delete().eq('id', cid);
  }
  if (createdOtoOfferId) {
    await supabaseAdmin.from('oto_offers').delete().eq('id', createdOtoOfferId);
  }
  for (const pid of createdProductIds) {
    await supabaseAdmin.from('products').delete().eq('id', pid);
  }
});

// ============================================================================
// 1. Valid OTO coupon lookup
// ============================================================================

describe('Valid OTO coupon lookup', () => {
  it('should return offer details for valid coupon and matching email', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_oto_coupon_info', {
      coupon_code_param: validCoupon.code,
      email_param: testEmail,
    });

    expect(error).toBeFalsy();
    expect(data).toBeTruthy();
    expect(data.valid).toBe(true);
    expect(data.coupon_id).toBe(validCoupon.id);
    expect(data.code).toBe(validCoupon.code);
    expect(data.discount_type).toBe('percentage');
    expect(data.discount_value).toBe(30);
    expect(data.seconds_remaining).toBeGreaterThan(0);
    expect(data.duration_minutes).toBe(15);

    // Check nested product info
    expect(data.product).toBeTruthy();
    expect(data.product.id).toBe(otoProduct.id);
    expect(data.product.slug).toBe(otoProduct.slug);
    expect(data.product.name).toBe(otoProduct.name);
    expect(data.product.price).toBe(otoProduct.price);
    expect(data.product.currency).toBe(otoProduct.currency);
  });
});

// ============================================================================
// 2. Expired coupon code
// ============================================================================

describe('Expired coupon code', () => {
  it('should return valid=false for expired OTO coupon', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_oto_coupon_info', {
      coupon_code_param: expiredCoupon.code,
      email_param: expiredEmail,
    });

    expect(error).toBeFalsy();
    expect(data).toBeTruthy();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Coupon not found or expired');
  });
});

// ============================================================================
// 3. Coupon for wrong email
// ============================================================================

describe('Coupon for wrong email', () => {
  it('should return valid=false when email does not match allowed_emails', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_oto_coupon_info', {
      coupon_code_param: validCoupon.code,
      email_param: wrongEmail,
    });

    expect(error).toBeFalsy();
    expect(data).toBeTruthy();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Coupon not found or expired');
  });
});

// ============================================================================
// 4. Non-existent coupon code
// ============================================================================

describe('Non-existent coupon code', () => {
  it('should return valid=false for a code that does not exist', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_oto_coupon_info', {
      coupon_code_param: `OTO-NONEXISTENT-${TS}`,
      email_param: testEmail,
    });

    expect(error).toBeFalsy();
    expect(data).toBeTruthy();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Coupon not found or expired');
  });
});

// ============================================================================
// 5. Null parameters
// ============================================================================

describe('Null parameters', () => {
  it('should return valid=false when coupon_code_param is null', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_oto_coupon_info', {
      coupon_code_param: null as unknown as string,
      email_param: testEmail,
    });

    // Null code won't match any row -> valid=false
    if (data) {
      expect(data.valid).toBe(false);
    } else {
      // Could also be a DB error for null input
      expect(error).toBeTruthy();
    }
  });

  it('should return valid=false when email_param is null', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_oto_coupon_info', {
      coupon_code_param: validCoupon.code,
      email_param: null as unknown as string,
    });

    // Null email won't match allowed_emails -> valid=false
    if (data) {
      expect(data.valid).toBe(false);
    } else {
      expect(error).toBeTruthy();
    }
  });
});

// ============================================================================
// 6. Used coupon (usage_count >= limit)
// ============================================================================

describe('Used coupon', () => {
  it('should return valid=false when coupon usage count has reached the limit', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_oto_coupon_info', {
      coupon_code_param: usedCoupon.code,
      email_param: usedEmail,
    });

    expect(error).toBeFalsy();
    expect(data).toBeTruthy();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Coupon not found or expired');
  });
});

// ============================================================================
// 7. Inactive coupon
// ============================================================================

describe('Inactive coupon', () => {
  it('should return valid=false for inactive OTO coupon', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_oto_coupon_info', {
      coupon_code_param: inactiveCoupon.code,
      email_param: inactiveEmail,
    });

    expect(error).toBeFalsy();
    expect(data).toBeTruthy();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Coupon not found or expired');
  });
});
