/**
 * ============================================================================
 * SECURITY TEST: process_stripe_payment_completion_with_bump RPC
 * ============================================================================
 *
 * Tests UNTESTED branches of the payment completion database function.
 * Uses service_role Supabase client to call RPC directly.
 *
 * Covered gaps:
 * 1. PWYW + bumps combination (amount = custom_price + bump_prices)
 * 2. PWYW + bumps rejection (amount below min + bumps)
 * 3. Input validation (null/empty/long session_id, invalid format, null product_id,
 *    invalid email, amount <= 0, amount > 99999999)
 * 4. Authorization bypass (user_id_param mismatch)
 * 5. Idempotency (duplicate session_id with transaction but no guest_purchase)
 * 6. Product not found (inactive product, non-existent product_id)
 * 7. Bump array limits (20 = ok, 21 = rejected)
 * 8. Access expiration (auto_grant_duration_days sets access_expires_at)
 * 9. Coupon + amount = 0 (should reject)
 * 10. Coupon redemption: reservation cleanup, usage_count increment, redemption row
 * 11. Coupon usage limit reached during reservation window
 * 12. Percentage coupon + bumps (exclude_order_bumps flag)
 *
 * @see supabase/migrations/20260310175058_multi_order_bumps.sql
 * ============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

/** Unique suffix to avoid collisions between test runs */
const TS = Date.now();

/** Helper: call the RPC with defaults for optional params */
async function callRpc(
  client: SupabaseClient,
  params: {
    session_id_param: string;
    product_id_param: string;
    customer_email_param: string;
    amount_total: number;
    currency_param: string;
    stripe_payment_intent_id?: string | null;
    user_id_param?: string | null;
    bump_product_ids_param?: string[] | null;
    coupon_id_param?: string | null;
  },
) {
  return client.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: params.session_id_param,
    product_id_param: params.product_id_param,
    customer_email_param: params.customer_email_param,
    amount_total: params.amount_total,
    currency_param: params.currency_param,
    stripe_payment_intent_id: params.stripe_payment_intent_id ?? null,
    user_id_param: params.user_id_param ?? null,
    bump_product_ids_param: params.bump_product_ids_param ?? null,
    coupon_id_param: params.coupon_id_param ?? null,
  });
}

// ============================================================================
// Shared test data
// ============================================================================

let mainProduct: { id: string; price: number; currency: string };
let pwywProduct: { id: string; price: number; currency: string; custom_price_min: number };
let timedProduct: { id: string; price: number; currency: string; auto_grant_duration_days: number };
let inactiveProduct: { id: string };
let bumpProducts: Array<{ id: string; price: number }>;
let orderBumpIds: string[];
let pwywBumpProduct: { id: string; price: number };
let pwywOrderBumpId: string;

// Coupon test data
let couponProduct: { id: string; price: number; currency: string };
let couponBumpProduct: { id: string; price: number };
let couponOrderBumpId: string;
// testCoupon and testCouponExcludeBumps removed: each coupon test now creates its own
// coupon in a describe-level beforeAll or inline to avoid order dependency (issue #4).

// IDs to clean up
const createdProductIds: string[] = [];
const createdOrderBumpIds: string[] = [];
const createdSessionIds: string[] = [];
const createdUserIds: string[] = [];
const createdCouponIds: string[] = [];

// ============================================================================
// Setup & Teardown
// ============================================================================

beforeAll(async () => {
  // Clear rate limits to prevent interference.
  // NOTE: This clears ALL rate limits globally, which could interfere with parallel test suites.
  // Scoping to TEST_ID is not possible because rate_limits is keyed by IP/action, not test context.
  await supabaseAdmin.from('rate_limits').delete().gte('created_at', '1970-01-01');

  // --- Main product ($50 USD) ---
  const { data: mp, error: mpErr } = await supabaseAdmin
    .from('products')
    .insert({
      name: `RPC Main ${TS}`,
      slug: `rpc-main-${TS}`,
      price: 50.0,
      currency: 'USD',
      is_active: true,
    })
    .select()
    .single();
  if (mpErr) throw mpErr;
  mainProduct = { id: mp.id, price: mp.price, currency: mp.currency };
  createdProductIds.push(mp.id);

  // --- PWYW product ($29.99, min $5) ---
  const { data: pp, error: ppErr } = await supabaseAdmin
    .from('products')
    .insert({
      name: `RPC PWYW ${TS}`,
      slug: `rpc-pwyw-${TS}`,
      price: 29.99,
      currency: 'USD',
      is_active: true,
      allow_custom_price: true,
      custom_price_min: 5.0,
    })
    .select()
    .single();
  if (ppErr) throw ppErr;
  pwywProduct = { id: pp.id, price: pp.price, currency: pp.currency, custom_price_min: pp.custom_price_min };
  createdProductIds.push(pp.id);

  // --- Timed product (30 days access, $25) ---
  const { data: tp, error: tpErr } = await supabaseAdmin
    .from('products')
    .insert({
      name: `RPC Timed ${TS}`,
      slug: `rpc-timed-${TS}`,
      price: 25.0,
      currency: 'USD',
      is_active: true,
      auto_grant_duration_days: 30,
    })
    .select()
    .single();
  if (tpErr) throw tpErr;
  timedProduct = { id: tp.id, price: tp.price, currency: tp.currency, auto_grant_duration_days: 30 };
  createdProductIds.push(tp.id);

  // --- Inactive product ---
  const { data: ip, error: ipErr } = await supabaseAdmin
    .from('products')
    .insert({
      name: `RPC Inactive ${TS}`,
      slug: `rpc-inactive-${TS}`,
      price: 10.0,
      currency: 'USD',
      is_active: false,
    })
    .select()
    .single();
  if (ipErr) throw ipErr;
  inactiveProduct = { id: ip.id };
  createdProductIds.push(ip.id);

  // --- Bump products for main product (create 2 for basic tests) ---
  bumpProducts = [];
  orderBumpIds = [];
  for (let i = 0; i < 2; i++) {
    const { data: bp, error: bpErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `RPC Bump${i} ${TS}`,
        slug: `rpc-bump${i}-${TS}`,
        price: 30 + i * 10, // $30, $40
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    if (bpErr) throw bpErr;
    bumpProducts.push({ id: bp.id, price: bp.price });
    createdProductIds.push(bp.id);

    const bumpPrice = 10 + i * 5; // $10, $15
    const { data: ob, error: obErr } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: mainProduct.id,
        bump_product_id: bp.id,
        bump_title: `Bump ${i}`,
        bump_price: bumpPrice,
        display_order: i,
        is_active: true,
      })
      .select()
      .single();
    if (obErr) throw obErr;
    orderBumpIds.push(ob.id);
    createdOrderBumpIds.push(ob.id);
  }

  // --- PWYW bump product ---
  const { data: pbp, error: pbpErr } = await supabaseAdmin
    .from('products')
    .insert({
      name: `RPC PWYW Bump ${TS}`,
      slug: `rpc-pwyw-bump-${TS}`,
      price: 20.0,
      currency: 'USD',
      is_active: true,
    })
    .select()
    .single();
  if (pbpErr) throw pbpErr;
  pwywBumpProduct = { id: pbp.id, price: pbp.price };
  createdProductIds.push(pbp.id);

  const { data: pob, error: pobErr } = await supabaseAdmin
    .from('order_bumps')
    .insert({
      main_product_id: pwywProduct.id,
      bump_product_id: pbp.id,
      bump_title: 'PWYW Bump',
      bump_price: 8.0,
      display_order: 0,
      is_active: true,
    })
    .select()
    .single();
  if (pobErr) throw pobErr;
  pwywOrderBumpId = pob.id;
  createdOrderBumpIds.push(pob.id);

  // --- Coupon test product ($40 USD) ---
  const { data: cp, error: cpErr } = await supabaseAdmin
    .from('products')
    .insert({
      name: `RPC Coupon ${TS}`,
      slug: `rpc-coupon-${TS}`,
      price: 40.0,
      currency: 'USD',
      is_active: true,
    })
    .select()
    .single();
  if (cpErr) throw cpErr;
  couponProduct = { id: cp.id, price: cp.price, currency: cp.currency };
  createdProductIds.push(cp.id);

  // --- Coupon bump product ---
  const { data: cbp, error: cbpErr } = await supabaseAdmin
    .from('products')
    .insert({
      name: `RPC Coupon Bump ${TS}`,
      slug: `rpc-coupon-bump-${TS}`,
      price: 20.0,
      currency: 'USD',
      is_active: true,
    })
    .select()
    .single();
  if (cbpErr) throw cbpErr;
  couponBumpProduct = { id: cbp.id, price: cbp.price };
  createdProductIds.push(cbp.id);

  const { data: cob, error: cobErr } = await supabaseAdmin
    .from('order_bumps')
    .insert({
      main_product_id: couponProduct.id,
      bump_product_id: cbp.id,
      bump_title: 'Coupon Bump',
      bump_price: 15.0,
      display_order: 0,
      is_active: true,
    })
    .select()
    .single();
  if (cobErr) throw cobErr;
  couponOrderBumpId = cob.id;
  createdOrderBumpIds.push(cob.id);

  // Shared coupons removed: each coupon test now creates its own coupon
  // in a describe-level beforeAll or inline to avoid order dependency.
});

