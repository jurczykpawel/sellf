/** Online payment of unpaid transfer orders from the pay link, on real Stripe test mode (hosted Checkout + real webhook events).
 * Buyer: pays on the order page; seller: order completed, settled via Stripe; integrator: order.* / purchase.completed. */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import Stripe from 'stripe';
import { loginAsAdmin, supabaseAdmin as db } from '../helpers/admin-auth';
import { signTransferToken } from '@/lib/orders/transfer-token';
import type { Page } from '@playwright/test';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
test.describe.configure({ mode: 'serial' });
let product: { id: string }, sessionId: string, endpointId: string, bankConfig: unknown;
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<NonNullable<T>> { if (error) throw error; return data!; }
async function place(email: string, price: number): Promise<string> {
  const placed = await checked(await db.rpc('bank_transfer_order', { p_order: { product_id: product.id, currency: 'PLN', customer_email: email,
    order_details: { v: 1, buyer: { type: 'organization', terms_accepted: true } }, metadata: { locale: 'pl' } },
  p_lines: [{ product_id: product.id, item_type: 'main_product', quantity: 1, unit_price: price, total_price: price, discounted_total: price, currency: 'PLN', session_id: sessionId }] }));
  return (placed as { transaction_id: string }).transaction_id;
}
const orderPage = (id: string) => `/pl/order/${id}/transfer?token=${signTransferToken(id)}`;
async function payOnHostedCheckout(page: Page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
  // Hosted Checkout lists PLN methods (card, BLIK, P24); the card form opens from its accordion item when several are offered.
  const number = page.locator('input[name="cardNumber"]'), card = page.getByTestId('card-accordion-item');
  await expect(number.or(card).first()).toBeVisible({ timeout: 60000 });
  if (!await number.isVisible()) await card.click();
  await page.locator('input[name="cardNumber"]').fill('4242424242424242');
  await page.locator('input[name="cardExpiry"]').fill('1234');
  await page.locator('input[name="cardCvc"]').fill('123');
  const name = page.locator('input[name="billingName"]'); if (await name.isVisible()) await name.fill('Quick Pay Buyer');
  await page.getByTestId('hosted-payment-submit-button').click();
  await page.waitForURL(/\/order\/.*\/transfer\?token=/, { timeout: 120000 });
}
const events = async (type: string, id: string) => ((await db.from('webhook_logs').select('payload').eq('endpoint_id', endpointId).eq('event_type', type)).data ?? [])
  .filter(r => (r.payload as { data: { order: { orderId?: string; id?: string } } }).data.order?.orderId === id || JSON.stringify(r.payload).includes(id));

test.beforeAll(async () => {
  bankConfig = await checked(await db.from('bank_transfer_config').select('*').single());
  await checked(await db.from('bank_transfer_config').update({ bank_transfer_enabled: true, bank_account_holder: 'Quick shop', bank_account_number: 'PL61109010140000071219812874', bank_transfer_max_unpaid_per_email: 20 }).eq('id', true).select());
  product = await checked(await db.from('products').insert({ name: 'Szybka płatność warsztat', slug: `quick-${randomUUID()}`, price: 100, currency: 'PLN', is_active: true, event_mode: true, vat_exempt: true,
    checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['organization'], gus: false, bank_transfer_for: ['organization'] }] } }).select('id').single());
  sessionId = (await checked(await db.from('product_sessions').insert({ product_id: product.id, starts_at: '2099-05-01T10:00:00Z', capacity: 10 }).select('id').single())).id;
  await checked(await db.from('product_price_tiers').insert([{ session_id: sessionId, price: 100, seats: 2, sort: 0 }, { session_id: sessionId, price: 150, sort: 1 }]).select());
  endpointId = (await checked(await db.from('webhook_endpoints').insert({ url: 'https://127.0.0.1/quick-pay-fixture', events: ['order.reopened', 'purchase.completed'], secret: 'test-only-secret', product_filter_mode: 'selected', is_active: true }).select('id').single())).id;
  await checked(await db.from('webhook_endpoint_products').insert({ webhook_endpoint_id: endpointId, product_id: product.id }).select());
});
test.afterAll(async () => {
  await db.from('webhook_logs').delete().eq('endpoint_id', endpointId); await db.from('webhook_endpoints').delete().eq('id', endpointId);
  await db.from('guest_purchases').delete().eq('product_id', product.id);
  await db.from('payment_transactions').delete().eq('product_id', product.id); await db.from('products').delete().eq('id', product.id);
  if (bankConfig) await db.from('bank_transfer_config').upsert(bankConfig as never);
});

