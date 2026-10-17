import { getTestDatabaseContainer } from '@/../tests/helpers/database-container';
/** Native and embedded coupon accounting on a disposable stack. */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test, expect } from '@playwright/test';
import Stripe from 'stripe';
import type { AddressInfo } from 'node:net';
import type { Page, APIRequestContext } from '@playwright/test';
import { createTestUser, setAuthSession, supabaseAdmin as db } from '../helpers/admin-auth';
import { acceptAllCookies } from '../helpers/consent';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const actor = 'dddddddd-0000-4000-a000-000000000000';
const base = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${process.env.PW_PORT || 3777}`;
function sql(statement: string): string {
  return execFileSync('docker', ['exec', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' }).trim();
}
async function rows(table: string, column: string, value: string) {
  const result = await db.from(table).select('*').eq(column, value); expect(result.error).toBeNull(); return result.data!;
}
async function insert(table: string, data: object) {
  const result = await db.from(table).insert(data).select().single(); expect(result.error).toBeNull(); return result.data!;
}
/** Fixture history must precede Stripe's whole-second session clock (AF-004). */
async function affiliateHistoryBoundary(couponId: string): Promise<number> {
  const binding = await db.from('affiliate_coupon_bindings').select('created_at')
    .eq('coupon_id', couponId).is('retired_at', null).single();
  expect(binding.error).toBeNull();
  // Binding is the last history write in these fixtures. Observe Stripe's clock
  // before the single checkout attempt; do not round production history backward.
  const boundary = (Math.floor(Date.parse(binding.data!.created_at) / 1000) + 1) * 1000;
  await expect.poll(async () => {
    const clock = await stripe.checkout.sessions.list({ limit: 1, created: { gte: Math.ceil(Date.now() / 1000) } });
    const headers = clock.lastResponse.headers as Headers | Record<string, string>;
    const date = headers instanceof Headers ? headers.get('date') : headers.date;
    const time = date ? Date.parse(date) : NaN;
    expect(Number.isFinite(time)).toBe(true);
    return time;
  }, { timeout: 10000, intervals: [100, 250, 500] }).toBeGreaterThanOrEqual(boundary);
  return boundary;
}
async function sync(request: APIRequestContext, errors = 0) {
  const response = await request.get(`${base}/api/cron?job=affiliate-sync`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(response.status()).toBe(200); expect((await response.json()).errors).toBe(errors);
}
async function card(page: Page) {
  // Stripe can paint method tabs before its PaymentElement onReady event.
  await expect(page.locator('button[type="submit"]')).not.toHaveAttribute('data-checkout-pending', 'true', { timeout: 60000 });
  const frame = page.frameLocator('iframe[src*="elements-inner-payment"]');
  await expect(frame.locator('[data-testid="card"], input[name="number"]').first()).toBeVisible({ timeout: 60000 });
  if (await frame.getByTestId('card').count()) await frame.getByTestId('card').click();
  await expect(frame.locator('input[name="number"]')).toBeVisible();
  await frame.locator('input[name="number"]').fill('4242424242424242');
  await frame.locator('input[name="expiry"]').fill('1234'); await frame.locator('input[name="cvc"]').fill('123');
}
async function checkout(page: Page, slug: string, email: string, coupon?: string) {
  await acceptAllCookies(page);
  await page.goto(`/pl/p/${slug}?email=${encodeURIComponent(email)}`);
  if (coupon) {
    await page.getByText('Masz kod rabatowy?', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Kod rabatowy' }).fill(coupon);
    await page.getByRole('button', { name: 'Zastosuj' }).click();
    await expect(page.getByRole('textbox', { name: 'Kod rabatowy' })).toBeDisabled();
  }
  await page.getByRole('button', { name: /Przejdź do płatności/ }).click();
  await expect(page.locator('#checkoutEmail')).toBeVisible({ timeout: 90000 });
  await page.locator('#checkoutEmail').fill(email); await page.locator('#fullName').fill('Affiliate Test Buyer');
  for (const c of await page.locator('input[type="checkbox"]').all()) if (await c.isVisible()) await c.check();
  await card(page); await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/pl\/p\/.*payment-status.*session_id=/, { timeout: 120000 });
  await expect(page.getByText(/Potwierdzamy zakup produktu/)).toBeVisible({ timeout: 60000 });
  if (coupon) {
    await expect(page.getByText(pl.paymentStatus.magicLinkSent, { exact: false })).toBeVisible({ timeout: 60000 });
    mkdirSync('/tmp/rcfix-core-shots', { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `/tmp/rcfix-core-shots/guest-confirmation-pl-${width}.png`, fullPage: true, animations: 'disabled' });
    }
  }
}
test.beforeAll(() => { expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/); expect(process.env.STRIPE_LIVE_E2E).toBe('1'); });
test('native coupon paid, held, mature and refunded in test mode', async ({ page, request }) => {
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
  const historyBoundary = await affiliateHistoryBoundary(coupon.id);
  await checkout(page, product.slug, `buyer-${suffix}@example.com`, coupon.code);
  await expect.poll(async () => (await rows('payment_transactions', 'product_id', product.id)).filter(p => p.status === 'completed' && !p.fulfillment_pending).length, { timeout: 90000 }).toBe(1);
  const payment = (await rows('payment_transactions', 'product_id', product.id)).find(p => p.status === 'completed')!;
  const session = payment.session_id.startsWith('cs_') ? await stripe.checkout.sessions.retrieve(payment.session_id) : (await stripe.checkout.sessions.list({ payment_intent: payment.session_id, limit: 1 })).data[0];
  expect(session).toBeTruthy(); expect(session.created * 1000).toBeGreaterThanOrEqual(historyBoundary);
  expect(await rows('coupon_redemptions', 'transaction_id', payment.id)).toHaveLength(1);
  expect(await rows('affiliate_commissions', 'payment_id', payment.id)).toHaveLength(0);
  const metadata = payment.metadata;
  sql(`UPDATE payment_transactions SET session_id='in_affiliate_retry_${suffix}' WHERE id='${payment.id}'`);
  for (let attempt = 1; attempt <= 10; attempt++) {
    sql(`UPDATE affiliate_work SET next_attempt_at=now() WHERE payment_id='${payment.id}'`);
    await sync(request, 1);
    const work = (await rows('affiliate_work', 'payment_id', payment.id))[0];
    expect(work.attempts).toBe(attempt);
    expect(work.status).toBe(attempt === 10 ? 'needs_review' : 'pending');
    expect(work.last_error_code).toBe('session_unresolved');
  }
  expect(await rows('affiliate_commissions', 'payment_id', payment.id)).toHaveLength(0);
  const failed = (await rows('affiliate_work', 'payment_id', payment.id))[0];
  sql(`UPDATE payment_transactions SET session_id='${payment.session_id}' WHERE id='${payment.id}'`);
  await sync(request);
  expect((await rows('affiliate_work', 'payment_id', payment.id))[0].status).toBe('needs_review');
  expect(await rows('affiliate_commissions', 'payment_id', payment.id)).toHaveLength(0);
  await setAuthSession(page, 'demo@sellf.app', 'demo123');
  await page.goto('/en/dashboard/affiliates');
  const recovery = page.getByRole('region', { name: 'Commission processing', exact: true });
  const form = recovery.getByRole('form').filter({ hasText: product.name });
  await expect(form).toBeVisible();
  for (const locale of ['en', 'pl']) for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/${locale}/dashboard/affiliates`);
    await expect(page.getByRole('form').filter({ hasText: product.name })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/affab-recovery-${locale}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/en/dashboard/affiliates');
  const reason = `Session source restored ${suffix}`;
  await form.getByRole('textbox', { name: 'What was resolved?' }).fill(reason);
  await form.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(recovery.getByRole('status')).toHaveText('Order queued again. The next worker run will process it.');
  const retried = (await rows('affiliate_work', 'payment_id', payment.id))[0];
  expect(retried.status).toBe('pending'); expect(retried.attempts).toBe(0);
  expect(BigInt(retried.requested_generation)).toBe(BigInt(failed.requested_generation) + 1n);
  const retryAudit = await db.from('audit_log').select('performed_by,new_values').eq('table_name', 'affiliate_work')
    .eq('new_values->>payment_id', payment.id).eq('new_values->>reason', reason);
  expect(retryAudit.error).toBeNull(); expect(retryAudit.data).toHaveLength(1);
  expect(retryAudit.data![0].performed_by).toBe(actor);
  // Place the disposable confirmation fixture just before its one-day maturity boundary.
  sql(`UPDATE coupon_redemptions SET redeemed_at=clock_timestamp()-interval '1 day'+interval '30 seconds' WHERE transaction_id='${payment.id}'`);
  await sync(request); await sync(request);
  const commission = (await rows('affiliate_commissions', 'payment_id', payment.id))[0];
  expect(commission).toBeTruthy(); expect(Date.parse(commission.eligible_at)).toBeGreaterThan(Date.now());
  expect(Number(payment.amount)).toBe(11070); expect(Number(commission.accrued_minor)).toBe(2214);
  async function assertTestCommission(status: 'held' | 'eligible' | 'reversed') {
    const read = await db.rpc('affiliate_portal_page', { p_member: member.id, p_currency: 'PLN', p_limit: 25, p_as_of: new Date().toISOString() });
    expect(read.error).toBeNull();
    const projection = read.data as { commissions: { reference: string; status: string; livemode: boolean; current_minor: string }[] };
    expect(projection.commissions).toHaveLength(1);
    expect(projection.commissions[0]).toMatchObject({ reference: commission.id, status, livemode: false, ...(status === 'reversed' ? { current_minor: '0' } : {}) });
    const row = page.getByRole('listitem').filter({ has: page.getByText(product.name, { exact: true }) });
    const labels = { held: en.affiliates.portal.heldStatus, eligible: en.affiliates.portal.eligibleStatus, reversed: en.affiliates.portal.reversedStatus };
    await expect(row.locator('span')).toHaveText([labels[status], 'Test']);
    if (status === 'held') {
      const maturity = new Date(commission.eligible_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      await expect(row.locator('small')).toHaveText(`${en.affiliates.portal.maturity}: ${maturity}`);
      expect(Date.parse(await row.locator('small time').getAttribute('datetime') ?? '')).toBe(Date.parse(commission.eligible_at));
    } else await expect(row.locator('small')).toHaveCount(0);
    const balance = page.getByRole('article', { name: 'PLN', exact: true }).locator('dl').first().locator('dd');
    await expect(balance).toHaveText([status === 'eligible' ? '22.14 PLN' : '0.00 PLN', status === 'held' ? '22.14 PLN' : '0.00 PLN', '0.00 PLN']);
  }
  await setAuthSession(page, user.email, user.password); await page.goto('/my-affiliate');
  await assertTestCommission('held');
  await expect.poll(() => Date.now() >= Date.parse(commission.eligible_at), { timeout: 60000, intervals: [500] }).toBe(true);
  await page.reload(); await assertTestCommission('eligible');
  expect(commission.livemode).toBe(false);
  const reservation = await db.rpc('affiliate_reserve', { p_actor: actor, p_member: member.id, p_currency: 'PLN', p_cutoff: new Date().toISOString(), p_member_version: 2, p_program_version: program.version + 1, p_payee_reference: 'test-fixture' });
  expect(reservation.error).not.toBeNull();
  expect(await rows('affiliate_payouts', 'member_id', member.id)).toHaveLength(0);
  const testReservation = await db.rpc('affiliate_reserve', { p_actor: actor, p_member: member.id, p_currency: 'PLN', p_cutoff: new Date(sql('SELECT clock_timestamp()')).toISOString(), p_member_version: 2, p_program_version: program.version + 1, p_payee_reference: 'test-fixture', p_livemode: false });
  expect(testReservation.error).toBeNull();
  expect(testReservation.data).toMatchObject({ earnings_minor: 2214, livemode: false, currency: 'PLN', status: 'reserved' });
  const cancelled = await db.rpc('affiliate_cancel_payout', { p_actor: actor, p_payout: testReservation.data!.id, p_expected_version: testReservation.data!.version, p_no_transfer: true, p_reason: 'Test reservation complete' });
  expect(cancelled.error).toBeNull(); expect(cancelled.data).toMatchObject({ status: 'cancelled', livemode: false });
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent!.id;
  await stripe.refunds.create({ payment_intent: intent });
  await expect.poll(async () => Number((await rows('payment_transactions', 'id', payment.id))[0].refunded_amount), { timeout: 90000 }).toBe(Number(payment.amount));
  await sync(request); await sync(request);
  const entries = await rows('affiliate_ledger', 'member_id', member.id);
  expect(entries.reduce((sum, e) => sum + BigInt(e.amount_minor), 0n)).toBe(0n);
  expect(entries.filter(e => e.kind === 'accrual')).toHaveLength(1); expect(entries.filter(e => e.kind === 'reversal')).toHaveLength(1); expect(entries.filter(e => e.kind === 'settlement')).toHaveLength(0);
  expect((await rows('payment_transactions', 'id', payment.id))[0].metadata).toEqual(metadata);
  await setAuthSession(page, user.email, user.password); await page.goto('/my-affiliate'); await assertTestCommission('reversed');
});
for (const withCoupon of [true, false]) test(`external embed paid ${withCoupon ? 'with partner coupon accrues once' : 'without coupon creates no commission'}`, async ({ page, request }) => {
  const suffix = randomUUID().slice(0, 8), email = `embed-${suffix}@example.com`;
  const partner = await createTestUser('affiliate-embed');
  const program = (await db.from('affiliate_programs').select('*').single()).data!;
  const applied = await db.rpc('affiliate_apply', { p_user: partner.userId, p_code: `embed-${suffix}`, p_display_name: 'Embed Partner', p_channel: 'Test channel', p_terms_version: program.terms_version }).select('id,version').single();
  expect(applied.error).toBeNull(); const member = applied.data!;
  expect((await db.rpc('affiliate_member_update', { p_actor: actor, p_member: member.id, p_expected_version: member.version, p_status: 'approved', p_reason: 'Test partner approved' })).error).toBeNull();
  const product = await insert('products', { slug: `affiliate-embed-${suffix}`, name: 'Embed course', seller_id: actor, embed_enabled: true, price: 10, currency: 'PLN', is_active: true, vat_exempt: true, is_refundable: false });
  const coupon = await insert('coupons', { code: `EMB${suffix.toUpperCase()}`, discount_type: 'percentage', discount_value: 10, is_active: true });
  expect((await db.rpc('affiliate_rule_create', { p_actor: actor, p_product: product.id, p_expected_revision: 0, p_enabled: true, p_percentage_bps: 2000, p_fixed_minor: null, p_currency: null })).error).toBeNull();
  expect((await db.rpc('affiliate_coupon_bind', { p_actor: actor, p_coupon: coupon.id, p_member: member.id, p_expected_version: 0 })).error).toBeNull();
  const historyBoundary = await affiliateHistoryBoundary(coupon.id);
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html><body><div data-sellf-embed data-product-slug="${product.slug}" data-email="${email}" ${withCoupon ? `data-coupon="${coupon.code}"` : ''}></div><script src="${base}/embed/v1/checkout.js"></script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  expect((await db.from('seller_embed_settings').upsert({ seller_id: actor, allowed_embed_origins: [origin] })).error).toBeNull();
  try {
    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/embed/checkout-session') && res.request().method() === 'POST'),
      page.goto(origin),
    ]);
    expect(response.request().postDataJSON().couponCode).toBe(withCoupon ? coupon.code : undefined);
    expect(response.status()).toBe(200);
    const session = await stripe.checkout.sessions.retrieve((await response.json()).sessionId);
    expect(session.created * 1000).toBeGreaterThanOrEqual(historyBoundary);
    expect(session.livemode).toBe(false); expect(session.amount_total).toBe(withCoupon ? 900 : 1000);
    const frame = page.frameLocator('iframe[name="embedded-checkout"]');
    await frame.getByTestId('card-accordion-item').click({ timeout: 60000 });
    await expect(frame.locator('input[name="cardNumber"]')).toBeVisible({ timeout: 60000 });
    await frame.locator('input[name="cardNumber"]').fill('4242424242424242');
    await frame.locator('input[name="cardExpiry"]').fill('1234'); await frame.locator('input[name="cardCvc"]').fill('123');
    const name = frame.locator('input[name="billingName"]'); if (await name.isVisible()) await name.fill('Embed Buyer');
    await frame.getByTestId('hosted-payment-submit-button').click();
    await expect.poll(async () => (await rows('payment_transactions', 'product_id', product.id)).filter(p => p.status === 'completed' && !p.fulfillment_pending).length, { timeout: 90000 }).toBe(1);
    expect((await stripe.checkout.sessions.retrieve(session.id)).payment_status).toBe('paid');
    const payment = (await rows('payment_transactions', 'product_id', product.id)).find(p => p.status === 'completed')!;
    await sync(request); await sync(request);
    expect(await rows('coupon_redemptions', 'transaction_id', payment.id)).toHaveLength(withCoupon ? 1 : 0);
    const commissions = await rows('affiliate_commissions', 'payment_id', payment.id);
    expect(commissions).toHaveLength(withCoupon ? 1 : 0);
    if (withCoupon) {
      expect(commissions[0]).toMatchObject({ member_id: member.id, accrued_minor: 180, livemode: false });
      const ledger = await rows('affiliate_ledger', 'commission_id', commissions[0].id);
      expect(ledger).toHaveLength(1); expect(ledger[0]).toMatchObject({ kind: 'accrual', amount_minor: 180 });
      expect((await rows('affiliate_work', 'payment_id', payment.id))[0]).toMatchObject({ status: 'done', last_error_code: null });
    } else expect(await rows('affiliate_work', 'payment_id', payment.id)).toHaveLength(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
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