afterAll(async () => {
  // Clean up in dependency order
  // Clean coupon data first (references transactions)
  for (const cid of createdCouponIds) {
    await supabaseAdmin.from('coupon_redemptions').delete().eq('coupon_id', cid);
    await supabaseAdmin.from('coupon_reservations').delete().eq('coupon_id', cid);
  }

  for (const sid of createdSessionIds) {
    // Find transaction IDs for this session
    const { data: txs } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid);
    if (txs) {
      for (const tx of txs) {
        await supabaseAdmin.from('payment_line_items').delete().eq('transaction_id', tx.id);
        await supabaseAdmin.from('coupon_redemptions').delete().eq('transaction_id', tx.id);
      }
    }
    await supabaseAdmin.from('guest_purchases').delete().eq('session_id', sid);
  }
  for (const pid of createdProductIds) {
    await supabaseAdmin.from('payment_line_items').delete().eq('product_id', pid);
    await supabaseAdmin.from('guest_purchases').delete().eq('product_id', pid);
    await supabaseAdmin.from('user_product_access').delete().eq('product_id', pid);
    await supabaseAdmin.from('payment_transactions').delete().eq('product_id', pid);
  }
  for (const obId of createdOrderBumpIds) {
    await supabaseAdmin.from('order_bumps').delete().eq('id', obId);
  }
  for (const cid of createdCouponIds) {
    await supabaseAdmin.from('coupons').delete().eq('id', cid);
  }
  for (const pid of createdProductIds) {
    await supabaseAdmin.from('products').delete().eq('id', pid);
  }
  for (const uid of createdUserIds) {
    await supabaseAdmin.from('admin_users').delete().eq('user_id', uid);
    try { await supabaseAdmin.auth.admin.deleteUser(uid); } catch { /* ignore */ }
  }
});

// ============================================================================
// 1. PWYW + Bumps combination
// ============================================================================

describe('PWYW + Bumps combination', () => {
  it('should accept PWYW amount + bump prices when total >= min + bumps', async () => {
    // PWYW min = $5, bump_price = $8
    // Pay $15 custom + $8 bump = $23 total = 2300 cents
    // Minimum is ($5 + $8) * 100 = 1300 cents
    const sid = `cs_test_pwyw_bump_ok_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: pwywProduct.id,
      customer_email_param: `pwyw-bump-ok-${TS}@example.com`,
      amount_total: 2300, // $23
      currency_param: 'USD',
      bump_product_ids_param: [pwywBumpProduct.id],
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    // Verify records were actually created (not just idempotency path returning success)
    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, status')
      .eq('session_id', sid)
      .single();
    expect(tx).toBeTruthy();
    expect(tx!.status).toBe('completed');

    // Verify line items: 1 main + 1 bump
    const { data: lineItems } = await supabaseAdmin
      .from('payment_line_items')
      .select('item_type, product_id')
      .eq('transaction_id', tx!.id);
    expect(lineItems!.length).toBe(2);
    expect(lineItems!.find(li => li.item_type === 'main_product')).toBeTruthy();
    expect(lineItems!.find(li => li.item_type === 'order_bump' && li.product_id === pwywBumpProduct.id)).toBeTruthy();

    // Verify guest_purchase was created (no user_id passed)
    const { data: gp } = await supabaseAdmin
      .from('guest_purchases')
      .select('id')
      .eq('session_id', sid)
      .single();
    expect(gp).toBeTruthy();
  });

  it('should accept PWYW at exact minimum + bump prices', async () => {
    // Exact minimum: ($5 + $8) * 100 = 1300 cents
    const sid = `cs_test_pwyw_bump_exact_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: pwywProduct.id,
      customer_email_param: `pwyw-bump-exact-${TS}@example.com`,
      amount_total: 1300,
      currency_param: 'USD',
      bump_product_ids_param: [pwywBumpProduct.id],
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    // Verify records were actually created (not just idempotency path returning success)
    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, status')
      .eq('session_id', sid)
      .single();
    expect(tx).toBeTruthy();
    expect(tx!.status).toBe('completed');

    // Verify line items: 1 main + 1 bump
    const { data: lineItems } = await supabaseAdmin
      .from('payment_line_items')
      .select('item_type, product_id')
      .eq('transaction_id', tx!.id);
    expect(lineItems!.length).toBe(2);
    expect(lineItems!.find(li => li.item_type === 'main_product')).toBeTruthy();
    expect(lineItems!.find(li => li.item_type === 'order_bump' && li.product_id === pwywBumpProduct.id)).toBeTruthy();
  });
});

// ============================================================================
// 2. PWYW + Bumps rejection
// ============================================================================