test('buyer pays an unpaid transfer order online from the pay link at the saved amount @J185', async ({ page }) => {
  const id = await place(`quick-settle-${randomUUID()}@example.com`, 100);
  await page.goto(orderPage(id));
  await page.getByRole('button', { name: /Zapłać online 100,00/ }).click();
  await payOnHostedCheckout(page);
  await expect.poll(async () => (await db.from('payment_transactions').select('status').eq('id', id).single()).data?.status, { timeout: 90000 }).toBe('completed');
  const tx = await checked(await db.from('payment_transactions').select('settled_via,payment_provider,stripe_payment_intent_id,amount').eq('id', id).single());
  expect(tx).toMatchObject({ settled_via: 'stripe', payment_provider: 'bank_transfer', amount: 10000 });
  const pi = await stripe.paymentIntents.retrieve(tx.stripe_payment_intent_id!);
  expect(pi).toMatchObject({ status: 'succeeded', amount: 10000, currency: 'pln' });
  await expect.poll(async () => (await events('purchase.completed', id)).length, { timeout: 60000 }).toBe(1);
  await expect(page.getByText('Zamówienie opłacone')).toBeVisible();
});

test('a released order paid online is reopened while the promo price is still current; after a price change a new order is required @J186', async ({ page }) => {
  const id = await place(`quick-reopen-${randomUUID()}@example.com`, 100);
  expect((await checked(await db.rpc('release_unpaid_transfer', { p_id: id, p_now: new Date(Date.now() + 49 * 3600000).toISOString() })) as { released: boolean }).released).toBe(true);
  await page.goto(orderPage(id));
  await page.getByRole('button', { name: /Zapłać online 100,00/ }).click();
  await payOnHostedCheckout(page);
  await expect.poll(async () => (await db.from('payment_transactions').select('status').eq('id', id).single()).data?.status, { timeout: 90000 }).toBe('completed');
  expect((await checked(await db.from('payment_transactions').select('reopened_at').eq('id', id).single())).reopened_at).toBeTruthy();
  await expect.poll(async () => (await events('order.reopened', id)).length, { timeout: 60000 }).toBe(1);
  // The 100 PLN tier is now sold out: a released order cannot be paid at its old price.
  const late = await place(`quick-late-${randomUUID()}@example.com`, 150);
  await checked(await db.from('product_price_tiers').update({ price: 170 }).eq('session_id', sessionId).eq('price', 150).select());
  await checked(await db.rpc('release_unpaid_transfer', { p_id: late, p_now: new Date(Date.now() + 49 * 3600000).toISOString() }));
  await page.goto(orderPage(late));
  await expect(page.getByRole('button', { name: /Zapłać online/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Zamów ponownie po aktualnej cenie' })).toBeVisible();
});

test('admin marks the order paid while the buyer is on Stripe: the online payment is refunded automatically @J187', async ({ page, browser }) => {
  const id = await place(`quick-race-${randomUUID()}@example.com`, 170);
  await page.goto(orderPage(id));
  await page.getByRole('button', { name: /Zapłać online 170,00/ }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
  const admin = await browser.newPage();
  await loginAsAdmin(admin, 'demo@sellf.app', 'demo123');
  const { data: adminUser } = await db.from('admin_users').select('user_id').limit(1).single();
  expect((await checked(await db.rpc('admin_bank_transfer_order', { p_id: id, p_action: 'mark-paid', p_amount: 17000, p_paid_at: new Date().toISOString(), p_actor: adminUser!.user_id })) as { success: boolean }).success).toBe(true);
  await admin.close();
  await payOnHostedCheckout(page);
  await expect.poll(async () => (await db.from('order_payment_attempts').select('status,refund_id').eq('transaction_id', id).single()).data, { timeout: 90000 })
    .toMatchObject({ status: 'duplicate', refund_id: expect.stringMatching(/^re_/) });
  const attempt = await checked(await db.from('order_payment_attempts').select('refund_id').eq('transaction_id', id).single());
  expect((await stripe.refunds.retrieve(attempt.refund_id!)).amount).toBe(17000);
  expect((await checked(await db.from('payment_transactions').select('stripe_payment_intent_id,status').eq('id', id).single()))).toEqual({ stripe_payment_intent_id: null, status: 'completed' });
});
