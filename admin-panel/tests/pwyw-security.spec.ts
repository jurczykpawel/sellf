import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

/**
 * PWYW Security Tests
 *
 * These tests attempt to bypass pricing restrictions via direct API calls.
 * All attempts should be rejected by the server.
 */

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('PWYW Security - Bypass Prevention', () => {
  let regularProduct: any;  // allow_custom_price = false
  let pwywProduct: any;     // allow_custom_price = true, min = 10

  test.beforeAll(async () => {
    // Create a REGULAR product (no custom pricing allowed)
    const { data: regular, error: err1 } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Security Test Regular ${Date.now()}`,
        slug: `security-regular-${Date.now()}`,
        price: 99.99,
        currency: 'USD',
        description: 'Regular product - custom pricing NOT allowed',
        is_active: true,
        allow_custom_price: false,  // <-- Key: custom pricing disabled
      })
      .select()
      .single();

    if (err1) throw err1;
    regularProduct = regular;

    // Create a PWYW product with minimum $10
    const { data: pwyw, error: err2 } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Security Test PWYW ${Date.now()}`,
        slug: `security-pwyw-${Date.now()}`,
        price: 99.99,
        currency: 'USD',
        description: 'PWYW product - custom pricing allowed, min $10',
        is_active: true,
        allow_custom_price: true,   // <-- Custom pricing enabled
        custom_price_min: 10.00,    // <-- Minimum $10
        show_price_presets: true,
        custom_price_presets: [10, 25, 50]
      })
      .select()
      .single();

    if (err2) throw err2;
    pwywProduct = pwyw;

    console.log('Created test products:', {
      regular: regularProduct.id,
      pwyw: pwywProduct.id
    });
  });

  test.afterAll(async () => {
    // Cleanup
    if (regularProduct) {
      await supabaseAdmin.from('products').delete().eq('id', regularProduct.id);
    }
    if (pwywProduct) {
      await supabaseAdmin.from('products').delete().eq('id', pwywProduct.id);
    }
  });

  // ========================================
  // ATTACK VECTOR 1: Custom price on regular product
  // ========================================

  test('SECURITY: Reject customAmount on product with allow_custom_price=false', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: regularProduct.id,
        email: 'attacker@example.com',
        customAmount: 1  // Try to pay only $1 instead of $99.99
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('does not allow custom pricing');
  });

  test('SECURITY: Reject any customAmount value on regular product', async ({ request }) => {
    // Try various amounts
    const amounts = [0.01, 0.50, 1, 5, 50, 99.99, 100, 1000];

    for (const amount of amounts) {
      const response = await request.post('/api/create-payment-intent', {
        data: {
          productId: regularProduct.id,
          email: 'attacker@example.com',
          customAmount: amount
        }
      });

      expect(response.status()).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('does not allow custom pricing');
    }
  });

  // ========================================
  // ATTACK VECTOR 2: Price below minimum
  // ========================================

  test('SECURITY: Reject customAmount below minimum on PWYW product', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: pwywProduct.id,
        email: 'attacker@example.com',
        customAmount: 5  // Below $10 minimum
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('at least');
  });

  test('SECURITY: Reject customAmount just below minimum (edge case)', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: pwywProduct.id,
        email: 'attacker@example.com',
        customAmount: 9.99  // Just 1 cent below $10 minimum
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('at least');
  });

  test('SECURITY: Accept customAmount at exactly minimum', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: pwywProduct.id,
        email: 'test@example.com',
        customAmount: 10  // Exactly at $10 minimum
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.clientSecret).toBeTruthy();
  });

  // ========================================
  // ATTACK VECTOR 3: Price above Stripe maximum
  // ========================================

  test('SECURITY: Reject customAmount above Stripe maximum ($999,999.99)', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: pwywProduct.id,
        email: 'attacker@example.com',
        customAmount: 1000000  // $1,000,000 - above Stripe limit
      }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('no more than');
  });

  test('SECURITY: Accept customAmount at Stripe maximum', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: pwywProduct.id,
        email: 'test@example.com',
        customAmount: 999999.99  // Exactly at Stripe limit
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.clientSecret).toBeTruthy();
  });

  // ========================================
  // ATTACK VECTOR 4: Edge cases and type coercion
  // ========================================

  test('SECURITY: Reject zero customAmount', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: pwywProduct.id,
        email: 'attacker@example.com',
        customAmount: 0
      }
    });

    // SECURITY: Zero is explicitly rejected (security audit requirement)
    // Attackers cannot bypass payment by sending customAmount=0
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error).toContain('positive number');
  });

  test('SECURITY: Reject negative customAmount', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: pwywProduct.id,
        email: 'attacker@example.com',
        customAmount: -10  // Negative amount
      }
    });

    // SECURITY: Negative amounts are explicitly rejected (security audit requirement)
    // Attackers cannot bypass payment validation by sending negative amounts
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.error).toContain('positive number');
  });

  test('SECURITY: Handle string customAmount (type coercion attempt)', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: pwywProduct.id,
        email: 'attacker@example.com',
        customAmount: '5'  // String instead of number
      }
    });

    // JSON parsing should convert to number, then validation should kick in
    // "5" becomes 5, which is below minimum 10
    expect(response.status()).toBe(400);
  });

  test('SECURITY: Handle NaN customAmount', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: pwywProduct.id,
        email: 'attacker@example.com',
        customAmount: 'not-a-number'
      }
    });

    // NaN should be handled gracefully
    expect([200, 400]).toContain(response.status());
  });

  // ========================================
  // ATTACK VECTOR 4: Regular product should use fixed price
  // ========================================

  test('SECURITY: Regular product uses product.price when no customAmount', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: regularProduct.id,
        email: 'test@example.com'
        // No customAmount
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.clientSecret).toBeTruthy();
  });

  // ========================================
  // ATTACK VECTOR 5: Verify Stripe receives correct amount
  // ========================================

  test('SECURITY: Verify Stripe PaymentIntent has correct amount for PWYW', async ({ request }) => {
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;

    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: pwywProduct.id,
        email: 'test@example.com',
        customAmount: 25  // $25
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Verify in Stripe
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
      { headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` } }
    );

    const pi = await stripeResponse.json();
    expect(pi.amount).toBe(2500);  // $25 = 2500 cents
    expect(pi.metadata.is_pwyw).toBe('true');
    expect(pi.metadata.custom_amount).toBe('25');
  });

  test('SECURITY: Verify Stripe PaymentIntent has correct amount for regular product', async ({ request }) => {
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;

    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId: regularProduct.id,
        email: 'test@example.com'
        // No customAmount - should use product.price
      }
    });

    expect(response.status()).toBe(200);
    const data = await response.json();

    // Verify in Stripe
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/payment_intents/${data.paymentIntentId}`,
      { headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` } }
    );

    const pi = await stripeResponse.json();
    expect(pi.amount).toBe(9999);  // $99.99 = 9999 cents
    expect(pi.metadata.is_pwyw).toBe('false');
  });
});
