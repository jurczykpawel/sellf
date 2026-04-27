/**
 * ============================================================================
 * SECURITY TEST: get_oto_coupon_info RPC
 * ============================================================================
 *
 * Tests all branches of the OTO coupon lookup database function.
 * Uses service_role Supabase client to call RPC directly, plus anon client
 * for permission/RLS regression tests.
 *
 * Covered scenarios:
 *  1. Valid OTO coupon lookup (returns offer details)
 *  2. Expired coupon code
 *  3. Coupon for wrong email
 *  4. Non-existent coupon code
 *  5. Null parameters
 *  6. Used coupon (usage_count >= limit)
 *  7. Inactive coupon
 *  8. Anon user access (permission test)
 *  9. Regular (non-OTO) coupon excluded by is_oto_coupon filter
 * 10. OTO coupon with deleted/missing offer (LEFT JOIN NULL product data)
 * 11. Fixed discount type coupon
 *
 * @see supabase/migrations/20251230000000_oto_system.sql
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
// Shared test data
// ============================================================================

let sourceProduct: { id: string };
let otoProduct: { id: string; price: number; slug: string; name: string; currency: string };
let otoOffer: { id: string; duration_minutes: number };
let validCoupon: { id: string; code: string; expires_at: string };
let expiredCoupon: { id: string; code: string };
let usedCoupon: { id: string; code: string };
let inactiveCoupon: { id: string; code: string };
let regularCoupon: { id: string; code: string };
let orphanedOtoCoupon: { id: string; code: string };
let fixedDiscountCoupon: { id: string; code: string };

const testEmail = `oto-test-${TS}@example.com`;
const expiredEmail = `oto-expired-${TS}@example.com`;
const usedEmail = `oto-used-${TS}@example.com`;
const inactiveEmail = `oto-inactive-${TS}@example.com`;
const wrongEmail = `wrong-${TS}@example.com`;
const regularEmail = `oto-regular-${TS}@example.com`;
const orphanedEmail = `oto-orphaned-${TS}@example.com`;
const fixedEmail = `oto-fixed-${TS}@example.com`;

// IDs to clean up
const createdProductIds: string[] = [];
const createdCouponIds: string[] = [];
const createdOtoOfferIds: string[] = [];

// ============================================================================
// Setup & Teardown
// ============================================================================

beforeAll(async () => {
  // Clear rate limits scoped to this function only (not global nuke)
  await supabaseAdmin.from('rate_limits').delete().like('function_name', '%get_oto_coupon_info%');

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
  createdOtoOfferIds.push(oo.id);

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

  // --- Regular (non-OTO) coupon: is_oto_coupon = false, otherwise matches all OTO criteria ---
  const regularExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { data: rc, error: rcErr } = await supabaseAdmin
    .from('coupons')
    .insert({
      code: `OTO-REGULAR-${TS}`,
      name: `Regular coupon: ${regularEmail}`,
      discount_type: 'percentage',
      discount_value: 30,
      allowed_emails: [regularEmail],
      allowed_product_ids: [otoProduct.id],
      usage_limit_global: 1,
      usage_limit_per_user: 1,
      current_usage_count: 0,
      expires_at: regularExpiresAt,
      is_active: true,
      is_oto_coupon: false,
      oto_offer_id: otoOffer.id,
    })
    .select()
    .single();
  if (rcErr) throw rcErr;
  regularCoupon = { id: rc.id, code: rc.code };
  createdCouponIds.push(rc.id);

  // --- OTO coupon pointing to non-existent offer (orphaned) ---
  // Create a separate product for the orphaned offer to avoid unique_oto_pair conflict
  const { data: orphanSourceProduct, error: ospErr } = await supabaseAdmin
    .from('products')
    .insert({
      name: `OTO Orphan Source ${TS}`,
      slug: `oto-orphan-source-${TS}`,
      price: 25.0,
      currency: 'USD',
      is_active: true,
    })
    .select()
    .single();
  if (ospErr) throw ospErr;
  createdProductIds.push(orphanSourceProduct.id);

  // Create a temporary offer with different source product, get its ID, then delete it
  const { data: tmpOffer, error: tmpOfferErr } = await supabaseAdmin
    .from('oto_offers')
    .insert({
      source_product_id: orphanSourceProduct.id,
      oto_product_id: otoProduct.id,
      discount_type: 'percentage',
      discount_value: 10,
      duration_minutes: 5,
      is_active: true,
    })
    .select()
    .single();
  if (tmpOfferErr) throw tmpOfferErr;
  const orphanedOfferId = tmpOffer.id;

  const orphanedExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { data: oc, error: ocErr } = await supabaseAdmin
    .from('coupons')
    .insert({
      code: `OTO-ORPHANED-${TS}`,
      name: `OTO orphaned: ${orphanedEmail}`,
      discount_type: 'percentage',
      discount_value: 10,
      allowed_emails: [orphanedEmail],
      allowed_product_ids: [otoProduct.id],
      usage_limit_global: 1,
      usage_limit_per_user: 1,
      current_usage_count: 0,
      expires_at: orphanedExpiresAt,
      is_active: true,
      is_oto_coupon: true,
      oto_offer_id: orphanedOfferId,
    })
    .select()
    .single();
  if (ocErr) throw ocErr;
  orphanedOtoCoupon = { id: oc.id, code: oc.code };
  createdCouponIds.push(oc.id);

  // Delete the offer so the LEFT JOIN returns NULL product data
  await supabaseAdmin.from('oto_offers').delete().eq('id', orphanedOfferId);

  // --- Fixed discount OTO coupon ---
  const fixedExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { data: fc, error: fcErr } = await supabaseAdmin
    .from('coupons')
    .insert({
      code: `OTO-FIXED-${TS}`,
      name: `OTO fixed: ${fixedEmail}`,
      discount_type: 'fixed',
      discount_value: 15,
      allowed_emails: [fixedEmail],
      allowed_product_ids: [otoProduct.id],
      usage_limit_global: 1,
      usage_limit_per_user: 1,
      current_usage_count: 0,
      expires_at: fixedExpiresAt,
      is_active: true,
      is_oto_coupon: true,
      oto_offer_id: otoOffer.id,
    })
    .select()
    .single();
  if (fcErr) throw fcErr;
  fixedDiscountCoupon = { id: fc.id, code: fc.code };
  createdCouponIds.push(fc.id);
});

afterAll(async () => {
  // Clean up in dependency order; ignore errors from partial beforeAll failure
  for (const cid of createdCouponIds) {
    try { await supabaseAdmin.from('coupon_redemptions').delete().eq('coupon_id', cid); } catch {}
    try { await supabaseAdmin.from('coupon_reservations').delete().eq('coupon_id', cid); } catch {}
    try { await supabaseAdmin.from('coupons').delete().eq('id', cid); } catch {}
  }
  for (const oid of createdOtoOfferIds) {
    try { await supabaseAdmin.from('oto_offers').delete().eq('id', oid); } catch {}
  }
  for (const pid of createdProductIds) {
    try { await supabaseAdmin.from('products').delete().eq('id', pid); } catch {}
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
    // Upper-bound: seconds_remaining must not exceed the coupon's total lifetime (30 min = 1800s)
    expect(data.seconds_remaining).toBeLessThanOrEqual(30 * 60);
    expect(data.expires_at).toBe(validCoupon.expires_at);
    expect(data.duration_minutes).toBe(15);

    // Check nested product info
    expect(data.product).toBeTruthy();
    expect(data.product.id).toBe(otoProduct.id);
    expect(data.product.slug).toBe(otoProduct.slug);
    expect(data.product.name).toBe(otoProduct.name);
    expect(data.product.price).toBe(otoProduct.price);
    expect(data.product.currency).toBe(otoProduct.currency);

    // Assert no unexpected extra fields in response
    const expectedTopLevelKeys = [
      'valid', 'coupon_id', 'code', 'discount_type', 'discount_value',
      'allowed_product_ids', 'exclude_order_bumps', 'expires_at',
      'seconds_remaining', 'duration_minutes', 'product',
    ];
    expect(Object.keys(data).sort()).toEqual(expectedTopLevelKeys.sort());

    const expectedProductKeys = ['id', 'slug', 'name', 'price', 'currency'];
    expect(Object.keys(data.product).sort()).toEqual(expectedProductKeys.sort());
  });
});

// ============================================================================
// 2. Expired coupon code
// ============================================================================
//
// NOTE: All negative tests below assert the same error string 'Coupon not found
// or expired'. This is a design limitation of get_oto_coupon_info — the function
// uses a single SELECT with all conditions in the WHERE clause (code, is_active,
// expires_at > NOW(), usage_count < limit, allowed_emails). When any condition
// fails, the row is simply not found, so the function cannot distinguish between
// "expired", "wrong email", "used up", "inactive", or "non-existent". This means
// we cannot independently verify that each WHERE condition works in isolation.
// If the function is refactored to return specific error codes per failure mode,
// these tests should be updated to assert the individual error strings.
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

    // Null code won't match any row in the WHERE clause -> valid=false
    expect(error).toBeFalsy();
    expect(data).toBeTruthy();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Coupon not found or expired');
  });

  it('should return valid=false when email_param is null', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_oto_coupon_info', {
      coupon_code_param: validCoupon.code,
      email_param: null as unknown as string,
    });

    // Null email won't match allowed_emails (jsonb ? operator) -> valid=false
    expect(error).toBeFalsy();
    expect(data).toBeTruthy();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Coupon not found or expired');
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

// ============================================================================
// 8. Anon user access (permission test)
// ============================================================================

describe('Anon user access', () => {
  it('anon users can call get_oto_coupon_info (public-facing function)', async () => {
    // get_oto_coupon_info is intentionally granted to anon, authenticated, and service_role.
    // It is a public-facing function used by the frontend to display OTO timer/details.
    // Security is enforced at the data level (coupon must match email, be active, not expired).
    const { data, error } = await supabaseAnon.rpc('get_oto_coupon_info', {
      coupon_code_param: validCoupon.code,
      email_param: testEmail,
    });

    expect(error).toBeFalsy();
    expect(data).toBeTruthy();
    // Assert full response shape — anon gets the same fields as service_role
    expect(data.valid).toBe(true);
    expect(data.coupon_id).toBe(validCoupon.id);
    expect(data.code).toBe(validCoupon.code);
    expect(data.discount_type).toBe('percentage');
    expect(data.discount_value).toBe(30);
    expect(data.seconds_remaining).toBeGreaterThan(0);
    expect(data.seconds_remaining).toBeLessThanOrEqual(30 * 60);
    expect(data.expires_at).toBe(validCoupon.expires_at);
    expect(data.duration_minutes).toBe(15);
    expect(data.product).toBeTruthy();
    expect(data.product.id).toBe(otoProduct.id);
    expect(data.product.slug).toBe(otoProduct.slug);
    expect(data.product.name).toBe(otoProduct.name);
    expect(data.product.price).toBe(otoProduct.price);
    expect(data.product.currency).toBe(otoProduct.currency);
  });

  it('anon users get valid=false for non-matching email (data-level security)', async () => {
    const { data, error } = await supabaseAnon.rpc('get_oto_coupon_info', {
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
// 9. Regular (non-OTO) coupon excluded by is_oto_coupon filter
// ============================================================================

describe('Regular coupon excluded by is_oto_coupon filter', () => {
  it('should return valid=false for a coupon with is_oto_coupon=false even if all other criteria match', async () => {
    // This coupon has: valid dates, is_active=true, matching email, matching product,
    // usage_count < limit, and an oto_offer_id. The ONLY difference is is_oto_coupon=false.
    // If the is_oto_coupon filter were removed from the SQL, this would return valid=true.
    const { data, error } = await supabaseAdmin.rpc('get_oto_coupon_info', {
      coupon_code_param: regularCoupon.code,
      email_param: regularEmail,
    });

    expect(error).toBeFalsy();
    expect(data).toBeTruthy();
    expect(data.valid).toBe(false);
    expect(data.error).toBe('Coupon not found or expired');
  });
});

// ============================================================================
// 10. OTO coupon with deleted offer (LEFT JOIN returns NULL product data)
// ============================================================================

describe('OTO coupon with deleted offer (orphaned oto_offer_id)', () => {
  it('should return valid=true with null product fields when the linked offer has been deleted', async () => {
    // The SQL uses LEFT JOIN on oto_offers and products. When the offer is deleted,
    // the coupon row is still found (WHERE conditions are on coupons table only),
    // but all joined fields (duration_minutes, product.*) will be NULL.
    const { data, error } = await supabaseAdmin.rpc('get_oto_coupon_info', {
      coupon_code_param: orphanedOtoCoupon.code,
      email_param: orphanedEmail,
    });

    expect(error).toBeFalsy();
    expect(data).toBeTruthy();

    // The function returns valid=true because the coupon itself passes all WHERE filters.
    // This documents the current behavior: a deleted offer does NOT invalidate the coupon
    // at the get_oto_coupon_info level. The product fields will be null.
    expect(data.valid).toBe(true);
    expect(data.coupon_id).toBe(orphanedOtoCoupon.id);
    expect(data.code).toBe(orphanedOtoCoupon.code);
    expect(data.seconds_remaining).toBeGreaterThan(0);

    // LEFT JOIN produces null for all offer/product columns
    expect(data.duration_minutes).toBeNull();
    expect(data.product).toBeTruthy();
    expect(data.product.id).toBeNull();
    expect(data.product.slug).toBeNull();
    expect(data.product.name).toBeNull();
    expect(data.product.price).toBeNull();
    expect(data.product.currency).toBeNull();
  });
});

// ============================================================================
// 11. Fixed discount type coupon
// ============================================================================

describe('Fixed discount type coupon', () => {
  it('should return correct discount_type and discount_value for a fixed-amount OTO coupon', async () => {
    const { data, error } = await supabaseAdmin.rpc('get_oto_coupon_info', {
      coupon_code_param: fixedDiscountCoupon.code,
      email_param: fixedEmail,
    });

    expect(error).toBeFalsy();
    expect(data).toBeTruthy();
    expect(data.valid).toBe(true);
    expect(data.coupon_id).toBe(fixedDiscountCoupon.id);
    expect(data.discount_type).toBe('fixed');
    expect(data.discount_value).toBe(15);
    expect(data.seconds_remaining).toBeGreaterThan(0);
    expect(data.product).toBeTruthy();
    expect(data.product.id).toBe(otoProduct.id);
  });
});
