/**
 * Our paid Stripe payment for a product deleted from this shop cannot be fulfilled and redeliveries would never
 * help: the webhook acknowledges it and the seller sees it in Payments as a paid payment waiting for a decision.
 * A product that still exists but was deactivated after checkout started is fulfilled instead.
 * Real sandbox event (`stripe trigger`) carrying this installation's marker.
 * @see src/lib/stripe/payment-reconciliation.ts
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { loginAsAdmin, createTestAdmin, supabaseAdmin as db } from './helpers/admin-auth';
import { paidCheckoutEvent, clearPaidCheckout, sendStripeEvent } from './helpers/stripe-test-events';
import { getStripeInstanceId } from '@/lib/stripe/instance-marker';
import { PAYMENT_RECONCILIATION_ACTION } from '@/lib/stripe/payment-reconciliation';
import type Stripe from 'stripe';

test.describe.configure({ mode: 'serial' });
test.skip(!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'), 'Stripe sandbox keys required');

let sessionId = '';
let paymentIntentId = '';
let inactiveSessionId = '';
let inactiveProductId = '';

test.afterAll(async () => {
  if (paymentIntentId) await db.from('admin_actions').delete().eq('action', PAYMENT_RECONCILIATION_ACTION).eq('target_id', paymentIntentId);
  if (sessionId) await clearPaidCheckout(sessionId);
  if (inactiveSessionId) await clearPaidCheckout(inactiveSessionId);
  if (inactiveProductId) {
    await db.from('guest_purchases').delete().eq('product_id', inactiveProductId);
    await db.from('payment_line_items').delete().eq('product_id', inactiveProductId);
    await db.from('payment_transactions').delete().eq('product_id', inactiveProductId);
    await db.from('products').delete().eq('id', inactiveProductId);
  }
});

test('a paid payment for a product deactivated after checkout is fulfilled, not parked for a decision @J611', async ({ request }) => {
  test.setTimeout(180000);
  const { data: product, error } = await db.from('products')
    .insert({ name: 'Wyłączony kurs', slug: `inactive-${randomUUID()}`, price: 49.99, currency: 'usd', is_active: true }).select('id').single();
  expect(error).toBeNull();
  inactiveProductId = product!.id;
  const email = `inactive-product-${Date.now()}@example.com`;
  const event = await paidCheckoutEvent(product!.id, email, 4999, { sellf_instance: await getStripeInstanceId() });
  inactiveSessionId = (event.data.object as Stripe.Checkout.Session).id;
  expect((await db.from('products').update({ is_active: false }).eq('id', product!.id)).error).toBeNull();

  const response = await sendStripeEvent(request, event);
  expect(response.status()).toBe(200);
  expect(await response.json()).not.toHaveProperty('skipped');
  const { data: tx } = await db.from('payment_transactions').select('status, amount').eq('session_id', inactiveSessionId).single();
  expect(tx).toMatchObject({ status: 'completed', amount: 4999 });
  const { count: purchases } = await db.from('guest_purchases').select('id', { count: 'exact', head: true }).eq('customer_email', email).eq('product_id', product!.id);
  expect(purchases).toBe(1);
  const { count: parked } = await db.from('admin_actions').select('id', { count: 'exact', head: true }).eq('action', PAYMENT_RECONCILIATION_ACTION).eq('details->>session_id', inactiveSessionId);
  expect(parked).toBe(0);
});

test('a paid payment for a deleted product is acknowledged and shown to the seller for a decision @J610', async ({ request, page }) => {
  test.setTimeout(180000);
  const { data: product, error } = await db.from('products')
    .insert({ name: 'Usunięty kurs', slug: `deleted-${randomUUID()}`, price: 49.99, currency: 'usd', is_active: true }).select('id').single();
  expect(error).toBeNull();
  expect((await db.from('products').delete().eq('id', product!.id)).error).toBeNull();
  const email = `deleted-product-${Date.now()}@example.com`;
  const event = await paidCheckoutEvent(product!.id, email, 4999, { sellf_instance: await getStripeInstanceId() });
  const session = event.data.object as Stripe.Checkout.Session;
  sessionId = session.id;
  paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent!.id;

  for (let delivery = 0; delivery < 2; delivery++) expect((await sendStripeEvent(request, event)).status()).toBe(200);
  const { data: rows } = await db.from('admin_actions').select('details').eq('action', PAYMENT_RECONCILIATION_ACTION).eq('target_id', paymentIntentId);
  expect(rows).toHaveLength(1);
  expect(rows![0].details).toMatchObject({ amount: 4999, currency: 'usd', customer_email: email, product_id: product!.id });

  const admin = await createTestAdmin('reconciliation-panel');
  try {
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/payments');
    const panel = page.getByTestId('payments-reconciliation');
    await expect(panel).toBeVisible({ timeout: 30000 });
    await expect(panel.locator('summary')).toContainText(/na Twoją decyzję/);
    const row = panel.locator('tr', { hasText: paymentIntentId });
    await expect(row).toContainText(email);
    await expect(row).toContainText('49,99');
  } finally { await admin.cleanup(); }
});
