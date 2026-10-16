/** Native coupon accounting and D-019 commerce acceptance on a disposable stack. */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import Stripe from 'stripe';
import { solveChallenge } from 'altcha-lib/v1';
import { createTestUser, setAuthSession, supabaseAdmin as db } from '../helpers/admin-auth';
import { acceptAllCookies } from '../helpers/consent';
import type { Page, APIRequestContext } from '@playwright/test';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const actor = 'dddddddd-0000-4000-a000-000000000000';
const base = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${process.env.PW_PORT || 3777}`;
function sql(statement: string): string {
  expect(process.env.SUPABASE_URL).toBe('http://127.0.0.1:55471');
  return execFileSync('docker', ['exec', 'supabase_db_sellf-aff-a18', 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim();
}
async function rows(table: string, column: string, value: string) {
  const result = await db.from(table).select('*').eq(column, value); expect(result.error).toBeNull(); return result.data!;
}
async function insert(table: string, data: object) {
  const result = await db.from(table).insert(data).select().single(); expect(result.error).toBeNull(); return result.data!;
}
async function sync(request: APIRequestContext) {
  const response = await request.get(`${base}/api/cron?job=affiliate-sync`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(response.status()).toBe(200); expect((await response.json()).errors).toBe(0);
}
async function card(page: Page) {
  const frame = page.frameLocator('iframe[title="Secure payment input frame"][src*="elements-inner-payment"]');
  await expect(frame.locator('[data-testid="card"], input[name="number"]').first()).toBeVisible({ timeout: 60000 });
  if (await frame.getByTestId('card').count()) await frame.getByTestId('card').click();
  await expect(frame.locator('input[name="number"]')).toBeVisible();
  await frame.locator('input[name="number"]').fill('4242424242424242');
  await frame.locator('input[name="expiry"]').fill('1234'); await frame.locator('input[name="cvc"]').fill('123');
}
async function checkout(page: Page, slug: string, email: string, coupon?: string) {
  await acceptAllCookies(page);
  await page.goto(`/en/checkout/${slug}?email=${encodeURIComponent(email)}${coupon ? `&coupon=${coupon}` : ''}`);
  await expect(page.locator('#checkoutEmail')).toBeVisible({ timeout: 90000 });
  await page.locator('#checkoutEmail').fill(email); await page.locator('#fullName').fill('Affiliate Test Buyer');
  for (const c of await page.locator('input[type="checkbox"]').all()) if (await c.isVisible()) await c.check();
  await card(page); await page.locator('button[type="submit"]').click();
  await page.waitForURL(/payment-status.*session_id=/, { timeout: 120000 });
}
test.beforeAll(() => { expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/); expect(process.env.STRIPE_LIVE_E2E).toBe('1'); });
test('native coupon paid, held, mature, reserve, CSV, paid and actual refund debt', async ({ page, request }) => {
  const suffix = randomUUID().slice(0, 8), user = await createTestUser('affiliate-native');
  const program = (await db.from('affiliate_programs').select('*').single()).data!;
  const updated = await db.rpc('affiliate_program_update', { p_actor: actor, p_expected_version: program.version, p_enabled: true, p_hold_days: 1, p_buffer_days: 0, p_terms_version: program.terms_version, p_terms: program.terms, p_thresholds: { PLN: '1', EUR: '1' } });
  expect(updated.error).toBeNull();
  const applied = await db.rpc('affiliate_apply', { p_user: user.userId, p_code: `native-${suffix}`, p_display_name: `Native Partner ${suffix}`, p_channel: 'Test channel', p_terms_version: program.terms_version }).select('id,version').single();
  expect(applied.error).toBeNull(); const member = applied.data!;
  expect((await db.rpc('affiliate_member_update', { p_actor: actor, p_member: member.id, p_expected_version: member.version, p_status: 'approved', p_reason: 'Test partner approved' })).error).toBeNull();
  const product = await insert('products', { slug: `affiliate-native-${suffix}`, name: `Native course ${suffix}`, price: 123, currency: 'PLN', is_active: true, vat_exempt: true, is_refundable: false });
  const coupon = await insert('coupons', { code: `AFF${suffix.toUpperCase()}`, discount_type: 'percentage', discount_value: 10, is_active: true });
  expect((await db.rpc('affiliate_rule_create', { p_actor: actor, p_product: product.id, p_expected_revision: 0, p_enabled: true, p_percentage_bps: 2000, p_fixed_minor: null, p_currency: null })).error).toBeNull();
  expect((await db.rpc('affiliate_coupon_bind', { p_actor: actor, p_coupon: coupon.id, p_member: member.id, p_expected_version: 0 })).error).toBeNull();
  await checkout(page, product.slug, `buyer-${suffix}@example.com`, coupon.code);
  await expect.poll(async () => (await rows('payment_transactions', 'product_id', product.id)).filter(p => p.status === 'completed' && !p.fulfillment_pending).length, { timeout: 90000 }).toBe(1);
  const payment = (await rows('payment_transactions', 'product_id', product.id)).find(p => p.status === 'completed')!;
  expect(await rows('coupon_redemptions', 'transaction_id', payment.id)).toHaveLength(1);
  expect(await rows('affiliate_commissions', 'payment_id', payment.id)).toHaveLength(0);
  const metadata = payment.metadata;
  // Place the disposable confirmation fixture just before its one-day maturity boundary.
  sql(`UPDATE coupon_redemptions SET redeemed_at=clock_timestamp()-interval '1 day'+interval '12 seconds' WHERE transaction_id='${payment.id}'`);
  await sync(request);
  const commission = (await rows('affiliate_commissions', 'payment_id', payment.id))[0];
  expect(commission).toBeTruthy(); expect(Date.parse(commission.eligible_at)).toBeGreaterThan(Date.now());
  await setAuthSession(page, user.email, user.password); await page.goto('/my-affiliate');
  await expect(page.getByText('Waiting period', { exact: true })).toBeVisible();
  await expect.poll(() => Date.now() >= Date.parse(commission.eligible_at), { timeout: 20000, intervals: [500] }).toBe(true);
  await page.reload(); await expect(page.getByText('Mature', { exact: true })).toBeVisible();
  await setAuthSession(page, 'demo@sellf.app', 'demo123'); await page.goto('/dashboard/affiliates/payouts');
  const picker = page.getByRole('combobox').first(); await picker.fill(`Native Partner ${suffix}`);
  await page.getByRole('option', { name: `Native Partner ${suffix}` }).click();
  await expect(page.getByRole('button', { name: 'Reserve for payout', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reserve for payout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'CSV', exact: true })).toBeEnabled();
  const payout = (await rows('affiliate_payouts', 'member_id', member.id))[0];
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'CSV', exact: true }).click();
  const file = await download; expect(await file.failure()).toBeNull();
  const csvResponse = await page.request.get(`/api/affiliates/payouts/${payout.id}/csv?version=${payout.version}`);
  expect(csvResponse.status()).toBe(200); expect(csvResponse.headers()['cache-control']).toContain('no-store');
  expect(await csvResponse.text()).toContain(`native-${suffix},PLN`);
  expect(await rows('affiliate_ledger', 'payout_id', payout.id)).toHaveLength(0);
  await page.locator('[name="bank_reference"]').fill(`bank-${suffix}`); await page.locator('[name="invoice_reference"]').fill(`invoice-${suffix}`);
  await page.locator('[name="paid_at"]').fill('2026-10-01'); await page.locator('[name="full_settlement"]').check(); await page.getByRole('button', { name: 'Record completed transfer', exact: true }).click();
  await expect.poll(async () => (await rows('affiliate_payouts', 'id', payout.id))[0].status).toBe('paid');
  const session = payment.session_id.startsWith('cs_') ? await stripe.checkout.sessions.retrieve(payment.session_id) : (await stripe.checkout.sessions.list({ payment_intent: payment.session_id, limit: 1 })).data[0];
  expect(session).toBeTruthy();
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent!.id;
  await stripe.refunds.create({ payment_intent: intent });
  await expect.poll(async () => Number((await rows('payment_transactions', 'id', payment.id))[0].refunded_amount), { timeout: 90000 }).toBe(Number(payment.amount));
  await sync(request); await sync(request);
  const entries = await rows('affiliate_ledger', 'member_id', member.id);
  expect(entries.reduce((sum, e) => sum + BigInt(e.amount_minor), 0n)).toBe(-BigInt(commission.accrued_minor));
  expect(entries.filter(e => e.kind === 'accrual')).toHaveLength(1); expect(entries.filter(e => e.kind === 'settlement')).toHaveLength(1);
  expect((await rows('payment_transactions', 'id', payment.id))[0].metadata).toEqual(metadata);
  await setAuthSession(page, user.email, user.password); await page.goto('/my-affiliate'); await expect(page.getByText('Debt', { exact: true }).first()).toBeVisible();
});
test('D-019 external embed purchase succeeds without coupon or commission', async ({ page, request }) => {
  const suffix = randomUUID().slice(0, 8), email = `embed-${suffix}@example.com`;
  const product = await insert('products', { slug: `affiliate-embed-${suffix}`, name: 'Embed course', embed_enabled: true, price: 10, currency: 'PLN', is_active: true, vat_exempt: true });
  const challengeResponse = await request.get('/api/captcha/challenge');
  expect(challengeResponse.status()).toBe(200); const challenge = await challengeResponse.json();
  const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm, challenge.maxnumber).promise;
  expect(solution).toBeTruthy();
  const token = Buffer.from(JSON.stringify({ ...challenge, number: solution!.number, took: solution!.took })).toString('base64');
  expect((await db.rpc('affiliate_rule_create', { p_actor: actor, p_product: product.id, p_expected_revision: 0, p_enabled: true, p_percentage_bps: 2000, p_fixed_minor: null, p_currency: null })).error).toBeNull();
  const response = await request.post('/api/embed/checkout-session', { headers: { Origin: base }, data: { productSlug: product.slug, email, turnstileToken: token } });
  expect(response.status()).toBe(200); const body = await response.json(); expect(body.kind).toBe('paid'); expect(body.error).toBeUndefined();
  await page.goto('/');
  await page.evaluate(async ({ secret, key }) => {
    await new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://js.stripe.com/v3/'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Stripe unavailable')); document.head.appendChild(script); });
    const target = document.createElement('div'); target.id = 'affiliate-embed'; document.body.replaceChildren(target);
    const browser = window as unknown as { Stripe: (key: string) => { initEmbeddedCheckout: (options: { clientSecret: string }) => Promise<{ mount: (target: string) => void }> } };
    (await browser.Stripe(key).initEmbeddedCheckout({ clientSecret: secret })).mount('#affiliate-embed');
  }, { secret: body.clientSecret, key: process.env.STRIPE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY! });
  const frame = page.frameLocator('iframe[name="embedded-checkout"]');
  await frame.getByTestId('card-accordion-item').click({ timeout: 20000 });
  await expect(frame.locator('input[name="cardNumber"]')).toBeVisible({ timeout: 60000 });
  await frame.locator('input[name="cardNumber"]').fill('4242424242424242'); await frame.locator('input[name="cardExpiry"]').fill('1234'); await frame.locator('input[name="cardCvc"]').fill('123');
  const name = frame.locator('input[name="billingName"]'); if (await name.isVisible()) await name.fill('Embed Buyer');
  await frame.getByTestId('hosted-payment-submit-button').click();
  await expect.poll(async () => (await rows('payment_transactions', 'product_id', product.id)).filter(p => p.status === 'completed' && !p.fulfillment_pending).length, { timeout: 90000 }).toBe(1);
  const payment = (await rows('payment_transactions', 'product_id', product.id)).find(p => p.status === 'completed')!;
  await sync(request);
  expect(await rows('coupon_redemptions', 'transaction_id', payment.id)).toHaveLength(0);
  expect(await rows('affiliate_commissions', 'payment_id', payment.id)).toHaveLength(0);
  expect(await rows('affiliate_work', 'payment_id', payment.id)).toHaveLength(0);
});
test('subscription purchase succeeds with zero affiliate commission', async ({ page, request }) => {
  const suffix = randomUUID().slice(0, 8), user = await createTestUser('affiliate-subscription');
  const product = await insert('products', { slug: `affiliate-sub-${suffix}`, name: 'Subscription course', price: 0, currency: 'PLN', recurring_price: 10, billing_interval: 'month', billing_interval_count: 1, product_type: 'subscription', is_active: true, vat_exempt: true });
  try {
    await setAuthSession(page, user.email, user.password); await checkout(page, product.slug, user.email);
    await expect.poll(async () => (await rows('payment_transactions', 'product_id', product.id)).filter(p => p.status === 'completed').length, { timeout: 90000 }).toBe(1);
    const payment = (await rows('payment_transactions', 'product_id', product.id)).find(p => p.status === 'completed')!;
    await sync(request); expect(await rows('affiliate_commissions', 'payment_id', payment.id)).toHaveLength(0);
  } finally {
    for (const sub of await rows('subscriptions', 'product_id', product.id)) await stripe.subscriptions.cancel(sub.stripe_subscription_id);
  }
});