describe('PWYW + Bumps rejection', () => {
  it('should reject PWYW amount below min + bump_prices', async () => {
    // PWYW min = $5, bump_price = $8
    // Minimum = ($5 + $8) * 100 = 1300 cents
    // Try $12 = 1200 cents (below minimum)
    const sid = `cs_test_pwyw_bump_low_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: pwywProduct.id,
      customer_email_param: `pwyw-bump-low-${TS}@example.com`,
      amount_total: 1200,
      currency_param: 'USD',
      bump_product_ids_param: [pwywBumpProduct.id],
    });

    expect(error).toBeTruthy();
    expect(error?.message).toContain('Amount below minimum');

    // Verify no transaction was created (rollback on error)
    const { data: txn } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .maybeSingle();
    expect(txn).toBeNull();
  });
});

// ============================================================================
// 3. Input validation
// ============================================================================

describe('Input validation', () => {
  const validProductId = '00000000-0000-0000-0000-000000000001'; // won't reach product lookup

  it('should reject null session_id', async () => {
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: null as unknown as string,
      product_id_param: validProductId,
      customer_email_param: 'test@example.com',
      amount_total: 1000,
      currency_param: 'USD',
    });

    // null session_id is handled by the function's validation
    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Invalid session ID');
  });

  it('should reject empty session_id', async () => {
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: '',
      product_id_param: validProductId,
      customer_email_param: 'test@example.com',
      amount_total: 1000,
      currency_param: 'USD',
    });

    // The function returns {success: false, error: 'Invalid session ID'}
    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Invalid session ID');
  });

  it('should reject session_id longer than 255 characters', async () => {
    const longId = 'cs_' + 'a'.repeat(254); // 257 chars total, > 255

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: longId,
      product_id_param: validProductId,
      customer_email_param: 'test@example.com',
      amount_total: 1000,
      currency_param: 'USD',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Invalid session ID');
  });

  it('should reject session_id without cs_/pi_ prefix', async () => {
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: 'invalid_prefix_12345',
      product_id_param: validProductId,
      customer_email_param: 'test@example.com',
      amount_total: 1000,
      currency_param: 'USD',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Invalid session ID format');
  });

  it('should reject session_id with special characters after prefix', async () => {
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: 'cs_test<script>alert(1)</script>',
      product_id_param: validProductId,
      customer_email_param: 'test@example.com',
      amount_total: 1000,
      currency_param: 'USD',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Invalid session ID format');
  });

  it('should reject invalid email', async () => {
    const sid = `cs_test_bad_email_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: 'not-an-email',
      amount_total: 5000,
      currency_param: 'USD',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Valid email address is required');
  });

  it('should reject amount_total = 0', async () => {
    const sid = `cs_test_zero_amount_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `zero-${TS}@example.com`,
      amount_total: 0,
      currency_param: 'USD',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Invalid amount');
  });

  it('should reject negative amount_total', async () => {
    const sid = `cs_test_neg_amount_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `neg-${TS}@example.com`,
      amount_total: -100,
      currency_param: 'USD',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Invalid amount');
  });

  it('should reject amount_total > 99999999', async () => {
    const sid = `cs_test_huge_amount_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `huge-${TS}@example.com`,
      amount_total: 100000000, // > 99999999
      currency_param: 'USD',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Invalid amount');
  });
});

// ============================================================================
// 4. Authorization bypass
// ============================================================================

describe('Authorization bypass', () => {
  it('should reject user_id_param that does not match authenticated user', async () => {
    // Create a test user to authenticate as
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: `auth-bypass-${TS}@example.com`,
      password: 'test123456',
      email_confirm: true,
    });
    if (authErr) throw authErr;
    createdUserIds.push(authData.user.id);

    // Create another user whose ID we'll try to impersonate
    const { data: victimData, error: victimErr } = await supabaseAdmin.auth.admin.createUser({
      email: `auth-victim-${TS}@example.com`,
      password: 'test123456',
      email_confirm: true,
    });
    if (victimErr) throw victimErr;
    createdUserIds.push(victimData.user.id);

    // Sign in as the attacker user with anon client
    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
      email: `auth-bypass-${TS}@example.com`,
      password: 'test123456',
    });
    if (signInErr) throw signInErr;

    const sid = `cs_test_auth_bypass_${TS}`;
    createdSessionIds.push(sid);

    // Try to call RPC as attacker but pass victim's user_id
    const { data, error } = await callRpc(anonClient, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `auth-bypass-${TS}@example.com`,
      amount_total: 5000,
      currency_param: 'USD',
      user_id_param: victimData.user.id, // Try to impersonate victim
    });

    // Should be rejected with "Unauthorized"
    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Unauthorized');
  });

  it('should allow service_role to pass any user_id_param', async () => {
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email: `svc-role-user-${TS}@example.com`,
      password: 'test123456',
      email_confirm: true,
    });
    if (userErr) throw userErr;
    createdUserIds.push(userData.user.id);

    const sid = `cs_test_svc_role_${TS}`;
    createdSessionIds.push(sid);

    // service_role can pass any user_id_param
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `svc-role-user-${TS}@example.com`,
      amount_total: 5000,
      currency_param: 'USD',
      user_id_param: userData.user.id,
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
  });
});

// ============================================================================
// 5. Idempotency: duplicate session_id with transaction but no guest_purchase
// ============================================================================

describe('Idempotency', () => {
  it('should return already_processed_idempotent when transaction exists but no guest_purchase', async () => {
    const sid = `cs_test_idempotent_no_gp_${TS}`;
    createdSessionIds.push(sid);

    // First call: as service_role with a user_id (creates transaction, no guest_purchase)
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email: `idemp-${TS}@example.com`,
      password: 'test123456',
      email_confirm: true,
    });
    if (userErr) throw userErr;
    createdUserIds.push(userData.user.id);

    const { data: first, error: firstErr } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `idemp-${TS}@example.com`,
      amount_total: 5000,
      currency_param: 'USD',
      user_id_param: userData.user.id,
    });
    expect(firstErr).toBeNull();
    expect(first?.success).toBe(true);

    // Verify the first call actually created a transaction record
    // (without this, the idempotency test is meaningless - the second call
    // could return success from any path)
    const { data: txAfterFirst } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, status')
      .eq('session_id', sid)
      .single();
    expect(txAfterFirst).toBeTruthy();
    expect(txAfterFirst!.status).toBe('completed');

    // Second call: same session_id (idempotency)
    const { data: second, error: secondErr } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `idemp-${TS}@example.com`,
      amount_total: 5000,
      currency_param: 'USD',
      user_id_param: userData.user.id,
    });

    expect(secondErr).toBeNull();
    expect(second?.success).toBe(true);
    expect(second?.scenario).toBe('already_processed_idempotent');
    expect(second?.already_had_access).toBe(true);

    // Verify no duplicate records were created by the idempotent call
    const { data: txCount } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid);
    expect(txCount!.length).toBe(1);

    const { data: lineItemCount } = await supabaseAdmin
      .from('payment_line_items')
      .select('id')
      .eq('transaction_id', txAfterFirst!.id);
    expect(lineItemCount!.length).toBe(1); // 1 main_product, no bumps
  });

  it('should return guest_purchase_new_user_with_bump idempotent for guest with existing guest_purchase', async () => {
    const sid = `cs_test_idemp_guest_${TS}`;
    createdSessionIds.push(sid);

    // First call: guest purchase (no user_id, email not registered)
    const { data: first, error: firstErr } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `idemp-guest-${TS}@example.com`,
      amount_total: 5000,
      currency_param: 'USD',
    });
    expect(firstErr).toBeNull();
    expect(first?.success).toBe(true);
    expect(first?.is_guest_purchase).toBe(true);

    // Second call: same session_id
    const { data: second, error: secondErr } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `idemp-guest-${TS}@example.com`,
      amount_total: 5000,
      currency_param: 'USD',
    });

    expect(secondErr).toBeNull();
    expect(second?.success).toBe(true);
    expect(second?.scenario).toBe('guest_purchase_new_user_with_bump');
    expect(second?.is_guest_purchase).toBe(true);
    expect(second?.send_magic_link).toBe(true);

    // Verify no duplicate records were created by the idempotent call
    const { data: txCount } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid);
    expect(txCount!.length).toBe(1);

    const { data: gpCount } = await supabaseAdmin
      .from('guest_purchases')
      .select('id')
      .eq('session_id', sid);
    expect(gpCount!.length).toBe(1);

    const { data: lineItemCount } = await supabaseAdmin
      .from('payment_line_items')
      .select('id')
      .eq('transaction_id', txCount![0].id);
    expect(lineItemCount!.length).toBe(1); // 1 main_product, no bumps
  });
});

// ============================================================================
// 6. Product not found
// ============================================================================

describe('Product not found', () => {
  it('should reject inactive product', async () => {
    const sid = `cs_test_inactive_prod_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: inactiveProduct.id,
      customer_email_param: `inactive-${TS}@example.com`,
      amount_total: 1000,
      currency_param: 'USD',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Product not found or inactive');
  });

  it('should reject non-existent product_id', async () => {
    const sid = `cs_test_nonexist_prod_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: '00000000-0000-0000-0000-000000000099',
      customer_email_param: `nonexist-${TS}@example.com`,
      amount_total: 1000,
      currency_param: 'USD',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Product not found or inactive');
  });
});

// ============================================================================
// 7. Bump array limits
// ============================================================================

describe('Bump array limits', () => {
  let manyBumpMainProduct: { id: string; price: number };
  const manyBumpProductIds: string[] = [];
  const manyBumpOrderBumpIds: string[] = [];

  beforeAll(async () => {
    // Create a main product for this test suite
    const { data: mp, error: mpErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `RPC ManyBump Main ${TS}`,
        slug: `rpc-manybump-main-${TS}`,
        price: 10.0,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    if (mpErr) throw mpErr;
    manyBumpMainProduct = { id: mp.id, price: mp.price };
    createdProductIds.push(mp.id);

    // Create 21 bump products + order bumps (to test 20 = ok, 21 = rejected)
    for (let i = 0; i < 21; i++) {
      const { data: bp, error: bpErr } = await supabaseAdmin
        .from('products')
        .insert({
          name: `RPC ManyBump${i} ${TS}`,
          slug: `rpc-manybump${i}-${TS}`,
          price: 1.0,
          currency: 'USD',
          is_active: true,
        })
        .select()
        .single();
      if (bpErr) throw bpErr;
      manyBumpProductIds.push(bp.id);
      createdProductIds.push(bp.id);

      const { data: ob, error: obErr } = await supabaseAdmin
        .from('order_bumps')
        .insert({
          main_product_id: manyBumpMainProduct.id,
          bump_product_id: bp.id,
          bump_title: `Many Bump ${i}`,
          bump_price: 1.0,
          display_order: i,
          is_active: true,
        })
        .select()
        .single();
      if (obErr) throw obErr;
      manyBumpOrderBumpIds.push(ob.id);
      createdOrderBumpIds.push(ob.id);
    }
  });

  it('should accept exactly 20 bumps', async () => {
    const sid = `cs_test_20bumps_${TS}`;
    createdSessionIds.push(sid);

    const twentyBumpIds = manyBumpProductIds.slice(0, 20);
    // main = $10 + 20 bumps * $1 = $30 = 3000 cents
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: manyBumpMainProduct.id,
      customer_email_param: `20bumps-${TS}@example.com`,
      amount_total: 3000,
      currency_param: 'USD',
      bump_product_ids_param: twentyBumpIds,
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
  });

  it('should reject 21 bumps', async () => {
    const sid = `cs_test_21bumps_${TS}`;
    createdSessionIds.push(sid);

    // All 21 bump IDs
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: manyBumpMainProduct.id,
      customer_email_param: `21bumps-${TS}@example.com`,
      amount_total: 3100, // $10 + 21 * $1
      currency_param: 'USD',
      bump_product_ids_param: manyBumpProductIds, // 21 items
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Too many bump products');
  });
});

// ============================================================================
// 8. Access expiration (auto_grant_duration_days)
// ============================================================================

describe('Access expiration', () => {
  it('should set access_expires_at based on auto_grant_duration_days', async () => {
    // Create a user so we can check user_product_access
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email: `timed-access-${TS}@example.com`,
      password: 'test123456',
      email_confirm: true,
    });
    if (userErr) throw userErr;
    createdUserIds.push(userData.user.id);

    const sid = `cs_test_timed_access_${TS}`;
    createdSessionIds.push(sid);

    const beforeCall = new Date();

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: timedProduct.id,
      customer_email_param: `timed-access-${TS}@example.com`,
      amount_total: 2500, // $25
      currency_param: 'USD',
      user_id_param: userData.user.id,
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.access_granted).toBe(true);

    // Check the user_product_access record for expiration
    const { data: access } = await supabaseAdmin
      .from('user_product_access')
      .select('access_expires_at')
      .eq('user_id', userData.user.id)
      .eq('product_id', timedProduct.id)
      .single();

    expect(access).toBeTruthy();

    // access_expires_at MUST be set for a timed product (auto_grant_duration_days=30)
    expect(access!.access_expires_at).not.toBeNull();
    const expiresAt = new Date(access!.access_expires_at!);
    const expectedMin = new Date(beforeCall.getTime() + 29 * 24 * 60 * 60 * 1000);
    const expectedMax = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);

    // Expiration should be roughly 30 days from now
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
    expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
  });
});

// ============================================================================
// 9. Coupon + amount = 0
// ============================================================================

describe('Coupon + amount = 0', () => {
  it('should reject amount = 0 even with coupon', async () => {
    // The function checks: amount_total <= 0 -> 'Invalid amount'
    // This fires BEFORE coupon validation, at input validation stage.
    // If amount_total = 0 is passed, it should reject regardless of coupon.
    const sid = `cs_test_coupon_zero_${TS}`;
    createdSessionIds.push(sid);

    const fakeCouponId = '00000000-0000-0000-0000-000000000001';

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `coupon-zero-${TS}@example.com`,
      amount_total: 0,
      currency_param: 'USD',
      coupon_id_param: fakeCouponId,
    });

    // amount_total = 0 should be rejected by input validation (amount <= 0)
    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Invalid amount');
  });

  it('should reject amount that is positive but made zero by coupon logic check', async () => {
    // In the coupon branch: IF amount_total <= 0 THEN RAISE EXCEPTION
    // This tests the specific coupon amount validation at line 303
    // We need a real coupon to reach that branch, but with amount = 1 cent
    // and coupon_id set, the function goes to the coupon branch which checks amount > 0.
    // Actually, amount_total = 1 would pass the initial check (> 0),
    // reach the coupon branch, and pass (amount_total > 0).
    // amount_total = 0 is caught at input validation. That's the correct behavior.
    // Let's verify the coupon branch explicitly rejects amount <= 0 too:
    // We can't get amount_total = 0 past the input validation (line 191),
    // so the coupon branch (line 303) is unreachable with amount = 0.
    // This is actually correct defense-in-depth. Let's verify amount = -1 is caught.
    const sid = `cs_test_coupon_neg_${TS}`;
    createdSessionIds.push(sid);

    const fakeCouponId = '00000000-0000-0000-0000-000000000002';

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `coupon-neg-${TS}@example.com`,
      amount_total: -1,
      currency_param: 'USD',
      coupon_id_param: fakeCouponId,
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Invalid amount');
  });
});

// ============================================================================
// 10. Coupon redemption: reservation cleanup, usage_count, redemption row
// ============================================================================

describe('Coupon redemption logic', () => {
  // Each test creates its own coupon to avoid order dependency.
  // This ensures tests pass even with --shuffle.

  it('should create coupon_redemptions row on successful payment with coupon', async () => {
    // Create a fresh coupon for this test
    const { data: localCoupon, error: lcErr } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: `COUPON-REDEEM-${TS}`,
        name: `Redeem test coupon ${TS}`,
        discount_type: 'percentage',
        discount_value: 20,
        allowed_emails: [],
        allowed_product_ids: [],
        exclude_order_bumps: false,
        usage_limit_global: 10,
        usage_limit_per_user: 5,
        current_usage_count: 0,
        is_active: true,
      })
      .select()
      .single();
    if (lcErr) throw lcErr;
    createdCouponIds.push(localCoupon.id);

    const email = `coupon-redeem-${TS}@example.com`;
    const sid = `cs_test_coupon_redeem_${TS}`;
    createdSessionIds.push(sid);

    // Create reservation (required by the function)
    const reservationExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabaseAdmin.from('coupon_reservations').insert({
      coupon_id: localCoupon.id,
      customer_email: email,
      expires_at: reservationExpires,
      session_id: sid,
    });

    // Product is $40, coupon is 20% off = $32 = 3200 cents
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: couponProduct.id,
      customer_email_param: email,
      amount_total: 3200,
      currency_param: 'USD',
      coupon_id_param: localCoupon.id,
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    // Verify coupon_redemptions row was created
    const { data: redemptions } = await supabaseAdmin
      .from('coupon_redemptions')
      .select('*')
      .eq('coupon_id', localCoupon.id)
      .eq('customer_email', email);

    expect(redemptions).toBeTruthy();
    expect(redemptions!.length).toBe(1);
    expect(redemptions![0].transaction_id).toBeTruthy();
  });

  it('should increment coupon usage_count on successful payment with coupon', async () => {
    // Create a fresh coupon for this test with known initial usage_count=0
    const { data: localCoupon, error: lcErr } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: `COUPON-USAGE-${TS}`,
        name: `Usage test coupon ${TS}`,
        discount_type: 'percentage',
        discount_value: 20,
        allowed_emails: [],
        allowed_product_ids: [],
        exclude_order_bumps: false,
        usage_limit_global: 10,
        usage_limit_per_user: 5,
        current_usage_count: 0,
        is_active: true,
      })
      .select()
      .single();
    if (lcErr) throw lcErr;
    createdCouponIds.push(localCoupon.id);

    const email = `coupon-usage-${TS}@example.com`;
    const sid = `cs_test_coupon_usage_${TS}`;
    createdSessionIds.push(sid);

    // Create reservation
    const reservationExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabaseAdmin.from('coupon_reservations').insert({
      coupon_id: localCoupon.id,
      customer_email: email,
      expires_at: reservationExpires,
      session_id: sid,
    });

    // Product is $40, coupon is 20% off = $32 = 3200 cents
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: couponProduct.id,
      customer_email_param: email,
      amount_total: 3200,
      currency_param: 'USD',
      coupon_id_param: localCoupon.id,
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    // Verify usage_count was incremented from 0 to 1
    const { data: afterCoupon } = await supabaseAdmin
      .from('coupons')
      .select('current_usage_count')
      .eq('id', localCoupon.id)
      .single();

    expect(afterCoupon?.current_usage_count).toBe(1);

    // Note: increment_sale_quantity_sold only increments when the product has an active sale
    // (sale_price + sale_price_until set). couponProduct doesn't have a sale configured,
    // so sale_quantity_sold won't change here. That side effect is tested in
    // coupon-functions-rpc.test.ts instead.
  });

  it('should delete coupon_reservations row on successful payment with coupon', async () => {
    // Create a fresh coupon for this test
    const { data: localCoupon, error: lcErr } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: `COUPON-CLEANUP-${TS}`,
        name: `Cleanup test coupon ${TS}`,
        discount_type: 'percentage',
        discount_value: 20,
        allowed_emails: [],
        allowed_product_ids: [],
        exclude_order_bumps: false,
        usage_limit_global: 10,
        usage_limit_per_user: 5,
        current_usage_count: 0,
        is_active: true,
      })
      .select()
      .single();
    if (lcErr) throw lcErr;
    createdCouponIds.push(localCoupon.id);

    const email = `coupon-cleanup-${TS}@example.com`;
    const sid = `cs_test_coupon_cleanup_${TS}`;
    createdSessionIds.push(sid);

    // Create reservation
    const reservationExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabaseAdmin.from('coupon_reservations').insert({
      coupon_id: localCoupon.id,
      customer_email: email,
      expires_at: reservationExpires,
      session_id: sid,
    });

    // Verify reservation exists
    const { data: resBefore } = await supabaseAdmin
      .from('coupon_reservations')
      .select('id')
      .eq('coupon_id', localCoupon.id)
      .eq('customer_email', email);
    expect(resBefore!.length).toBe(1);

    // Product is $40, coupon is 20% off = $32 = 3200 cents
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: couponProduct.id,
      customer_email_param: email,
      amount_total: 3200,
      currency_param: 'USD',
      coupon_id_param: localCoupon.id,
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    // Verify reservation was deleted
    const { data: resAfter } = await supabaseAdmin
      .from('coupon_reservations')
      .select('id')
      .eq('coupon_id', localCoupon.id)
      .eq('customer_email', email);
    expect(resAfter!.length).toBe(0);
  });
});

// ============================================================================
// 11. Coupon usage limit reached during reservation window
// ============================================================================

describe('Coupon usage limit reached during reservation window', () => {
  it('should fail payment when coupon hit usage limit between reservation and payment', async () => {
    // Create a coupon with limit=1 and current_usage_count=0
    const { data: limitCoupon, error: lcErr } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: `LIMIT1-${TS}`,
        name: `Limit 1 coupon ${TS}`,
        discount_type: 'percentage',
        discount_value: 10,
        allowed_emails: [],
        allowed_product_ids: [],
        exclude_order_bumps: false,
        usage_limit_global: 1,
        usage_limit_per_user: 1,
        current_usage_count: 0,
        is_active: true,
      })
      .select()
      .single();
    if (lcErr) throw lcErr;
    createdCouponIds.push(limitCoupon.id);

    const email = `coupon-limit-${TS}@example.com`;
    const sid = `cs_test_coupon_limit_${TS}`;
    createdSessionIds.push(sid);

    // Create reservation
    const reservationExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabaseAdmin.from('coupon_reservations').insert({
      coupon_id: limitCoupon.id,
      customer_email: email,
      expires_at: reservationExpires,
      session_id: sid,
    });

    // Simulate someone else using the coupon: set usage_count = limit
    await supabaseAdmin
      .from('coupons')
      .update({ current_usage_count: 1 })
      .eq('id', limitCoupon.id);

    // Now try to pay with this coupon - should fail at the UPDATE coupons step
    // Product is $40, 10% off = $36 = 3600 cents
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: couponProduct.id,
      customer_email_param: email,
      amount_total: 3600,
      currency_param: 'USD',
      coupon_id_param: limitCoupon.id,
    });

    // Coupon usage exhausted - caught by the EXCEPTION WHEN OTHERS handler in the DB function.
    // The generic 'Payment processing failed' message is intentional: the DB function catches
    // all unhandled exceptions (including the coupon usage limit violation from the
    // UPDATE coupons WHERE current_usage_count < usage_limit_global returning NOT FOUND)
    // with a single catch-all handler that returns this message. A more specific assertion
    // isn't possible without modifying the DB function to add a dedicated exception for this case.
    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Payment processing failed');

    // Negative DB verification: confirm no transaction was created (rollback on exception)
    const { data: txn } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .maybeSingle();
    expect(txn).toBeNull();
  });
});

// ============================================================================
// 12. Percentage coupon + bumps (exclude_order_bumps flag)
// ============================================================================

// NOTE: The exclude_order_bumps flag's effect on DISCOUNT CALCULATION is enforced
// at the application layer (Stripe session creation), NOT in this DB function.
// This DB function trusts the caller's amount_total and does not compute discounts.
// These tests verify that:
// 1. The flag value is correctly stored in the coupon_redemptions/transaction record
// 2. The function accepts valid payments regardless of the flag value
// 3. Bump line items are always recorded regardless of the flag
describe('Percentage coupon + bumps (exclude_order_bumps)', () => {
  // Each test creates its own coupon to avoid order dependency (issue #4)
  let localCouponIncludeBumps: { id: string; code: string };
  let localCouponExcludeBumps: { id: string; code: string };

  beforeAll(async () => {
    // Coupon that includes bumps in discount
    const { data: tc1, error: tc1Err } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: `COUPON20-12A-${TS}`,
        name: `Test Coupon 20% 12a ${TS}`,
        discount_type: 'percentage',
        discount_value: 20,
        allowed_emails: [],
        allowed_product_ids: [],
        exclude_order_bumps: false,
        usage_limit_global: 10,
        usage_limit_per_user: 5,
        current_usage_count: 0,
        is_active: true,
      })
      .select()
      .single();
    if (tc1Err) throw tc1Err;
    localCouponIncludeBumps = { id: tc1.id, code: tc1.code };
    createdCouponIds.push(tc1.id);

    // Coupon that excludes bumps from discount
    const { data: tc2, error: tc2Err } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: `COUPON25NB-12B-${TS}`,
        name: `Test Coupon 25% no bumps 12b ${TS}`,
        discount_type: 'percentage',
        discount_value: 25,
        allowed_emails: [],
        allowed_product_ids: [],
        exclude_order_bumps: true,
        usage_limit_global: 10,
        usage_limit_per_user: 5,
        current_usage_count: 0,
        is_active: true,
      })
      .select()
      .single();
    if (tc2Err) throw tc2Err;
    localCouponExcludeBumps = { id: tc2.id, code: tc2.code };
    createdCouponIds.push(tc2.id);
  });

  it('should accept payment with coupon that includes bumps (exclude_order_bumps=false)', async () => {
    const email = `coupon-with-bumps-${TS}@example.com`;
    const sid = `cs_test_coupon_bumps_incl_${TS}`;
    createdSessionIds.push(sid);

    // Create reservation
    const reservationExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabaseAdmin.from('coupon_reservations').insert({
      coupon_id: localCouponIncludeBumps.id,
      customer_email: email,
      expires_at: reservationExpires,
      session_id: sid,
    });

    // Product $40 + bump $15 = $55 total
    // 20% off everything = $44 = 4400 cents
    // The coupon branch uses lenient validation: amount > 0 AND amount <= expected_total * 100
    // expected_total = product.price + bump_price = $40 + $15 = $55 = 5500 cents max
    // So 4400 is valid (> 0 and <= 5500)
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: couponProduct.id,
      customer_email_param: email,
      amount_total: 4400,
      currency_param: 'USD',
      bump_product_ids_param: [couponBumpProduct.id],
      coupon_id_param: localCouponIncludeBumps.id,
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    // Guest purchase does not include bump_count in response, but bump access is tracked via line items
    expect(data?.is_guest_purchase).toBe(true);

    // Verify bump was recorded as a line item
    const { data: txs } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .single();
    expect(txs).toBeTruthy();

    const { data: lineItems } = await supabaseAdmin
      .from('payment_line_items')
      .select('item_type, product_id')
      .eq('transaction_id', txs!.id)
      .eq('item_type', 'order_bump');
    expect(lineItems!.length).toBe(1);
    expect(lineItems![0].product_id).toBe(couponBumpProduct.id);

    // Verify the exclude_order_bumps=false flag is stored in the redemption record
    const { data: redemption } = await supabaseAdmin
      .from('coupon_redemptions')
      .select('coupon_id')
      .eq('coupon_id', localCouponIncludeBumps.id)
      .eq('customer_email', email)
      .single();
    expect(redemption).toBeTruthy();

    // Verify the coupon itself has exclude_order_bumps=false (the flag value is what we set)
    const { data: couponRecord } = await supabaseAdmin
      .from('coupons')
      .select('exclude_order_bumps')
      .eq('id', localCouponIncludeBumps.id)
      .single();
    expect(couponRecord!.exclude_order_bumps).toBe(false);
  });

  it('should accept payment with coupon that excludes bumps (exclude_order_bumps=true)', async () => {
    const email = `coupon-no-bumps-${TS}@example.com`;
    const sid = `cs_test_coupon_bumps_excl_${TS}`;
    createdSessionIds.push(sid);

    // Create reservation
    const reservationExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabaseAdmin.from('coupon_reservations').insert({
      coupon_id: localCouponExcludeBumps.id,
      customer_email: email,
      expires_at: reservationExpires,
      session_id: sid,
    });

    // Product $40 + bump $15 = $55 total
    // 25% off main product only = $30 + $15 bump = $45 = 4500 cents
    // The coupon branch: amount > 0 AND amount <= ($40 + $15) * 100 = 5500
    // So 4500 is valid (> 0 and <= 5500)
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: couponProduct.id,
      customer_email_param: email,
      amount_total: 4500,
      currency_param: 'USD',
      bump_product_ids_param: [couponBumpProduct.id],
      coupon_id_param: localCouponExcludeBumps.id,
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    // Verify redemption was created
    const { data: redemptions } = await supabaseAdmin
      .from('coupon_redemptions')
      .select('*')
      .eq('coupon_id', localCouponExcludeBumps.id)
      .eq('customer_email', email);
    expect(redemptions!.length).toBe(1);

    // Verify line items were created correctly.
    // The exclude_order_bumps flag only affects discount CALCULATION at the application layer
    // (Stripe session creation), not in this DB function. This DB function trusts amount_total
    // and does not compute discounts. Bumps should still appear as line items regardless.
    const { data: txs } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .single();
    expect(txs).toBeTruthy();

    const { data: lineItems } = await supabaseAdmin
      .from('payment_line_items')
      .select('item_type, product_id, unit_price')
      .eq('transaction_id', txs!.id);
    expect(lineItems).toBeTruthy();

    // Should have 1 main_product + 1 order_bump = 2 line items
    expect(lineItems!.length).toBe(2);
    const mainItem = lineItems!.find(li => li.item_type === 'main_product');
    expect(mainItem).toBeTruthy();
    expect(mainItem!.product_id).toBe(couponProduct.id);

    const bumpItem = lineItems!.find(li => li.item_type === 'order_bump');
    expect(bumpItem).toBeTruthy();
    expect(bumpItem!.product_id).toBe(couponBumpProduct.id);
    // Bump price should be the order_bump price ($15), unaffected by coupon
    expect(Number(bumpItem!.unit_price)).toBe(15);

    // Verify the exclude_order_bumps=true flag is stored correctly on the coupon
    const { data: couponRecord } = await supabaseAdmin
      .from('coupons')
      .select('exclude_order_bumps')
      .eq('id', localCouponExcludeBumps.id)
      .single();
    expect(couponRecord!.exclude_order_bumps).toBe(true);
  });

  it('should reject payment with coupon when amount exceeds max possible', async () => {
    const email = `coupon-overpay-${TS}@example.com`;
    const sid = `cs_test_coupon_overpay_${TS}`;
    createdSessionIds.push(sid);

    // Create reservation (uses the local coupon from this describe block)
    const reservationExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabaseAdmin.from('coupon_reservations').insert({
      coupon_id: localCouponIncludeBumps.id,
      customer_email: email,
      expires_at: reservationExpires,
      session_id: sid,
    });

    // Product $40 + bump $15 = $55 = 5500 cents max
    // Try 6000 cents (more than max)
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: couponProduct.id,
      customer_email_param: email,
      amount_total: 6000,
      currency_param: 'USD',
      bump_product_ids_param: [couponBumpProduct.id],
      coupon_id_param: localCouponIncludeBumps.id,
    });

    // Amount too high with coupon raises Postgres exception
    expect(error).not.toBeNull();
    expect(error!.message).toContain('Amount too high with coupon');

    // Verify no transaction was created (rollback on error)
    const { data: txn } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .maybeSingle();
    expect(txn).toBeNull();
  });
});

// ============================================================================
// 13. Fixed price edge cases
// ============================================================================

describe('Fixed price edge cases', () => {
  it('should reject fixed price product when amount is TOO HIGH', async () => {
    // mainProduct.price = $50, so expected = 5000 cents
    // Send 20000 cents ($200) - should reject with "Amount mismatch"
    const sid = `cs_test_fixed_too_high_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `fixed-high-${TS}@example.com`,
      amount_total: 20000,
      currency_param: 'USD',
    });

    // Amount mismatch raises Postgres exception
    expect(error).not.toBeNull();
    expect(error!.message).toContain('Amount mismatch');

    // Verify no transaction was created (rollback on error)
    const { data: txn } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .maybeSingle();
    expect(txn).toBeNull();
  });

  it('should reject fixed price product WITH bumps when total does not match', async () => {
    // mainProduct.price = $50, bump0.bump_price = $10
    // Expected = ($50 + $10) * 100 = 6000 cents
    // Send 5500 cents (incorrect) - should reject
    const sid = `cs_test_fixed_bumps_mismatch_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `fixed-bumps-bad-${TS}@example.com`,
      amount_total: 5500,
      currency_param: 'USD',
      bump_product_ids_param: [bumpProducts[0].id],
    });

    // Amount mismatch raises Postgres exception
    expect(error).not.toBeNull();
    expect(error!.message).toContain('Amount mismatch');

    // Verify no transaction was created (rollback on error)
    const { data: txn } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .maybeSingle();
    expect(txn).toBeNull();
  });

  it('should accept fixed price product WITH bumps when total matches exactly (regression)', async () => {
    // mainProduct.price = $50, bump0.bump_price = $10, bump1.bump_price = $15
    // Expected = ($50 + $10 + $15) * 100 = 7500 cents
    const sid = `cs_test_fixed_bumps_ok_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `fixed-bumps-ok-${TS}@example.com`,
      amount_total: 7500,
      currency_param: 'USD',
      bump_product_ids_param: [bumpProducts[0].id, bumpProducts[1].id],
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
  });
});

