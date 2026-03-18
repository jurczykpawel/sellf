/**
 * SECURITY TEST: Webhook Amount Validation
 *
 * Tests that Stripe webhook validates payment amounts against product prices
 * to prevent price manipulation attacks.
 *
 * VULNERABILITY: Currently webhook accepts any amount_total from Stripe
 * without comparing it to the actual product.price in database.
 */

import { test, expect } from '@playwright/test';
import Stripe from 'stripe';
import { supabaseAdmin } from './helpers/admin-auth';

test.describe('Webhook Amount Validation Security', () => {
  let stripe: Stripe;
  let testProduct: { id: string; name: string; price: number; currency: string };

  test.beforeAll(async () => {
    const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY;
    if (!stripeKey) {
      throw new Error('Stripe secret key not configured');
    }
    stripe = new Stripe(stripeKey, { apiVersion: '2024-12-18.acacia' });

    // Create test product with price > 0
    const suffix = Date.now().toString();
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Webhook Test Product ${suffix}`,
        slug: `webhook-test-${suffix}`,
        price: 99.99,
        currency: 'USD',
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    testProduct = { id: product.id, name: product.name, price: product.price, currency: product.currency };
    console.log(`Created test product: ${testProduct.name} ($${testProduct.price})`);
  });

  test.afterAll(async () => {
    if (testProduct?.id) {
      await supabaseAdmin.from('payment_transactions').delete().eq('product_id', testProduct.id);
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('SECURITY: Reject webhook with manipulated amount (lower than product price)', async ({ request }) => {
    // This test demonstrates the CRITICAL vulnerability:
    // Webhook accepts amount_total without verifying it matches product.price

    console.log(`Using test product: ${testProduct.name} ($${testProduct.price})`);

    // 2. Create a Stripe checkout session with MANIPULATED amount (only $1)
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: testProduct.name },
          unit_amount: 100, // MANIPULATED: $1.00 instead of $99.99
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
      metadata: {
        product_id: testProduct.id,
      },
    });

    // 3. Call payment processing function directly (simulates webhook)
    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: session.id,
        product_id_param: testProduct.id,
        customer_email_param: 'attacker@example.com',
        amount_total: 100, // MANIPULATED: $1.00 instead of product price
        currency_param: 'usd',
      }
    );

    console.log('\n🔍 Price manipulation test:');
    console.log(`   Product price: $${testProduct.price}`);
    console.log(`   Manipulated amount: $1.00 (100 cents)`);
    console.log(`   Result: ${error ? 'REJECTED ✅' : 'ACCEPTED ❌'}`);

    if (error) {
      console.log(`   Error: ${error.message}`);
    }

    // EXPECTED: Should reject with "Amount mismatch" error
    expect(error).toBeTruthy();
    expect(error?.message).toContain('Amount mismatch');
  });

  test('SECURITY: Accept webhook with correct amount', async ({ request }) => {
    // Positive test: Verify that correct amount is accepted

    // Call with CORRECT amount
    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: 'cs_test_valid_' + Date.now(),
        product_id_param: testProduct.id,
        customer_email_param: 'valid@example.com',
        amount_total: Math.round(testProduct.price * 100), // CORRECT amount in cents
        currency_param: testProduct.currency,
      }
    );

    console.log('\n🔍 Valid amount test:');
    console.log(`   Product price: $${testProduct.price}`);
    console.log(`   Sent amount: $${testProduct.price} (${Math.round(testProduct.price * 100)} cents)`);
    console.log(`   Result: ${error ? 'REJECTED ❌' : 'ACCEPTED ✅'}`);

    // EXPECTED: Should succeed
    expect(error).toBeFalsy();
    expect(result?.success).toBe(true);
  });

  test('SECURITY: Reject currency mismatch', async ({ request }) => {
    // Test currency validation - testProduct is USD

    // Call with WRONG currency (EUR instead of USD)
    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: 'cs_test_currency_' + Date.now(),
        product_id_param: testProduct.id,
        customer_email_param: 'currency-test@example.com',
        amount_total: Math.round(testProduct.price * 100),
        currency_param: 'eur', // WRONG: Product is USD!
      }
    );

    console.log('\n🔍 Currency mismatch test:');
    console.log(`   Product currency: ${testProduct.currency}`);
    console.log(`   Sent currency: EUR`);
    console.log(`   Result: ${error ? 'REJECTED ✅' : 'ACCEPTED ❌'}`);

    if (error) {
      console.log(`   Error: ${error.message}`);
    }

    // EXPECTED: Should reject with "Currency mismatch" error
    expect(error).toBeTruthy();
    expect(error?.message).toContain('Currency mismatch');
  });

});

test.describe('PWYW Amount Validation', () => {
  let pwywProduct: { id: string; price: number; currency: string; custom_price_min: number };
  let pwywFreeProduct: { id: string; price: number; currency: string; custom_price_min: number };
  const suffix = Date.now().toString();

  test.beforeAll(async () => {
    // PWYW product with minimum $5
    const { data: p1, error: e1 } = await supabaseAdmin
      .from('products')
      .insert({
        name: `PWYW Min5 ${suffix}`,
        slug: `pwyw-min5-${suffix}`,
        price: 29.99,
        currency: 'USD',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: 5.00,
      })
      .select()
      .single();
    if (e1) throw e1;
    pwywProduct = { id: p1.id, price: p1.price, currency: p1.currency, custom_price_min: p1.custom_price_min };

    // PWYW product with minimum $0 (free option)
    const { data: p2, error: e2 } = await supabaseAdmin
      .from('products')
      .insert({
        name: `PWYW Free ${suffix}`,
        slug: `pwyw-free-${suffix}`,
        price: 19.99,
        currency: 'USD',
        is_active: true,
        allow_custom_price: true,
        custom_price_min: 0,
      })
      .select()
      .single();
    if (e2) throw e2;
    pwywFreeProduct = { id: p2.id, price: p2.price, currency: p2.currency, custom_price_min: p2.custom_price_min };
  });

  test.afterAll(async () => {
    for (const p of [pwywProduct, pwywFreeProduct]) {
      if (p?.id) {
        await supabaseAdmin.from('payment_transactions').delete().eq('product_id', p.id);
        await supabaseAdmin.from('products').delete().eq('id', p.id);
      }
    }
  });

  test('PWYW: accept amount below listed price but above minimum', async () => {
    // Product price $29.99, min $5.00 — pay $10.00
    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: `cs_test_pwyw_below_${suffix}`,
        product_id_param: pwywProduct.id,
        customer_email_param: `pwyw-below-${suffix}@example.com`,
        amount_total: 1000, // $10.00 — below $29.99 but above $5.00 min
        currency_param: 'usd',
      }
    );

    expect(error, 'PWYW should accept amount above minimum').toBeFalsy();
    expect(result?.success).toBe(true);
  });

  test('PWYW: accept amount above listed price', async () => {
    // Product price $29.99, min $5.00 — pay $50.00
    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: `cs_test_pwyw_above_${suffix}`,
        product_id_param: pwywProduct.id,
        customer_email_param: `pwyw-above-${suffix}@example.com`,
        amount_total: 5000, // $50.00 — above listed price
        currency_param: 'usd',
      }
    );

    expect(error, 'PWYW should accept amount above listed price').toBeFalsy();
    expect(result?.success).toBe(true);
  });

  test('PWYW: accept exact minimum price', async () => {
    // Product price $29.99, min $5.00 — pay exactly $5.00
    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: `cs_test_pwyw_exact_min_${suffix}`,
        product_id_param: pwywProduct.id,
        customer_email_param: `pwyw-exact-min-${suffix}@example.com`,
        amount_total: 500, // $5.00 — exact minimum
        currency_param: 'usd',
      }
    );

    expect(error, 'PWYW should accept exact minimum').toBeFalsy();
    expect(result?.success).toBe(true);
  });

  test('SECURITY: PWYW reject amount below minimum', async () => {
    // Product price $29.99, min $5.00 — try $2.00
    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: `cs_test_pwyw_below_min_${suffix}`,
        product_id_param: pwywProduct.id,
        customer_email_param: `pwyw-reject-${suffix}@example.com`,
        amount_total: 200, // $2.00 — below $5.00 minimum
        currency_param: 'usd',
      }
    );

    expect(error, 'PWYW should reject amount below minimum').toBeTruthy();
    expect(error?.message).toContain('Amount below minimum');
  });

  test('PWYW free: accept $0 minimum (any positive amount)', async () => {
    // Product price $19.99, min $0 — pay $1.00
    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: `cs_test_pwyw_free_pos_${suffix}`,
        product_id_param: pwywFreeProduct.id,
        customer_email_param: `pwyw-free-pos-${suffix}@example.com`,
        amount_total: 100, // $1.00 — min is $0
        currency_param: 'usd',
      }
    );

    expect(error, 'PWYW free should accept any positive amount').toBeFalsy();
    expect(result?.success).toBe(true);
  });

  test('PWYW: accept exact listed price (normal flow)', async () => {
    // Product price $29.99, min $5.00 — pay full $29.99
    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: `cs_test_pwyw_full_${suffix}`,
        product_id_param: pwywProduct.id,
        customer_email_param: `pwyw-full-${suffix}@example.com`,
        amount_total: 2999, // $29.99 — exact listed price
        currency_param: 'usd',
      }
    );

    expect(error, 'PWYW should accept exact listed price').toBeFalsy();
    expect(result?.success).toBe(true);
  });

  test('SECURITY: fixed-price product still rejects wrong amount', async () => {
    // Ensure PWYW fix didn't break fixed-price validation
    const { data: fixedProduct, error: createErr } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Fixed Price ${suffix}`,
        slug: `fixed-price-${suffix}`,
        price: 49.99,
        currency: 'USD',
        is_active: true,
        allow_custom_price: false,
      })
      .select()
      .single();
    if (createErr) throw createErr;

    const { data: result, error } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: `cs_test_fixed_wrong_${suffix}`,
        product_id_param: fixedProduct.id,
        customer_email_param: `fixed-wrong-${suffix}@example.com`,
        amount_total: 1000, // $10.00 — wrong for $49.99 product
        currency_param: 'usd',
      }
    );

    expect(error, 'Fixed-price should reject wrong amount').toBeTruthy();
    expect(error?.message).toContain('Amount mismatch');

    // Cleanup
    await supabaseAdmin.from('products').delete().eq('id', fixedProduct.id);
  });
});
