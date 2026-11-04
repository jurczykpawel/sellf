/** Unpaid transfer orders end to end: timed reservation, reminder, "I have sent the transfer", release, invoice hold, late acceptance.
 * Each journey asserts the buyer (page + Mailpit), the seller (DB / dashboard) and the integrator (recorded order.* webhook). */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { loginAsAdmin, supabaseAdmin as db } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { MAILPIT_URL } from './helpers/mailpit';
import type { APIRequestContext, Page } from '@playwright/test';

if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SUPABASE_URL ?? '')) throw new Error('Requires a local disposable Supabase stack');
test.describe.configure({ mode: 'serial' });
const EVENTS = ['order.placed', 'order.payment_reminder', 'order.transfer_declared', 'order.cancelled', 'order.invoice_issued', 'order.reopened', 'purchase.completed'];
const HOUR = 3600000;
let event: { id: string; slug: string }, plain: { id: string }, sessionId: string, endpointId: string;
let bankConfig: unknown, invoiceConfig: unknown;
let orderId: string, payUrl: string;
const buyer = `unpaid-${randomUUID()}@example.com`;
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<NonNullable<T>> { if (error) throw error; return data!; }
const cron = (request: APIRequestContext) => request.get('/api/cron?job=transfer-reservations', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
async function webhook(type: string, id: string) {
  const { data } = await db.from('webhook_logs').select('payload').eq('endpoint_id', endpointId).eq('event_type', type);
  return (data ?? []).map(r => r.payload as { data: { order: Record<string, unknown>; customer: Record<string, unknown> } }).filter(p => p.data.order.orderId === id);
}
async function mails(request: APIRequestContext, to: string): Promise<Array<{ Subject: string; HTML: string }>> {
  const box = await (await request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
  return Promise.all(box.messages.map(async (m: { ID: string }) => (await request.get(`${MAILPIT_URL}/api/v1/message/${m.ID}`)).json()));
}
/** GoTrue allows one mail per address per minute; a refused notice stays pending and the next reservation job retries it. */
async function untilMail(request: APIRequestContext, to: string, subject: string) {
  await expect.poll(async () => { await cron(request); return (await mails(request, to)).map(m => m.Subject); },
    { timeout: 100000, intervals: [5000] }).toContain(subject);
  return (await mails(request, to)).find(m => m.Subject === subject)!;
}
async function placeViaRpc(productId: string, email: string, session?: string, price = 100): Promise<string> {
  const lines = [{ product_id: productId, item_type: 'main_product', quantity: 1, unit_price: price, total_price: price, discounted_total: price, currency: 'PLN', ...(session ? { session_id: session } : {}) }];
  const placed = await checked(await db.rpc('bank_transfer_order', { p_order: { product_id: productId, currency: 'PLN', customer_email: email,
    order_details: { v: 1, buyer: { type: 'organization', terms_accepted: true } }, metadata: { locale: 'pl' } }, p_lines: lines }));
  return (placed as { transaction_id: string }).transaction_id;
}

test.beforeAll(async () => {
  bankConfig = await checked(await db.from('bank_transfer_config').select('*').single());
  invoiceConfig = await checked(await db.from('invoicing_config').select('*').single());
  await checked(await db.from('invoicing_config').update({ provider: 'none', mode: 'manual' }).eq('id', true).select());
  await checked(await db.from('bank_transfer_config').update({ bank_transfer_enabled: true, bank_account_holder: 'Testowy sklep', bank_account_number: 'PL61109010140000071219812874',
    bank_transfer_grant_access_on_placement: true, bank_transfer_max_unpaid_per_email: 20, reservation_enabled: true, reservation_reminder_hours: 24, reservation_release_hours: 48, declared_hold_hours: 72 }).eq('id', true).select());
  const profile = { v: 1, modules: [{ id: 'buyer', types: ['person', 'organization'], gus: false, bank_transfer_for: ['organization'] }] };
  event = await checked(await db.from('products').insert({ name: 'Warsztat z rezerwacją', slug: `unpaid-${randomUUID()}`, price: 100, currency: 'PLN', is_active: true, is_listed: true,
    event_mode: true, vat_exempt: true, checkout_profile: profile }).select('id,slug').single());
  sessionId = (await checked(await db.from('product_sessions').insert({ product_id: event.id, title: 'Edycja grudniowa', starts_at: '2099-12-01T10:00:00Z', timezone: 'Europe/Warsaw', capacity: 1 }).select('id').single())).id;
  await checked(await db.from('product_price_tiers').insert({ session_id: sessionId, price: 100, seats: 1, sort: 0 }).select());
  await checked(await db.from('product_price_tiers').insert({ session_id: sessionId, price: 150, sort: 1 }).select());
  plain = await checked(await db.from('products').insert({ name: 'Kurs bez terminu', slug: `unpaid-plain-${randomUUID()}`, price: 100, currency: 'PLN', is_active: true, vat_exempt: true, checkout_profile: profile }).select('id').single());
  endpointId = (await checked(await db.from('webhook_endpoints').insert({ url: 'https://127.0.0.1/unpaid-fixture', events: EVENTS, secret: 'test-only-secret', product_filter_mode: 'selected', is_active: true }).select('id').single())).id;
  await checked(await db.from('webhook_endpoint_products').insert([{ webhook_endpoint_id: endpointId, product_id: event.id }, { webhook_endpoint_id: endpointId, product_id: plain.id }]).select());
});
test.afterAll(async () => {
  if (endpointId) { await db.from('webhook_logs').delete().eq('endpoint_id', endpointId); await db.from('webhook_endpoints').delete().eq('id', endpointId); }
  for (const p of [event, plain].filter(Boolean)) {
    await db.from('guest_purchases').delete().eq('product_id', p.id);
    await db.from('payment_transactions').delete().eq('product_id', p.id);
    await db.from('products').delete().eq('id', p.id);
  }
  const users = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users;
  for (const user of users.filter(u => u.email?.startsWith('unpaid-'))) await db.auth.admin.deleteUser(user.id);
  if (bankConfig) await db.from('bank_transfer_config').upsert(bankConfig as never);
  if (invoiceConfig) await db.from('invoicing_config').upsert(invoiceConfig as never);
});

async function placeInCheckout(page: Page) {
  await acceptAllCookies(page); await page.goto(`/pl/checkout/${event.slug}`);
  await page.getByLabel('Typ nabywcy').selectOption('organization');
  await page.getByRole('radio', { name: /Przelew tradycyjny/ }).check();
  for (const [key, value] of Object.entries({ first_name: 'Anna', last_name: 'Testowa', company_name: 'Testowa firma', nip: '5260250274', address: 'Prosta 1', postal_code: '00-001', city: 'Warszawa' })) await page.locator(`[id="buyer.${key}"]`).fill(value);
  await page.getByLabel('Email', { exact: true }).fill(buyer);
  const terms = page.getByRole('checkbox', { name: /Zgadzam/ }); if (await terms.count()) await terms.check();
  const submit = page.getByRole('button', { name: 'Zamawiam z obowiązkiem zapłaty' }); await expect(submit).toBeEnabled({ timeout: 30000 });
  const responsePromise = page.waitForResponse('**/api/orders/bank-transfer'); await submit.click();
  const response = await responsePromise; expect(response.status()).toBe(200);
  return response.json() as Promise<{ orderId: string; releaseAt: string; dueAt: string }>;
}

test('a placed event transfer reserves the seat for 48 h and the 24 h reminder reaches buyer and integrator with a working pay link @J180', async ({ page, request }) => {
  test.setTimeout(240000);
  const order = await placeInCheckout(page); orderId = order.orderId;
  const tx = await checked(await db.from('payment_transactions').select('created_at,reminder_at,release_at,payment_due_at').eq('id', orderId).single());
  expect(Date.parse(tx.release_at!) - Date.parse(tx.created_at)).toBe(48 * HOUR);
  expect(Date.parse(tx.reminder_at!) - Date.parse(tx.created_at)).toBe(24 * HOUR);
  expect(Date.parse(tx.payment_due_at!) - Date.parse(tx.created_at)).toBe(14 * 86400000); expect(Date.parse(order.releaseAt)).toBe(Date.parse(tx.release_at!));
  await expect(page.getByText(/Miejsce i cena zarezerwowane do/)).toBeVisible();
  const placed = await webhook('order.placed', orderId);
  expect(placed).toHaveLength(1); expect(placed[0].data.order).toMatchObject({ reservation: 'timed', releaseAt: tx.release_at });
  // Nothing happens before the reminder time.
  expect((await cron(request)).ok()).toBe(true); expect(await webhook('order.payment_reminder', orderId)).toHaveLength(0);
  await checked(await db.from('payment_transactions').update({ reminder_at: new Date(Date.now() - 60000).toISOString() }).eq('id', orderId).select());
  expect((await cron(request)).ok()).toBe(true); expect((await cron(request)).ok()).toBe(true);
  await page.screenshot({ path: test.info().outputPath('order-page-reserved.png'), fullPage: true });
  const reminders = await webhook('order.payment_reminder', orderId);
  expect(reminders).toHaveLength(1);
  expect(reminders[0].data.customer).toMatchObject({ email: buyer, locale: 'pl' });
  payUrl = reminders[0].data.order.payUrl as string;
  expect(new URL(payUrl).pathname).toBe(`/pl/order/${orderId}/transfer`);
  const pay = await request.get(new URL(payUrl).pathname + new URL(payUrl).search); expect(pay.status()).toBe(200);
  const reminderMail = await untilMail(request, buyer, 'Przypomnienie o płatności za zamówienie');
  expect(reminderMail.HTML).toContain('Wysłałem przelew'); expect(reminderMail.HTML).toContain(`/pl/order/${orderId}/transfer?token=`);
  expect((await mails(request, buyer)).map(m => m.Subject)).toContain('Dane do przelewu za zamówienie');
});

test('buyer declares the transfer once from the pay link; the reservation is extended and accounting is notified @J181', async ({ page, request }) => {
  test.setTimeout(90000);
  await page.goto(new URL(payUrl).pathname + new URL(payUrl).search);
  await page.getByLabel('Uwaga dla sprzedawcy (opcjonalnie)').fill('Przelew z konta firmowego');
  const before = Date.now();
  await page.getByRole('button', { name: 'Wysłałem przelew' }).click();
  await expect(page.getByRole('status')).toContainText('Rezerwacja przedłużona do');
  const tx = await checked(await db.from('payment_transactions').select('release_at,transfer_declared_note').eq('id', orderId).single());
  expect(Date.parse(tx.release_at!)).toBeGreaterThanOrEqual(before + 72 * HOUR - 5000);
  expect(tx.transfer_declared_note).toBe('Przelew z konta firmowego');
  await page.reload(); await expect(page.getByRole('button', { name: 'Wysłałem przelew' })).toHaveCount(0);
  const declared = await webhook('order.transfer_declared', orderId);
  expect(declared).toHaveLength(1); expect(declared[0].data.order).toMatchObject({ transferDeclaredNote: 'Przelew z konta firmowego', releaseAt: tx.release_at });
  await loginAsAdmin(page, 'demo@sellf.app', 'demo123'); await page.goto('/pl/dashboard/payments');
  await page.getByLabel('Status', { exact: true }).selectOption('awaiting_payment');
  const row = page.getByRole('row').filter({ hasText: buyer }); await row.getByRole('button', { name: /szczegóły/i }).click();
  await expect(page.getByText(/Kupujący zgłosił przelew .* sprawdź wyciąg: Przelew z konta firmowego/)).toBeVisible();
  expect((await cron(request)).ok()).toBe(true);
});

test('an unpaid order past its window is released: seat back on sale, buyer and integrator told @J182', async ({ page, request }) => {
  test.setTimeout(200000);
  expect((await checked(await db.rpc('event_availability', { p_product_id: event.id })) as unknown as Array<{ remaining: number }>)[0].remaining).toBe(0);
  await checked(await db.from('payment_transactions').update({ release_at: new Date(Date.now() - 60000).toISOString() }).eq('id', orderId).select());
  expect((await cron(request)).ok()).toBe(true);
  const tx = await checked(await db.from('payment_transactions').select('status,cancel_reason').eq('id', orderId).single());
  expect(tx).toEqual({ status: 'cancelled', cancel_reason: 'payment_window_expired' });
  const availability = await checked(await db.rpc('event_availability', { p_product_id: event.id })) as unknown as Array<{ remaining: number; current_tier: { price: number } }>;
  expect(availability[0].remaining).toBe(1); expect(availability[0].current_tier.price).toBe(100);
  expect(await checked(await db.from('guest_purchases').select('id').eq('transaction_id', orderId))).toHaveLength(0);
  const cancelled = await webhook('order.cancelled', orderId);
  expect(cancelled).toHaveLength(1); expect(cancelled[0].data.order).toMatchObject({ status: 'cancelled', cancelReason: 'payment_window_expired', lateTransferPolicy: 'admin_decision' });
  const cancelledMail = await untilMail(request, buyer, 'Zamówienie anulowane');
  expect(cancelledMail.HTML).toContain('nie otrzymaliśmy wpłaty w terminie');
  await page.goto(new URL(payUrl).pathname + new URL(payUrl).search);
  await expect(page.getByRole('alert')).toContainText('Anulowane');
  await expect(page.getByRole('button', { name: 'Wysłałem przelew' })).toHaveCount(0);
});

test('admin accepts the late transfer at the order price although the promo seat was sold again @J184', async ({ page, request }) => {
  test.setTimeout(120000);
  const other = await placeViaRpc(event.id, `unpaid-other-${randomUUID()}@example.com`, sessionId);
  await loginAsAdmin(page, 'demo@sellf.app', 'demo123'); await page.goto('/pl/dashboard/payments');
  await page.getByLabel('Status', { exact: true }).selectOption('cancelled');
  const row = page.getByRole('row').filter({ hasText: buyer }); await row.getByRole('button', { name: /szczegóły/i }).click();
  const section = page.getByRole('region', { name: 'Przelew tradycyjny', exact: true });
  await expect(section.getByText('Anulowane automatycznie: minął termin rezerwacji')).toBeVisible();
  const form = section.getByRole('form', { name: 'Przyjmij spóźniony przelew po cenie z zamówienia' });
  await form.getByLabel('Data wpływu').fill(new Date().toISOString().slice(0, 10)); await form.getByLabel('Powód przyjęcia').fill('Przelew doszedł po terminie');
  await form.getByRole('button', { name: 'Przyjmij spóźniony przelew po cenie z zamówienia' }).click();
  await expect.poll(async () => (await db.from('payment_transactions').select('status').eq('id', orderId).single()).data?.status).toBe('completed');
  const tx = await checked(await db.from('payment_transactions').select('amount,metadata,reopened_at').eq('id', orderId).single());
  expect(tx.amount).toBe(10000); expect(tx.reopened_at).toBeTruthy(); expect((tx.metadata as Record<string, unknown>).oversold).toBe(true);
  const reopened = await webhook('order.reopened', orderId);
  expect(reopened).toHaveLength(1); expect(reopened[0].data.order).toMatchObject({ status: 'completed', previousStatus: 'cancelled' });
  await expect.poll(async () => (await webhook('purchase.completed', orderId)).length).toBe(1);
  expect((await checked(await db.from('payment_transactions').select('status').eq('id', other).single())).status).toBe('awaiting_payment');
  expect((await cron(request)).ok()).toBe(true); expect(await webhook('order.reopened', orderId)).toHaveLength(1);
});

test('an issued invoice holds the order with no expiry; a regular product is never released @J183', async ({ request }) => {
  test.setTimeout(90000);
  await checked(await db.from('product_sessions').update({ capacity: 10 }).eq('id', sessionId).select());
  // The 100 PLN promo seat is taken, so the next tier applies.
  const invoiced = await placeViaRpc(event.id, `unpaid-invoice-${randomUUID()}@example.com`, sessionId, 150);
  await checked(await db.from('invoices').insert({ transaction_id: invoiced, provider: 'fakturownia', provider_domain: 'fixture.fakturownia.pl', external_key: `e2e:${invoiced}`, status: 'issued' }).select());
  expect((await cron(request)).ok()).toBe(true);
  const held = await webhook('order.invoice_issued', invoiced);
  expect(held).toHaveLength(1); expect(held[0].data.order).toMatchObject({ reservation: 'invoice', releaseAt: null, status: 'awaiting_payment' });
  const course = await placeViaRpc(plain.id, `unpaid-plain-${randomUUID()}@example.com`);
  expect((await checked(await db.from('payment_transactions').select('release_at,reminder_at').eq('id', course).single()))).toEqual({ release_at: null, reminder_at: null });
  await checked(await db.from('payment_transactions').update({ payment_due_at: '2000-01-01T00:00:00Z' }).in('id', [invoiced, course]).select());
  expect((await cron(request)).ok()).toBe(true);
  const states = await checked(await db.from('payment_transactions').select('id,status').in('id', [invoiced, course]));
  expect(states.every(s => s.status === 'awaiting_payment')).toBe(true);
  expect(await webhook('order.payment_reminder', course)).toHaveLength(0);
  await db.from('invoices').delete().eq('transaction_id', invoiced);
});
