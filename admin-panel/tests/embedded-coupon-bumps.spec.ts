import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
  throw new Error('Missing test env variables for embedded coupon bump tests');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function getStripeCheckoutSession(sessionId: string) {
  const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  expect(sessionRes.ok, `Stripe checkout session fetch failed: ${sessionRes.status}`).toBeTruthy();
  const session = await sessionRes.json();

  const lineItemsRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  expect(lineItemsRes.ok, `Stripe line items fetch failed: ${lineItemsRes.status}`).toBeTruthy();
  const lineItems = await lineItemsRes.json();

  return { session, lineItems: lineItems.data as Array<{ amount_total: number; description: string }> };
}

test.describe('Embedded checkout coupon + order bumps', () => {
  const productIds: string[] = [];
  const couponIds: string[] = [];
  const orderBumpIds: string[] = [];

  test.beforeEach(async () => {
    await supabaseAdmin
      .from('application_rate_limits')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await supabaseAdmin
      .from('rate_limits')
      .delete()
      .in('function_name', ['verify_coupon', 'global_verify_coupon']);
  });

  test.afterEach(async () => {
    if (couponIds.length > 0) {
      await supabaseAdmin.from('coupon_reservations').delete().in('coupon_id', couponIds);
      await supabaseAdmin.from('coupon_redemptions').delete().in('coupon_id', couponIds);
      await supabaseAdmin.from('coupons').delete().in('id', couponIds.splice(0, couponIds.length));
    }
    if (orderBumpIds.length > 0) {
      await supabaseAdmin.from('order_bumps').delete().in('id', orderBumpIds.splice(0, orderBumpIds.length));
    }
    if (productIds.length > 0) {
      await supabaseAdmin.from('products').delete().in('id', productIds.splice(0, productIds.length));
    }
  });

  test('global fixed coupon distributes across embedded checkout line items including bumps', async ({ request }) => {
    const ts = Date.now();

    const { data: mainProduct } = await supabaseAdmin.from('products').insert({
      name: `Embedded main ${ts}`,
      slug: `embedded-main-${ts}`,
      price: 100,
      currency: 'USD',
      is_active: true,
    }).select().single();
    productIds.push(mainProduct!.id);

    const { data: bump1 } = await supabaseAdmin.from('products').insert({
      name: `Embedded bump 1 ${ts}`,
      slug: `embedded-bump1-${ts}`,
      price: 50,
      currency: 'USD',
      is_active: true,
    }).select().single();
    productIds.push(bump1!.id);

    const { data: bump2 } = await supabaseAdmin.from('products').insert({
      name: `Embedded bump 2 ${ts}`,
      slug: `embedded-bump2-${ts}`,
      price: 70,
      currency: 'USD',
      is_active: true,
    }).select().single();
    productIds.push(bump2!.id);

    const { data: orderBumps } = await supabaseAdmin.from('order_bumps').insert([
      {
        main_product_id: mainProduct!.id,
        bump_product_id: bump1!.id,
        bump_title: 'Embedded bump one',
        bump_price: 20,
        is_active: true,
        display_order: 1,
      },
      {
        main_product_id: mainProduct!.id,
        bump_product_id: bump2!.id,
        bump_title: 'Embedded bump two',
        bump_price: 30,
        is_active: true,
        display_order: 2,
      },
    ]).select();
    orderBumpIds.push(...(orderBumps || []).map((item) => item.id));

    const { data: coupon } = await supabaseAdmin.from('coupons').insert({
      code: `EMBFIX${ts}`,
      name: 'Embedded fixed coupon',
      discount_type: 'fixed',
      discount_value: 40,
      currency: 'USD',
      exclude_order_bumps: false,
      is_active: true,
      allowed_product_ids: [],
    }).select().single();
    couponIds.push(coupon!.id);

    const response = await request.post('/api/create-embedded-checkout', {
      data: {
        productId: mainProduct!.id,
        email: `embedded-fixed-${ts}@example.com`,
        bumpProductIds: [bump1!.id, bump2!.id],
        couponCode: coupon!.code,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.sessionId).toBeTruthy();

    const { session, lineItems } = await getStripeCheckoutSession(body.sessionId);
    expect(session.amount_total).toBe(11000);
    expect(lineItems.map((item) => item.amount_total)).toEqual([7333, 1467, 2200]);
  });

  test('product-scoped coupon in embedded checkout never discounts bumps even if bump id is also listed', async ({ request }) => {
    const ts = Date.now();

    const { data: mainProduct } = await supabaseAdmin.from('products').insert({
      name: `Embedded scoped main ${ts}`,
      slug: `embedded-scoped-main-${ts}`,
      price: 100,
      currency: 'USD',
      is_active: true,
    }).select().single();
    productIds.push(mainProduct!.id);

    const { data: bump1 } = await supabaseAdmin.from('products').insert({
      name: `Embedded scoped bump 1 ${ts}`,
      slug: `embedded-scoped-bump1-${ts}`,
      price: 50,
      currency: 'USD',
      is_active: true,
    }).select().single();
    productIds.push(bump1!.id);

    const { data: bump2 } = await supabaseAdmin.from('products').insert({
      name: `Embedded scoped bump 2 ${ts}`,
      slug: `embedded-scoped-bump2-${ts}`,
      price: 70,
      currency: 'USD',
      is_active: true,
    }).select().single();
    productIds.push(bump2!.id);

    const { data: orderBumps } = await supabaseAdmin.from('order_bumps').insert([
      {
        main_product_id: mainProduct!.id,
        bump_product_id: bump1!.id,
        bump_title: 'Scoped bump one',
        bump_price: 20,
        is_active: true,
        display_order: 1,
      },
      {
        main_product_id: mainProduct!.id,
        bump_product_id: bump2!.id,
        bump_title: 'Scoped bump two',
        bump_price: 30,
        is_active: true,
        display_order: 2,
      },
    ]).select();
    orderBumpIds.push(...(orderBumps || []).map((item) => item.id));

    const { data: coupon } = await supabaseAdmin.from('coupons').insert({
      code: `EMBSCOPE${ts}`,
      name: 'Embedded scoped coupon',
      discount_type: 'percentage',
      discount_value: 10,
      exclude_order_bumps: false,
      is_active: true,
      allowed_product_ids: [mainProduct!.id, bump1!.id],
    }).select().single();
    couponIds.push(coupon!.id);

    const response = await request.post('/api/create-embedded-checkout', {
      data: {
        productId: mainProduct!.id,
        email: `embedded-scope-${ts}@example.com`,
        bumpProductIds: [bump1!.id, bump2!.id],
        couponCode: coupon!.code,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();

    const { session, lineItems } = await getStripeCheckoutSession(body.sessionId);
    expect(session.amount_total).toBe(14000);
    expect(lineItems.map((item) => item.amount_total)).toEqual([9000, 2000, 3000]);
  });
});
