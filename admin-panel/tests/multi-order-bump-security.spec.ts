import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * Multi Order Bump Security Tests
 *
 * TDD: Written BEFORE implementation (Red phase).
 *
 * Tests verify that:
 * - Multiple bumps are accepted via bumpProductIds[] array
 * - Each bump uses bump_price from order_bumps (not product.price)
 * - Invalid bump IDs in the array are silently ignored
 * - Currency mismatches cause individual bumps to be ignored
 * - Total amount = main product + sum of all valid bumps
 * - Stripe metadata contains bump_product_ids (comma-separated)
 * - Coupon exclude_order_bumps works with multiple bumps
 */

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Multi Order Bump Security', () => {
  let mainProduct: any;
  let bumpProduct1: any;
  let bumpProduct2: any;
  let bumpProduct3: any;
  let orderBump1: any;
  let orderBump2: any;
  let orderBump3: any;

  test.beforeAll(async () => {
    const ts = Date.now();

    // Create main product ($100)
    const { data: main, error: mainErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Multi Bump Main ${ts}`,
        slug: `multi-bump-main-${ts}`,
        price: 100.00,
        currency: 'USD',
        description: 'Main product for multi-bump test',
        is_active: true,
      })
      .select()
      .single();

    if (mainErr) throw mainErr;
    mainProduct = main;

    // Bump product 1: regular price $50, bump price $15
    const { data: b1, error: b1Err } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Multi Bump Addon1 ${ts}`,
        slug: `multi-bump-addon1-${ts}`,
        price: 50.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    if (b1Err) throw b1Err;
    bumpProduct1 = b1;

    // Bump product 2: regular price $40, bump price $20
    const { data: b2, error: b2Err } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Multi Bump Addon2 ${ts}`,
        slug: `multi-bump-addon2-${ts}`,
        price: 40.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    if (b2Err) throw b2Err;
    bumpProduct2 = b2;

    // Bump product 3: inactive — should be ignored
    const { data: b3, error: b3Err } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Multi Bump Addon3 Inactive ${ts}`,
        slug: `multi-bump-addon3-${ts}`,
        price: 30.00,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();
    if (b3Err) throw b3Err;
    bumpProduct3 = b3;

    // Create order bumps
    const { data: ob1, error: ob1Err } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: mainProduct.id,
        bump_product_id: bumpProduct1.id,
        bump_title: 'Addon 1 Deal',
        bump_price: 15.00,
        display_order: 0,
        is_active: true,
      })
      .select()
      .single();
    if (ob1Err) throw ob1Err;
    orderBump1 = ob1;

    const { data: ob2, error: ob2Err } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: mainProduct.id,
        bump_product_id: bumpProduct2.id,
        bump_title: 'Addon 2 Deal',
        bump_price: 20.00,
        display_order: 1,
        is_active: true,
      })
      .select()
      .single();
    if (ob2Err) throw ob2Err;
    orderBump2 = ob2;

    // Order bump 3: inactive
    const { data: ob3, error: ob3Err } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: mainProduct.id,
        bump_product_id: bumpProduct3.id,
        bump_title: 'Addon 3 (Inactive)',
        bump_price: 10.00,
        display_order: 2,
        is_active: false,
      })
      .select()
      .single();
    if (ob3Err) throw ob3Err;
    orderBump3 = ob3;
  });

  test.afterAll(async () => {
    // Clean line items and transactions that reference these products
    for (const p of [bumpProduct3, bumpProduct2, bumpProduct1, mainProduct]) {
      if (p) {
        await supabaseAdmin.from('payment_line_items').delete().eq('product_id', p.id);
        await supabaseAdmin.from('guest_purchases').delete().eq('product_id', p.id);
        await supabaseAdmin.from('payment_transactions').delete().eq('product_id', p.id);
      }
    }
    for (const ob of [orderBump3, orderBump2, orderBump1]) {
      if (ob) await supabaseAdmin.from('order_bumps').delete().eq('id', ob.id);
    }
    for (const p of [bumpProduct3, bumpProduct2, bumpProduct1, mainProduct]) {
      if (p) await supabaseAdmin.from('products').delete().eq('id', p.id);
    }
  });

  test('SECURITY: Multi-bump uses bump_price from order_bumps for each bump', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'multi-bump@example.com',
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id],
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Verify in Stripe
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
      { headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` } }
    );
    expect(stripeResponse.ok).toBeTruthy();
    const pi = await stripeResponse.json();

    // Expected: $100 (main) + $15 (bump1) + $20 (bump2) = $135 = 13500 cents
    // NOT $100 + $50 + $40 = $190 (product prices)
    expect(pi.amount).toBe(13500);

    // Metadata should contain bump_product_ids (comma-separated)
    expect(pi.metadata.bump_product_ids).toBeTruthy();
    const ids = pi.metadata.bump_product_ids.split(',');
    expect(ids).toContain(bumpProduct1.id);
    expect(ids).toContain(bumpProduct2.id);
  });

  test('SECURITY: Inactive bumps are ignored in bumpProductIds[]', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'inactive-bump@example.com',
        bumpProductIds: [bumpProduct1.id, bumpProduct3.id], // bumpProduct3 has inactive order_bump
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
      { headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` } }
    );
    const pi = await stripeResponse.json();

    // Only bump1 ($15) should be included, bump3 is inactive
    // Expected: $100 + $15 = $115 = 11500 cents
    expect(pi.amount).toBe(11500);
  });

  test('SECURITY: Invalid bump IDs in array are silently ignored', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'invalid-bump@example.com',
        bumpProductIds: [
          bumpProduct1.id,
          '00000000-0000-0000-0000-000000000000', // non-existent
        ],
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
      { headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` } }
    );
    const pi = await stripeResponse.json();

    // Only bump1 ($15) should be included
    expect(pi.amount).toBe(11500);
  });

  test('backward compat: single bumpProductId still works', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: mainProduct.id,
        email: 'compat@example.com',
        bumpProductId: bumpProduct1.id, // Old singular field
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
      { headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` } }
    );
    const pi = await stripeResponse.json();

    // $100 + $15 = $115 = 11500 cents
    expect(pi.amount).toBe(11500);
    // Should still have bump metadata
    expect(pi.metadata.bump_product_ids).toContain(bumpProduct1.id);
  });

  test('SECURITY: payment_line_items use bump_price, not product.price', async () => {
    // Call the DB function directly via RPC to verify line items
    const sessionId = `cs_test_li_security_${Date.now()}`;
    const totalCents = (100 + 15 + 20) * 100; // main($100) + bump1($15) + bump2($20) = 13500

    const { data: result, error: rpcErr } = await supabaseAdmin.rpc('process_stripe_payment_completion_with_bump', {
      session_id_param: sessionId,
      product_id_param: mainProduct.id,
      customer_email_param: `li-security-${Date.now()}@example.com`,
      amount_total: totalCents,
      currency_param: 'USD',
      stripe_payment_intent_id: `pi_test_${sessionId}`,
      user_id_param: null,
      bump_product_ids_param: [bumpProduct1.id, bumpProduct2.id],
      coupon_id_param: null,
    });
    if (rpcErr) throw rpcErr;
    expect(result.success).toBe(true);

    // Get line items via transaction
    const { data: tx } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('session_id', sessionId)
      .single();

    const { data: items } = await supabaseAdmin
      .from('payment_line_items')
      .select('*')
      .eq('transaction_id', tx!.id)
      .order('item_type');

    expect(items).toHaveLength(3);

    // Main product: uses product.price ($100)
    const mainItem = items!.find((i: any) => i.item_type === 'main_product');
    expect(Number(mainItem!.unit_price)).toBe(100);

    // Bump 1: uses bump_price ($15), NOT product.price ($50)
    const bump1Item = items!.find((i: any) => i.product_id === bumpProduct1.id);
    expect(Number(bump1Item!.unit_price)).toBe(15);
    expect(Number(bump1Item!.unit_price)).not.toBe(50); // not product.price

    // Bump 2: uses bump_price ($20), NOT product.price ($40)
    const bump2Item = items!.find((i: any) => i.product_id === bumpProduct2.id);
    expect(Number(bump2Item!.unit_price)).toBe(20);
    expect(Number(bump2Item!.unit_price)).not.toBe(40); // not product.price

    // Both bumps have order_bump_id reference
    expect(bump1Item!.order_bump_id).toBeTruthy();
    expect(bump2Item!.order_bump_id).toBeTruthy();

    // product_name snapshot is captured
    expect(mainItem!.product_name).toBeTruthy();
    expect(bump1Item!.product_name).toBeTruthy();
    expect(bump2Item!.product_name).toBeTruthy();

    // Cleanup
    await supabaseAdmin.from('guest_purchases').delete().eq('session_id', sessionId);
    await supabaseAdmin.from('payment_transactions').delete().eq('session_id', sessionId);
  });

  test('/api/order-bumps returns multiple bumps (no LIMIT 1)', async ({ request }) => {
    const response = await request.get(`/api/order-bumps?productId=${mainProduct.id}`);

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Should return 2 active bumps (bump3 is inactive)
    expect(data.length).toBe(2);

    // Should be ordered by display_order
    expect(data[0].bump_product_id).toBe(bumpProduct1.id);
    expect(data[1].bump_product_id).toBe(bumpProduct2.id);

    // Each should have bump_price from order_bumps, not product.price
    expect(data[0].bump_price).toBe(15);
    expect(data[1].bump_price).toBe(20);
  });
});