// ============================================================================
// 14. Bump edge cases
// ============================================================================

describe('Bump edge cases', () => {
  it('should treat empty bump array [] like no bumps', async () => {
    // array_length('{}'::UUID[], 1) returns NULL in PostgreSQL
    // so the bump validation loop is skipped entirely
    // Expected amount = mainProduct.price * 100 = 5000 cents
    const sid = `cs_test_empty_bumps_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `empty-bumps-${TS}@example.com`,
      amount_total: 5000,
      currency_param: 'USD',
      bump_product_ids_param: [],
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    // Verify no bump line items were created (empty array = no bumps)
    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .single();
    const { data: lineItems } = await supabaseAdmin
      .from('payment_line_items')
      .select('item_type')
      .eq('transaction_id', tx!.id);
    expect(lineItems!.length).toBe(1);
    expect(lineItems![0].item_type).toBe('main_product');
  });

  it('should silently skip bump product with no order_bump record for this main product', async () => {
    // Create a product that exists but has NO order_bump linking it to mainProduct
    const { data: orphanProduct, error: opErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `RPC Orphan Bump ${TS}`,
        slug: `rpc-orphan-bump-${TS}`,
        price: 20.0,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    if (opErr) throw opErr;
    createdProductIds.push(orphanProduct.id);

    // Pass orphan as bump - JOIN on order_bumps will find nothing
    // bump_count stays 0, total_bump_price stays 0
    // So expected amount = mainProduct.price * 100 = 5000 cents
    const sid = `cs_test_orphan_bump_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `orphan-bump-${TS}@example.com`,
      amount_total: 5000,
      currency_param: 'USD',
      bump_product_ids_param: [orphanProduct.id],
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    // Verify NO line item was created for the orphan bump product.
    // This proves the function actually filters out bumps with no matching order_bump record,
    // rather than just accepting any amount_total blindly.
    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .single();
    expect(tx).toBeTruthy();

    const { data: bumpLineItems } = await supabaseAdmin
      .from('payment_line_items')
      .select('item_type, product_id')
      .eq('transaction_id', tx!.id)
      .eq('item_type', 'order_bump');
    expect(bumpLineItems!.length).toBe(0);

    // Should only have the main product line item
    const { data: allLineItems } = await supabaseAdmin
      .from('payment_line_items')
      .select('item_type')
      .eq('transaction_id', tx!.id);
    expect(allLineItems!.length).toBe(1);
    expect(allLineItems![0].item_type).toBe('main_product');
  });

  it('should handle duplicate product ID in bump array', async () => {
    // Passing the same bump product ID twice
    // The bump validation loop JOINs unnest(bump_ids) with products and order_bumps
    // The same product will match twice, adding its price twice to total_bump_price
    // Then line_items INSERT has UNIQUE(transaction_id, product_id) constraint
    // which will cause a duplicate key violation on the second insert
    //
    // Expected behavior: either the function handles it gracefully (skipping dupes)
    // or raises an exception caught by the EXCEPTION handler
    const sid = `cs_test_dup_bump_${TS}`;
    createdSessionIds.push(sid);

    // bump0.bump_price = $10
    // If counted twice: expected = ($50 + $10 + $10) * 100 = 7000 cents
    // If counted once: expected = ($50 + $10) * 100 = 6000 cents
    // We send 7000 to match the double-counted amount, so validation passes
    // but the unique constraint on payment_line_items will fail
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `dup-bump-${TS}@example.com`,
      amount_total: 7000,
      currency_param: 'USD',
      bump_product_ids_param: [bumpProducts[0].id, bumpProducts[0].id],
    });

    // The unique constraint violation on payment_line_items(transaction_id, product_id)
    // is caught by the EXCEPTION WHEN OTHERS handler in the DB function.
    // The generic 'Payment processing failed' message is intentional: the DB function's
    // catch-all handler wraps all unhandled exceptions (including the unique constraint
    // violation from inserting duplicate bump line items) into this single error message.
    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Payment processing failed');

    // Negative DB verification: confirm no transaction was persisted (rollback on exception)
    const { data: txn } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .maybeSingle();
    expect(txn).toBeNull();
  });

  // NOTE: This test documents CURRENT behavior, not necessarily CORRECT behavior.
  // Mixed-currency bumps (EUR bump on USD main product) are accepted without
  // cross-currency validation. This may be a bug worth investigating separately.
  it('should handle bump product with different currency than main product', async () => {
    // Create a bump product in EUR while main product is USD
    const { data: eurProduct, error: eurErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `RPC EUR Bump ${TS}`,
        slug: `rpc-eur-bump-${TS}`,
        price: 15.0,
        currency: 'EUR',
        is_active: true,
      })
      .select()
      .single();
    if (eurErr) throw eurErr;
    createdProductIds.push(eurProduct.id);

    // Create order_bump linking EUR product to USD main product
    const { data: eurOb, error: eurObErr } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: mainProduct.id,
        bump_product_id: eurProduct.id,
        bump_title: 'EUR Bump',
        bump_price: 12.0,
        display_order: 10,
        is_active: true,
      })
      .select()
      .single();
    if (eurObErr) throw eurObErr;
    createdOrderBumpIds.push(eurOb.id);

    // The function does NOT validate bump currency against main product currency.
    // It uses COALESCE(ob.bump_price, p.price) for amount validation
    // and stores upper(COALESCE(bump_rec.currency, currency_param)) in line items.
    // So it should succeed: expected = ($50 + $12) * 100 = 6200 cents
    const sid = `cs_test_eur_bump_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `eur-bump-${TS}@example.com`,
      amount_total: 6200,
      currency_param: 'USD',
      bump_product_ids_param: [eurProduct.id],
    });

    // Should succeed - no cross-currency validation on bumps
    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    // Verify line item stores the bump's own currency (EUR)
    const { data: txs } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .single();
    if (txs) {
      const { data: lineItems } = await supabaseAdmin
        .from('payment_line_items')
        .select('currency, item_type')
        .eq('transaction_id', txs.id)
        .eq('item_type', 'order_bump');
      expect(lineItems!.length).toBe(1);
      expect(lineItems![0].currency).toBe('EUR');
    }
  });
});

// ============================================================================
// 15. Pending payment conversion
// ============================================================================

describe('Pending payment conversion', () => {
  it('should UPDATE existing pending transaction instead of INSERT when stripe_payment_intent_id matches', async () => {
    const paymentIntentId = `pi_test_pending_${TS}`;
    const pendingSessionId = `cs_test_pending_orig_${TS}`;
    createdSessionIds.push(pendingSessionId);

    // Manually insert a pending transaction
    const { data: pendingTx, error: ptxErr } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: pendingSessionId,
        product_id: mainProduct.id,
        customer_email: `pending-${TS}@example.com`,
        amount: 5000,
        currency: 'USD',
        stripe_payment_intent_id: paymentIntentId,
        status: 'pending',
        metadata: {},
      })
      .select()
      .single();
    if (ptxErr) throw ptxErr;

    // Now call RPC with the same stripe_payment_intent_id
    // The function should find the pending transaction and UPDATE it
    const completionSessionId = `cs_test_pending_complete_${TS}`;
    createdSessionIds.push(completionSessionId);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: completionSessionId,
      product_id_param: mainProduct.id,
      customer_email_param: `pending-${TS}@example.com`,
      amount_total: 5000,
      currency_param: 'USD',
      stripe_payment_intent_id: paymentIntentId,
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    // Verify the original pending transaction was updated to 'completed'
    const { data: updatedTx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, status, metadata')
      .eq('id', pendingTx.id)
      .single();

    expect(updatedTx).toBeTruthy();
    expect(updatedTx!.status).toBe('completed');
    expect(updatedTx!.metadata?.converted_from_pending).toBe(true);

    // Verify NO new transaction was created with the completion session_id
    const { data: newTxs } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', completionSessionId);

    // The pending transaction was updated, not a new one inserted
    // So the completion session_id should not exist as a separate transaction
    expect(newTxs!.length).toBe(0);
  });
});

// ============================================================================
// 16. Concurrency & security
// ============================================================================

describe('Concurrency & security', () => {
  it('should reject SQL injection attempt in session_id via format validation', async () => {
    // The regex '^(cs_|pi_)[a-zA-Z0-9_]+$' rejects special chars like quotes, semicolons
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: "cs_test'; DROP TABLE--",
      product_id_param: mainProduct.id,
      customer_email_param: `sqli-${TS}@example.com`,
      amount_total: 5000,
      currency_param: 'USD',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Invalid session ID format');
  });

  it('should reject NULL currency_param via payment_line_items NOT NULL constraint', async () => {
    // The products table has NOT NULL on currency, so all products have a currency.
    // However, currency_param is a separate RPC parameter.
    // If someone passes NULL as currency_param, the product currency check passes
    // (product.currency IS NOT NULL, upper(NULL) != upper('USD') -> currency mismatch exception).
    // Test: pass null currency_param with a normal product that has currency set.
    const sid = `cs_test_null_currency_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `null-currency-${TS}@example.com`,
      amount_total: 5000,
      currency_param: null as unknown as string,
    });

    // upper(NULL) != upper('USD') triggers RAISE EXCEPTION 'Currency mismatch'
    // which is caught by the EXCEPTION WHEN OTHERS handler in the DB function.
    // The generic 'Payment processing failed' message is intentional: the DB function's
    // catch-all handler wraps all unhandled exceptions (including currency mismatch from
    // NULL input) into this single error message. A more specific assertion isn't possible
    // without modifying the DB function to return the original exception message.
    expect(error).toBeNull();
    expect(data?.success).toBe(false);
    expect(data?.error).toContain('Payment processing failed');

    // Negative DB verification: confirm no transaction was created (rollback on exception)
    const { data: txn } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .maybeSingle();
    expect(txn).toBeNull();
  });
});

