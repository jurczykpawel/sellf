import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { getStripeCheckoutSession } from './helpers/stripe-checkout';

/**
 * Regression e2e for the "sale price displayed but full price charged" bug.
 *
 * The sale price used to be wired only into the strikethrough display; the
 * checkout charge (this is what the buyer actually pays) used the regular price.
 * This drives the real /api/create-payment-intent route and asserts the amount
 * on the resulting Stripe Checkout Session equals the active sale price.
 */

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Sale price is actually charged at checkout', () => {
  let saleProduct: any;
  let expiredSaleProduct: any;

  test.beforeAll(async () => {
    const { data: onSale, error: e1 } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Sale Charge ${Date.now()}`,
        slug: `sale-charge-${Date.now()}`,
        price: 499,
        sale_price: 349,
        sale_price_until: null,
        currency: 'USD',
        description: 'Product on sale',
        is_active: true,
      })
      .select()
      .single();
    if (e1) throw e1;
    saleProduct = onSale;

    const { data: expired, error: e2 } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Expired Sale ${Date.now()}`,
        slug: `expired-sale-${Date.now()}`,
        price: 499,
        sale_price: 349,
        sale_price_until: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        currency: 'USD',
        description: 'Product with an expired sale',
        is_active: true,
      })
      .select()
      .single();
    if (e2) throw e2;
    expiredSaleProduct = expired;
  });

  test.afterAll(async () => {
    if (saleProduct) await supabaseAdmin.from('products').delete().eq('id', saleProduct.id);
    if (expiredSaleProduct) await supabaseAdmin.from('products').delete().eq('id', expiredSaleProduct.id);
  });

  test('charges the active sale price, not the regular price', async ({ request }) => {
    const res = await request.post('/api/create-payment-intent', {
      data: { productId: saleProduct.id, email: 'sale-buyer@example.com' },
    });
    expect(res.status()).toBe(200);

    const { checkoutSessionId } = await res.json();
    const { session } = await getStripeCheckoutSession(checkoutSessionId);

    expect(session.amount_total).toBe(34900);
  });

  test('charges the regular price when the sale has expired', async ({ request }) => {
    const res = await request.post('/api/create-payment-intent', {
      data: { productId: expiredSaleProduct.id, email: 'expired-buyer@example.com' },
    });
    expect(res.status()).toBe(200);

    const { checkoutSessionId } = await res.json();
    const { session } = await getStripeCheckoutSession(checkoutSessionId);

    expect(session.amount_total).toBe(49900);
  });
});
