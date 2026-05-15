import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// PWYW subscriptions: a subscription product with allow_custom_price=true
// lets the buyer pick the monthly amount. Backend creates a Stripe
// Subscription with inline price_data via the new
// createSubscriptionWithDynamicPrice helper, returns a PaymentIntent
// clientSecret. Front-end mounts the same <PaymentElement> as one-shot.
//
// This is the building block for monthly tip-jar (Phase 8+ surfaces a
// per-buyer toggle inside the tip-jar template); for Phase 3c we ship the
// global capability, accessible by creating a subscription product with
// allow_custom_price=true in the admin panel.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('PWYW subscriptions', () => {
  test.describe.configure({ mode: 'serial' });

  let productId: string;

  test.beforeAll(async () => {
    const slug = `pwyw-sub-${Date.now()}`;
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'PWYW Subscription',
        slug,
        price: 5,
        currency: 'USD',
        is_active: true,
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 5,
        allow_custom_price: true,
        custom_price_min: 1,
        show_price_presets: true,
        custom_price_presets: [3, 5, 10, 25],
      })
      .select('id, slug')
      .single();
    if (error || !data) throw error;
    productId = data.id;
  });

  test.afterAll(async () => {
    if (productId) await supabaseAdmin.from('products').delete().eq('id', productId);
  });

  test('create-payment-intent accepts customAmount + product_type=subscription, returns clientSecret', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId,
        email: `pwyw-sub-${Date.now()}@example.com`,
        customAmount: 7.5,
      },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(typeof body.clientSecret).toBe('string');
    // PaymentIntent client_secret (from subscription.latest_invoice) starts with pi_
    expect(body.clientSecret).toMatch(/^pi_/);
    expect(typeof body.subscriptionId).toBe('string');
    expect(body.subscriptionId.startsWith('sub_')).toBe(true);
  });

  test('rejects PWYW subscription request below custom_price_min', async ({ request }) => {
    const response = await request.post('/api/create-payment-intent', {
      data: {
        productId,
        email: `pwyw-sub-low-${Date.now()}@example.com`,
        customAmount: 0.5,
      },
    });
    expect(response.status()).toBe(400);
  });

  test('fixed-price subscription without allow_custom_price still rejects customAmount (regression)', async ({ request }) => {
    const { data: fixed } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Fixed Subscription',
        slug: `pwyw-sub-fixed-${Date.now()}`,
        price: 19.99,
        currency: 'USD',
        is_active: true,
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 19.99,
        allow_custom_price: false,
      })
      .select('id')
      .single();
    if (!fixed?.id) throw new Error('failed to create fixed-price subscription fixture');
    try {
      const response = await request.post('/api/create-payment-intent', {
        data: {
          productId: fixed.id,
          email: `pwyw-sub-fixed-${Date.now()}@example.com`,
          customAmount: 10,
        },
      });
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(JSON.stringify(body)).toMatch(/custom amounts|custom amount|coupon|bump/i);
    } finally {
      await supabaseAdmin.from('products').delete().eq('id', fixed.id);
    }
  });
});