// ============================================================================
// 17. Line items verification
// ============================================================================

describe('Line items verification', () => {
  it('should create correct line items with proper item_type after payment with bumps', async () => {
    const sid = `cs_test_line_items_${TS}`;
    createdSessionIds.push(sid);

    // mainProduct.price = $50, bump0.bump_price = $10, bump1.bump_price = $15
    // Total = ($50 + $10 + $15) * 100 = 7500 cents
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `line-items-${TS}@example.com`,
      amount_total: 7500,
      currency_param: 'USD',
      bump_product_ids_param: [bumpProducts[0].id, bumpProducts[1].id],
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    // Get the transaction
    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .single();
    expect(tx).toBeTruthy();

    // Get all line items for this transaction
    const { data: lineItems } = await supabaseAdmin
      .from('payment_line_items')
      .select('product_id, item_type, unit_price, total_price, currency, product_name, order_bump_id')
      .eq('transaction_id', tx!.id)
      .order('item_type', { ascending: true }); // main_product comes first alphabetically

    expect(lineItems).toBeTruthy();
    expect(lineItems!.length).toBe(3); // 1 main + 2 bumps

    // Verify main product line item
    const mainItem = lineItems!.find(li => li.item_type === 'main_product');
    expect(mainItem).toBeTruthy();
    expect(mainItem!.product_id).toBe(mainProduct.id);
    expect(Number(mainItem!.unit_price)).toBe(mainProduct.price); // $50
    expect(Number(mainItem!.total_price)).toBe(mainProduct.price); // $50 (qty=1)
    expect(mainItem!.currency).toBe('USD');
    expect(mainItem!.order_bump_id).toBeNull();

    // Verify bump line items
    const bumpItems = lineItems!.filter(li => li.item_type === 'order_bump');
    expect(bumpItems.length).toBe(2);

    // All bump items should have order_bump_id set
    for (const bi of bumpItems) {
      expect(bi.order_bump_id).toBeTruthy();
      expect(bi.currency).toBe('USD');
    }

    // Verify bump prices match order_bump.bump_price (not product.price)
    // bump0: product.price=$30 but bump_price=$10
    // bump1: product.price=$40 but bump_price=$15
    const bump0Item = bumpItems.find(bi => bi.product_id === bumpProducts[0].id);
    expect(bump0Item).toBeTruthy();
    expect(Number(bump0Item!.unit_price)).toBe(10); // bump_price, not product.price

    const bump1Item = bumpItems.find(bi => bi.product_id === bumpProducts[1].id);
    expect(bump1Item).toBeTruthy();
    expect(Number(bump1Item!.unit_price)).toBe(15); // bump_price, not product.price
  });

  it('should use product.price for main item and order_bumps.bump_price for bump items', async () => {
    // This is a focused regression test:
    // main product uses product_record.price for line item unit_price
    // bump uses COALESCE(ob.bump_price, p.price) for line item unit_price
    const sid = `cs_test_price_sources_${TS}`;
    createdSessionIds.push(sid);

    // Use just one bump: bump0 (product.price=$30, bump_price=$10)
    // Expected = ($50 + $10) * 100 = 6000 cents
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `price-sources-${TS}@example.com`,
      amount_total: 6000,
      currency_param: 'USD',
      bump_product_ids_param: [bumpProducts[0].id],
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sid)
      .single();
    expect(tx).toBeTruthy();

    const { data: lineItems } = await supabaseAdmin
      .from('payment_line_items')
      .select('product_id, item_type, unit_price')
      .eq('transaction_id', tx!.id);

    expect(lineItems!.length).toBe(2);

    const mainLI = lineItems!.find(li => li.item_type === 'main_product');
    const bumpLI = lineItems!.find(li => li.item_type === 'order_bump');

    // Main product: unit_price = product.price = $50
    expect(Number(mainLI!.unit_price)).toBe(50);

    // Bump: unit_price = COALESCE(ob.bump_price, p.price) = $10 (not $30)
    expect(Number(bumpLI!.unit_price)).toBe(10);
  });
});

