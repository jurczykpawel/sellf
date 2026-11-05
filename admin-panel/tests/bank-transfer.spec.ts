import { useSupabaseBuyerEmails } from './helpers/buyer-email-setting-playwright';
useSupabaseBuyerEmails();
/** Traditional transfer buyer and administrator acceptance. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { loginAsAdmin, supabaseAdmin as db } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { readCheckoutTerms, setCheckoutTerms, restoreCheckoutTerms } from './helpers/checkout-settings';
import { restoreBaselineTaxMode } from './helpers/tax-mode';
import { MAILPIT_URL } from './helpers/mailpit';
import type { Page } from '@playwright/test';
let product: { id: string; slug: string }, sessionId: string, endpointId: string, orderId: string, unpaidId: string;
let bankConfig: unknown, invoiceConfig: unknown, shop: { id: string; tax_mode: string | null };
const email = `transfer-${randomUUID()}@example.com`, cancelledEmail = `cancel-${randomUUID()}@example.com`;
const ids: string[] = [];
let savedTerms: boolean | null | undefined;
const settingsAdmin = { email: 'demo@sellf.app', password: 'demo123' };
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SUPABASE_URL ?? '')) throw new Error('Requires a local disposable Supabase stack');
test.describe.configure({ mode: 'serial' });
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<NonNullable<T>> { if (error) throw error; return data!; }
test.beforeAll(async () => {
  savedTerms = await readCheckoutTerms();
  shop = await checked(await db.from('shop_config').select('id,tax_mode').single());
  bankConfig = await checked(await db.from('bank_transfer_config').select('*').single());
  invoiceConfig = await checked(await db.from('invoicing_config').select('*').single());
  product = await checked(await db.from('products').insert({ name: 'Przelew warsztat', slug: `transfer-${randomUUID()}`, price: 100, currency: 'PLN', is_active: true, is_listed: true, event_mode: true, vat_exempt: false, vat_rate: 23, price_includes_vat: false,
    checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['person', 'organization'], gus: false, bank_transfer_for: ['organization'] }] },
  }).select('id,slug').single());
  sessionId = (await checked(await db.from('product_sessions').insert({ product_id: product.id, title: 'Edycja testowa', starts_at: '2099-06-01T12:00:00Z', timezone: 'Europe/Warsaw', capacity: 3 }).select('id').single())).id;
  await checked(await db.from('product_price_tiers').insert({ session_id: sessionId, price: 100, sort: 0 }).select());
  endpointId = (await checked(await db.from('webhook_endpoints').insert({ url: 'https://127.0.0.1/transfer-fixture', events: ['order.placed', 'order.cancelled', 'order.overdue', 'purchase.completed'], secret: 'test-only-secret', product_filter_mode: 'selected', is_active: true }).select('id').single())).id;
  await checked(await db.from('webhook_endpoint_products').insert({ webhook_endpoint_id: endpointId, product_id: product.id }).select());
});
test.beforeEach(async ({ page }) => { await setCheckoutTerms(page, settingsAdmin, true); });
test.afterAll(async ({ browser }) => {
  try {
    if (endpointId) { await db.from('webhook_logs').delete().eq('endpoint_id', endpointId); await db.from('webhook_endpoints').delete().eq('id', endpointId); }
    if (product) {
      if (ids.length) await db.from('invoices').delete().in('transaction_id', ids);
      await db.from('guest_purchases').delete().eq('product_id', product.id);
      await db.from('payment_transactions').delete().eq('product_id', product.id);
      await db.from('products').delete().eq('id', product.id);
    }
    for (const buyerEmail of [email, cancelledEmail]) {
      const users = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users;
      for (const user of users.filter(u => u.email === buyerEmail)) await db.auth.admin.deleteUser(user.id);
    }
    if (shop) {
      const page = await browser.newPage();
      try {
        await loginAsAdmin(page, 'demo@sellf.app', 'demo123'); await page.goto('/pl/dashboard/settings');
        await page.getByRole('button', { name: 'Płatności', exact: true }).click();
        await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && !!r.request().postData()?.includes('tax_mode')),
          page.getByRole('button', { name: 'Stała stawka', exact: true }).click()]);
      } finally { await restoreBaselineTaxMode(db); await page.close(); }
    }
    if (bankConfig) await db.from('bank_transfer_config').upsert(bankConfig as never);
    if (invoiceConfig) await db.from('invoicing_config').upsert(invoiceConfig as never);
  } finally { if (savedTerms !== undefined) await restoreCheckoutTerms(browser, settingsAdmin, savedTerms); }
});
async function open(page: Page) { await acceptAllCookies(page); await page.goto(`/pl/checkout/${product.slug}`); await expect(page.getByLabel('Typ nabywcy')).toBeVisible(); }
async function place(page: Page, buyerEmail: string) {
  let stripeRequests = 0; page.on('request', r => { if (r.url().includes('/api/create-payment-intent') || r.url().startsWith('https://js.stripe.com/')) stripeRequests++; });
  await open(page); await page.getByLabel('Typ nabywcy').selectOption('organization');
  await page.getByRole('radio', { name: /Przelew tradycyjny/ }).check();
  for (const [key, value] of Object.entries({ first_name: 'Anna', last_name: 'Testowa', company_name: 'Testowa firma', nip: '5260250274', address: 'Prosta 1', postal_code: '00-001', city: 'Warszawa' })) await page.locator(`[id="buyer.${key}"]`).fill(value);
  await page.getByLabel('Email', { exact: true }).fill(buyerEmail);
  await page.getByRole('checkbox', { name: /Zgadzam/ }).check();
  await expect(page.getByTestId('order-summary-total')).toContainText('123,00');
  const submit = page.getByRole('button', { name: 'Zamawiam z obowiązkiem zapłaty' }); await expect(submit).toBeEnabled({ timeout: 30000 });
  const responsePromise = page.waitForResponse('**/api/orders/bank-transfer'); await submit.click();
  const response = await responsePromise; expect(response.status()).toBe(200);
  const order = await response.json(); expect(order.amount).toBe(12300); ids.push(order.orderId);
  await expect(page).toHaveURL(new RegExp(`/order/${order.orderId}/transfer\\?token=`));
  await expect(page.getByRole('heading', { name: `Dziękujemy za zamówienie nr ${order.orderNumber}` })).toBeVisible();
  await expect(page.getByText('PL61 1090 1014 0000 0712 1981 2874')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Drukuj / zapisz PDF' })).toBeVisible();
  expect(stripeRequests).toBe(0);
  return order;
}
async function adminDetails(page: Page, buyerEmail: string) {
  await loginAsAdmin(page, 'demo@sellf.app', 'demo123'); await page.goto('/pl/dashboard/payments');
  await page.getByLabel('Status', { exact: true }).selectOption('awaiting_payment');
  const row = page.getByRole('row').filter({ hasText: buyerEmail }); await expect(row).toBeVisible();
  await row.getByRole('button', { name: /szczegóły/i }).click();
  return page.getByRole('region', { name: 'Przelew tradycyjny', exact: true });
}
test('settings validate account and preview the title; person cannot select a transfer', async ({ page }) => {
  test.setTimeout(120000);
  await loginAsAdmin(page, 'demo@sellf.app', 'demo123'); await page.goto('/pl/dashboard/settings'); await page.getByRole('button', { name: 'Płatności', exact: true }).click();
  await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && !!r.request().postData()?.includes('tax_mode')), page.getByRole('button', { name: 'Stripe Tax', exact: true }).click()]);
  const settings = page.getByRole('region', { name: 'Przelew tradycyjny', exact: true }); await expect(settings.getByRole('button', { name: 'Zapisz', exact: true })).toBeEnabled();
  await settings.getByLabel('Włącz przelew tradycyjny').check(); await settings.getByLabel('Odbiorca przelewu').fill('Testowy sklep');
  await settings.getByLabel('Numer rachunku').fill('123'); await settings.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await expect(settings.getByRole('status')).toContainText('Popraw zaznaczone pola.');
  await expect(settings.getByRole('alert')).toContainText('Podaj polski numer rachunku');
  await expect(settings.getByLabel('Numer rachunku')).toHaveAttribute('aria-invalid', 'true');
  await settings.getByLabel('Numer rachunku').fill('PL61109010140000071219812874'); await settings.getByLabel('Szablon tytułu przelewu').fill('Zamówienie {order_number}');
  await expect(settings.getByText('Podgląd tytułu: Zamówienie 12345')).toBeVisible();
  await settings.getByLabel('Termin płatności (dni)').fill('14'); await settings.getByLabel('Przyznaj dostęp').check();
  await settings.getByRole('button', { name: 'Zapisz', exact: true }).click(); await expect(settings.getByRole('status')).toHaveText('Zapisano');
  await page.goto('/pl/dashboard/settings'); const invoice = page.getByRole('region', { name: 'Faktury', exact: true });
  await expect(invoice.getByRole('button', { name: 'Zapisz', exact: true })).toBeEnabled();
  await invoice.getByLabel('Dostawca', { exact: true }).selectOption('fakturownia'); await invoice.getByLabel('Domena konta Fakturowni').fill('fixture.fakturownia.pl');
  await invoice.getByLabel('Token API', { exact: true }).fill('fixture-token'); await invoice.getByLabel('Tryb wystawiania').selectOption('auto');
  await invoice.getByRole('button', { name: 'Zapisz', exact: true }).click(); await expect(invoice.getByRole('status')).toHaveText('Zapisano');
  await page.context().clearCookies(); await open(page);
  await expect(page.getByRole('radio', { name: /Przelew tradycyjny/ })).toHaveCount(0);
  await page.getByLabel('Typ nabywcy').selectOption('organization'); await page.getByRole('radio', { name: /Przelew tradycyjny/ }).check();
  await page.getByLabel('Typ nabywcy').selectOption('person'); await expect(page.getByRole('radio', { name: /Przelew tradycyjny/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Przejdź do płatności' })).toHaveCount(0);
  await expect(page.locator('[id="buyer.email"]')).toBeVisible();
});
test('(a) organization places transfer with immediate access, unpaid invoice, protected instructions and Auth mail @J52 @J231', async ({ page }) => {
  test.setTimeout(120000); const order = await place(page, email); orderId = order.orderId;
  const instructionsUrl = page.url();
  const tx = await checked(await db.from('payment_transactions').select('created_at,payment_due_at,status').eq('id', orderId).single());
  expect(tx.status).toBe('awaiting_payment'); expect(Date.parse(tx.payment_due_at!) - Date.parse(tx.created_at)).toBe(14 * 86400000);
  await expect.poll(async () => (await db.from('invoices').select('status,payment_synced').eq('transaction_id', orderId).single()).data).toMatchObject({ status: 'issued', payment_synced: false });
  expect((await db.from('guest_purchases').select('id').eq('transaction_id', orderId)).data).toHaveLength(1);
  await expect.poll(async () => (await db.from('payment_transactions').select('transfer_mail_sent_at').eq('id', orderId).single()).data?.transfer_mail_sent_at).toBeTruthy();
  expect(await checked(await db.from('seat_reservations').select('expires_at,status').eq('transaction_id', orderId).single())).toMatchObject({ expires_at: null, status: 'held' });
  expect((await page.request.get(new URL(instructionsUrl).pathname)).status()).toBe(404);
  expect((await page.request.get(instructionsUrl.replace(orderId, randomUUID()))).status()).toBe(404);
  await page.screenshot({ path: test.info().outputPath('instructions.png'), fullPage: true });
  const messages = await page.request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  expect(messages.ok()).toBe(true); const mailbox = await messages.json(); expect(mailbox.messages.length).toBeGreaterThan(0);
  const mail = await (await page.request.get(`${MAILPIT_URL}/api/v1/message/${mailbox.messages[0].ID}`)).json();
  expect(mail.HTML).toContain('PL61 1090 1014 0000 0712 1981 2874'); expect(mail.HTML).not.toContain('PL61109010140000071219812874'); expect(mail.HTML).toContain('Dane do przelewu');
  expect(mail.HTML).toMatch(/<td[^>]*>Numer konta<\/td>\s*<td[^>]*>PL61 1090/);
  const placed = await checked(await db.from('webhook_logs').select('payload').eq('endpoint_id', endpointId).eq('event_type', 'order.placed').single());
  expect(placed.payload).toMatchObject({ data: { order: { transfer: { account: 'PL61109010140000071219812874' } } } });
  await checked(await db.from('payment_transactions').update({ payment_due_at: '2000-01-01T00:00:00Z' }).eq('id', orderId).select());
  expect((await page.request.get('/api/cron?job=bank-transfer-overdue', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } })).ok()).toBe(true);
  expect((await db.from('payment_transactions').select('order_overdue_notified_at').eq('id', orderId).single()).data?.order_overdue_notified_at).toBeTruthy();
  await loginAsAdmin(page, 'demo@sellf.app', 'demo123'); await page.goto('/pl/dashboard');
  await expect(page.getByRole('link', { name: /Przelewy po terminie:/ })).toBeVisible();
  const section = await adminDetails(page, email); await expect(section.getByText('Testowy sklep')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: email })).toHaveClass(/bg-sf-warning-soft/);
});
test('(c) admin rejects amount mismatch and marks paid; invoice updates once using the receipt date, and tells the buyer the payment arrived @J53 @J232', async ({ page, request }) => {
  test.setTimeout(120000); const section = await adminDetails(page, email);
  const receiptDay = new Date().toISOString().slice(0, 10); // not before the order day, not in the future
  await section.getByLabel('Zaksięgowana kwota').fill('122'); await section.getByLabel('Data wpływu').fill(receiptDay);
  await section.getByRole('button', { name: 'Oznacz jako opłacone' }).click(); await expect(section.getByRole('status')).toContainText('pełnej kwocie');
  await section.getByLabel('Zaksięgowana kwota').fill('123'); await section.getByRole('button', { name: 'Oznacz jako opłacone' }).click();
  await expect.poll(async () => (await db.from('payment_transactions').select('status').eq('id', orderId).single()).data?.status).toBe('completed');
  expect((await request.get('/api/cron?job=invoices-retry', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } })).ok()).toBe(true);
  await expect.poll(async () => (await db.from('invoices').select('payment_synced').eq('transaction_id', orderId).single()).data?.payment_synced).toBe(true);
  expect((await db.from('invoices').select('*', { count: 'exact', head: true }).eq('transaction_id', orderId)).count).toBe(1);
  const log = readFileSync(process.env.INVOICE_FIXTURE_LOG!, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const number = (await checked(await db.from('payment_transactions').select('order_number').eq('id', orderId).single())).order_number;
  const issued = log.filter(l => l.action === 'issue' && l.oid.endsWith(`:${number}`)); expect(issued).toHaveLength(1); expect(issued[0].status).toBe('issued');
  expect(log.find(l => l.action === 'paid' && l.oid === issued[0].oid)?.paid_date).toBe(receiptDay);
  expect((await db.from('webhook_logs').select('id').eq('endpoint_id', endpointId).eq('event_type', 'purchase.completed')).data).toHaveLength(1);
  await expect.poll(async () => {
    const found = await (await request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    return found.messages.map((m: { Subject: string }) => m.Subject);
  }, { timeout: 30000 }).toContain('Płatność otrzymana: Przelew warsztat');
  const paidMail = await (await request.get(`${MAILPIT_URL}/api/v1/message/${(await (await request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()).messages[0].ID}`)).json();
  expect(paidMail.HTML).toContain('Przelew warsztat'); expect(paidMail.HTML).toMatch(/123,00\s?zł/); expect(paidMail.HTML).not.toContain('Numer konta');
});
test('(d) cancel requires a reason, returns event seat and access, and offers manual invoice correction @J54', async ({ page }) => {
  test.setTimeout(120000); const order = await place(page, cancelledEmail); unpaidId = order.orderId;
  const section = await adminDetails(page, cancelledEmail); await expect(section.getByRole('button', { name: 'Anuluj zamówienie' })).toBeDisabled();
  await section.getByLabel('Powód anulowania').fill('Rezygnacja klienta'); await section.getByRole('button', { name: 'Anuluj zamówienie' }).click();
  await expect.poll(async () => (await db.from('payment_transactions').select('status').eq('id', unpaidId).single()).data?.status).toBe('cancelled');
  expect((await db.from('guest_purchases').select('id').eq('transaction_id', unpaidId)).data).toHaveLength(0);
  expect((await db.from('seat_reservations').select('status').eq('transaction_id', unpaidId).single()).data?.status).toBe('released');
  const availability = await checked(await db.rpc('event_availability', { p_product_id: product.id })); expect((availability as unknown as { remaining: number }[])[0].remaining).toBe(2);
  await page.getByLabel('Status', { exact: true }).selectOption('cancelled'); const row = page.getByRole('row').filter({ hasText: cancelledEmail });
  await row.getByRole('button', { name: /szczegóły/i }).click(); const invoice = page.getByRole('region', { name: 'Faktury', exact: true });
  await expect(invoice.getByRole('button', { name: 'Oznacz jako skorygowaną' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('cancelled.png'), fullPage: true });
});
test('(e) missing and invalid captcha cannot place an order', async ({ request }) => {
  expect((await (await request.get('/api/runtime-config')).json()).captcha.provider).toBe('altcha');
  const body = { productId: product.id, email: 'no-captcha@example.com', moduleValues: {}, termsAccepted: true };
  expect((await request.post('/api/orders/bank-transfer', { data: body })).status()).toBe(400);
  expect((await request.post('/api/orders/bank-transfer', { data: { ...body, captchaToken: 'invalid' } })).status()).toBe(403);
});
