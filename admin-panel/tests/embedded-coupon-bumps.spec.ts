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

  // NOTE: Coverage gap — coupon distribution and product-scoped coupon behavior on embedded
  // checkout (with order bumps) lost coverage when the legacy in-app checkout route was retired.
  // These scenarios need retargeting to /api/embed/checkout-session (different contract) as a
  // follow-up before re-enabling E2E coverage.
});