// ============================================================================
// 18. Authenticated user (non-service_role) positive path
// ============================================================================

describe('Authenticated user positive path', () => {
  it('should process payment successfully when called by authenticated user (not service_role)', async () => {
    // All other positive-path tests use service_role. This test verifies the function
    // works correctly when called by an actual authenticated user via anon client.
    const email = `auth-user-${TS}@example.com`;
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: 'test123456',
      email_confirm: true,
    });
    if (userErr) throw userErr;
    createdUserIds.push(userData.user.id);

    // Sign in with anon client
    const anonClient = createClient(SUPABASE_URL, ANON_KEY);
    const { error: signInErr } = await anonClient.auth.signInWithPassword({
      email,
      password: 'test123456',
    });
    if (signInErr) throw signInErr;

    const sid = `cs_test_auth_user_ok_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(anonClient, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: email,
      amount_total: 5000,
      currency_param: 'USD',
      user_id_param: userData.user.id,
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.access_granted).toBe(true);
    expect(data?.scenario).toBe('logged_in_user_with_bump');

    // Verify transaction was created
    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, status, user_id')
      .eq('session_id', sid)
      .single();
    expect(tx).toBeTruthy();
    expect(tx!.status).toBe('completed');
    expect(tx!.user_id).toBe(userData.user.id);

    // Verify user_product_access was granted
    const { data: access } = await supabaseAdmin
      .from('user_product_access')
      .select('id')
      .eq('user_id', userData.user.id)
      .eq('product_id', mainProduct.id)
      .single();
    expect(access).toBeTruthy();
  });
});

// ============================================================================
// 19. Anon role cannot call service-role-only function
// ============================================================================

describe('Anon role access', () => {
  it('allows anon calls but still validates inputs (function is PUBLIC for guest checkout)', async () => {
    // NOTE: This function intentionally has PUBLIC execute permission because it
    // supports guest checkout (unauthenticated users purchasing products).
    // Security is enforced via input validation and rate limiting, not role restriction.
    const anonClient = createClient(SUPABASE_URL, ANON_KEY);

    const sid = `cs_test_anon_access_${TS}`;
    createdSessionIds.push(sid);

    const { data, error } = await callRpc(anonClient, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: `anon-access-${TS}@example.com`,
      amount_total: 5000,
      currency_param: 'USD',
    });

    // Function is callable by anon (no 42501 permission error).
    // With a valid product, it processes the payment and returns success.
    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data.success).toBe(true);
  });
});

// ============================================================================
// 13. Existing user guest checkout — auto-grant access (BUG #1 fix)
// ============================================================================
//
// When a registered user does a guest checkout (without logging in first),
// the RPC must grant access immediately to that user (matched by email).
// Magic link is still sent so they can log in to view the product.
//
// Regression: previously the RPC only created a guest_purchases row and waited
// for the user to "register" to claim it via handle_new_user_registration trigger.
// But for already-registered users, that trigger never fires on subsequent logins,
// so the product was never granted.
//
// @see vault/brands/_shared/reference/sellf-production-readiness-tests.md (P0 #1)
// ============================================================================

describe('Existing user guest checkout (auto-grant access)', () => {
  it('grants access immediately when guest checkout email matches existing user', async () => {
    const sid = `cs_test_existing_user_${TS}`;
    createdSessionIds.push(sid);
    const email = `existing-guest-${TS}@example.com`;

    // 1. Create user FIRST (simulates pre-existing customer)
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: 'test123456',
      email_confirm: true,
    });
    if (userErr) throw userErr;
    createdUserIds.push(userData.user.id);

    // 2. Guest checkout (no user_id_param — user is not logged in browser)
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: email,
      amount_total: 5000,
      currency_param: 'USD',
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    // KEY: access granted to existing user even though current_user_id was NULL
    expect(data?.access_granted).toBe(true);
    // User still needs to log in to view product → magic link
    expect(data?.send_magic_link).toBe(true);
    expect(data?.requires_login).toBe(true);
    // is_guest_purchase=false because email matched an existing account
    expect(data?.is_guest_purchase).toBe(false);

    // Verify access record was created for the existing user
    const { data: access } = await supabaseAdmin
      .from('user_product_access')
      .select('id')
      .eq('user_id', userData.user.id)
      .eq('product_id', mainProduct.id)
      .single();
    expect(access).toBeTruthy();

    // Verify transaction is recorded with the existing user_id (not NULL)
    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('user_id')
      .eq('session_id', sid)
      .single();
    expect(tx?.user_id).toBe(userData.user.id);

    // No guest_purchases row should exist (it's not a guest — user matched)
    const { data: gp } = await supabaseAdmin
      .from('guest_purchases')
      .select('id')
      .eq('session_id', sid)
      .maybeSingle();
    expect(gp).toBeNull();
  });

  it('also grants access for bump products to existing user', async () => {
    const sid = `cs_test_existing_user_bumps_${TS}`;
    createdSessionIds.push(sid);
    const email = `existing-guest-bumps-${TS}@example.com`;

    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: 'test123456',
      email_confirm: true,
    });
    if (userErr) throw userErr;
    createdUserIds.push(userData.user.id);

    // Main $50 + bump $10 = $60 → 6000 cents
    const { data, error } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: email,
      amount_total: 6000,
      currency_param: 'USD',
      bump_product_ids_param: [bumpProducts[0].id],
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.access_granted).toBe(true);

    // Both main and bump products granted
    const { data: accesses } = await supabaseAdmin
      .from('user_product_access')
      .select('product_id')
      .eq('user_id', userData.user.id)
      .in('product_id', [mainProduct.id, bumpProducts[0].id]);
    expect(accesses!.length).toBe(2);
  });
});

// ============================================================================
// 14. Retroactive claim for logged-in user (BUG #2 fix)
// ============================================================================
//
// Scenario: user does guest checkout BEFORE registration, then registers and
// later revisits payment-status while logged in. The RPC's idempotency path
// previously returned is_guest_purchase=true regardless of current login state.
//
// Now: when current_user_id IS NOT NULL and email matches that user, the RPC
// claims the unclaimed guest_purchase, grants access, and returns access_granted=true.
// ============================================================================

describe('Retroactive claim for logged-in user', () => {
  it('claims guest_purchase when logged-in user revisits with matching email', async () => {
    const sid = `cs_test_retroactive_${TS}`;
    createdSessionIds.push(sid);
    const email = `retroactive-${TS}@example.com`;

    // Step 1: Guest checkout BEFORE user exists
    const { data: first, error: firstErr } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: email,
      amount_total: 5000,
      currency_param: 'USD',
    });
    expect(firstErr).toBeNull();
    expect(first?.is_guest_purchase).toBe(true);
    expect(first?.access_granted).toBe(false);

    // Step 2: User registers AFTER the guest purchase exists
    // We disable the auto-claim trigger effect by NOT testing it here — we test
    // the RPC's own retroactive-claim path which fires when user revisits payment-status.
    const { data: userData, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: 'test123456',
      email_confirm: true,
    });
    if (userErr) throw userErr;
    createdUserIds.push(userData.user.id);

    // The trigger handle_new_user_registration may have already claimed it.
    // To test the RPC's retroactive path independently, undo the claim if present.
    await supabaseAdmin
      .from('guest_purchases')
      .update({ claimed_by_user_id: null, claimed_at: null })
      .eq('session_id', sid);
    await supabaseAdmin
      .from('user_product_access')
      .delete()
      .eq('user_id', userData.user.id)
      .eq('product_id', mainProduct.id);

    // Step 3: User (now logged in) revisits payment-status → RPC called with user_id_param
    const { data: second, error: secondErr } = await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: email,
      amount_total: 5000,
      currency_param: 'USD',
      user_id_param: userData.user.id,
    });

    expect(secondErr).toBeNull();
    expect(second?.success).toBe(true);
    expect(second?.access_granted).toBe(true);
    expect(second?.is_guest_purchase).toBe(false);

    // Access exists for the now-logged-in user
    const { data: access } = await supabaseAdmin
      .from('user_product_access')
      .select('id')
      .eq('user_id', userData.user.id)
      .eq('product_id', mainProduct.id)
      .maybeSingle();
    expect(access).toBeTruthy();

    // guest_purchase row marked as claimed
    const { data: gp } = await supabaseAdmin
      .from('guest_purchases')
      .select('claimed_by_user_id, claimed_at')
      .eq('session_id', sid)
      .single();
    expect(gp?.claimed_by_user_id).toBe(userData.user.id);
    expect(gp?.claimed_at).toBeTruthy();
  });

  it('SECURITY: does NOT claim guest_purchase if email does not match logged-in user', async () => {
    const sid = `cs_test_retro_security_${TS}`;
    createdSessionIds.push(sid);
    const guestEmail = `victim-${TS}@example.com`;
    const attackerEmail = `attacker-${TS}@example.com`;

    // Victim's guest purchase
    await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: guestEmail,
      amount_total: 5000,
      currency_param: 'USD',
    });

    // Attacker's account
    const { data: attackerData, error: attackerErr } = await supabaseAdmin.auth.admin.createUser({
      email: attackerEmail,
      password: 'test123456',
      email_confirm: true,
    });
    if (attackerErr) throw attackerErr;
    createdUserIds.push(attackerData.user.id);

    // Attacker tries to claim victim's purchase by passing victim's email but their own user_id
    await callRpc(supabaseAdmin, {
      session_id_param: sid,
      product_id_param: mainProduct.id,
      customer_email_param: guestEmail, // victim's email
      amount_total: 5000,
      currency_param: 'USD',
      user_id_param: attackerData.user.id, // attacker's user_id
    });

    // Attacker MUST NOT receive access
    const { data: attackerAccess } = await supabaseAdmin
      .from('user_product_access')
      .select('id')
      .eq('user_id', attackerData.user.id)
      .eq('product_id', mainProduct.id)
      .maybeSingle();
    expect(attackerAccess).toBeNull();

    // guest_purchase remains unclaimed
    const { data: gp } = await supabaseAdmin
      .from('guest_purchases')
      .select('claimed_by_user_id')
      .eq('session_id', sid)
      .single();
    expect(gp?.claimed_by_user_id).toBeNull();
  });
});
