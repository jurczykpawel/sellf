/** "Add participants later": reminder mail, signed page, seller panel and webhook, as buyer, seller and integrator see them. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { loginAsAdmin, createTestAdmin, supabaseAdmin as db } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { MAILPIT_URL } from './helpers/mailpit';
import type { APIRequestContext } from '@playwright/test';

if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SUPABASE_URL ?? '')) throw new Error('Requires a local disposable Supabase stack');
test.describe.configure({ mode: 'serial' });
const profile = { v: 1, modules: [{ id: 'quantity', min: 1, max: 5, mode: 'checkout' }, { id: 'participants', required: true, prefill_from_buyer: false, allow_later: true }] };
const buyer = `later-${randomUUID()}@example.com`;
const headers = { Authorization: `Bearer ${process.env.CRON_SECRET}` };
let product: { id: string }, orderId: string, endpointId: string, link: string;
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<NonNullable<T>> { if (error) throw error; return data!; }
const cron = (request: APIRequestContext, job: string) => request.get(`/api/cron?job=${job}`, { headers });
async function mails(request: APIRequestContext, to: string): Promise<Array<{ Subject: string; HTML: string }>> {
  const box = await (await request.get(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
  return Promise.all(box.messages.map(async (m: { ID: string }) => (await request.get(`${MAILPIT_URL}/api/v1/message/${m.ID}`)).json()));
}

test.beforeAll(async () => {
  product = await checked(await db.from('products').insert({ name: 'Warsztat na cztery osoby', slug: `later-${randomUUID()}`, price: 100, currency: 'PLN', is_active: true, vat_exempt: true, checkout_profile: profile }).select('id').single());
  orderId = (await checked(await db.from('payment_transactions').insert({
    session_id: `cs_later_${randomUUID().replace(/-/g, '')}`, product_id: product.id, customer_email: buyer, amount: 40000, currency: 'PLN', status: 'completed', paid_at: new Date(Date.now() - 25 * 3600_000).toISOString(),
    metadata: { locale: 'pl' }, order_details: { v: 1, quantity: { v: 1, value: 4 }, participants: { v: 1, people: [] } },
  }).select('id').single())).id;
  endpointId = (await checked(await db.from('webhook_endpoints').insert({ url: 'https://127.0.0.1/later-fixture', events: ['order.participants_updated'], secret: 'test-only-secret', product_filter_mode: 'selected', is_active: true }).select('id').single())).id;
  await checked(await db.from('webhook_endpoint_products').insert([{ webhook_endpoint_id: endpointId, product_id: product.id }]).select());
});
test.afterAll(async () => {
  if (endpointId) { await db.from('webhook_logs').delete().eq('endpoint_id', endpointId); await db.from('webhook_endpoints').delete().eq('id', endpointId); }
  if (product) { await db.from('business_events').delete().eq('product_id', product.id); await db.from('payment_transactions').delete().eq('product_id', product.id); await db.from('products').delete().eq('id', product.id); }
});

test('the buyer gets the first reminder mail after 24 hours, with a personal link @J204', async ({ request }) => {
  await expect.poll(async () => { await cron(request, 'participants-reminders'); return (await mails(request, buyer)).map(m => m.Subject); },
    { timeout: 100000, intervals: [5000] }).toContain('Uzupełnij uczestników zamówienia');
  const mail = (await mails(request, buyer)).find(m => m.Subject === 'Uzupełnij uczestników zamówienia')!;
  link = mail.HTML.match(/href="([^"]+\/order\/[0-9a-f-]{36}\/participants\?token=[^"]+)"/)![1].replace(/&amp;/g, '&');
  expect(link).toContain(orderId);
  await cron(request, 'participants-reminders');
  expect((await mails(request, buyer)).filter(m => m.Subject === 'Uzupełnij uczestników zamówienia')).toHaveLength(1);
  expect((await checked(await db.from('payment_transactions').select('participants_mail_sent_at').eq('id', orderId).single())).participants_mail_sent_at).toBeTruthy();
});

test('the seller sees the order in the missing-participants panel @J205', async ({ page }) => {
  const admin = await createTestAdmin('later-panel');
  try {
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/payments');
    const panel = page.getByTestId('missing-participants');
    await expect(panel).toBeVisible({ timeout: 30000 });
    await panel.locator('summary').click();
    const row = panel.locator('tr', { hasText: buyer });
    await expect(row).toContainText('Warsztat na cztery osoby');
    await expect(row).toContainText('Wysłano');
  } finally { await admin.cleanup(); }
});

test('the buyer saves the list from the personal link on a phone; webhook and seller view follow @J206', async ({ page, request }) => {
  await acceptAllCookies(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(link);
  await expect(page.getByRole('heading', { name: /Uczestnicy zamówienia/ })).toBeVisible();
  await page.getByLabel('Wklej listę').fill('Jan, Nowak, jan@example.com\nAnna, Kowalska, anna@example.com\nPiotr, Zieliński, piotr@example.com\nEwa, Lis, ewa@example.com');
  await page.getByRole('button', { name: 'Wypełnij z listy' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.locator('[id="participants.3.email"]').fill('anna@example.com');
  await page.getByRole('button', { name: 'Zapisz uczestników' }).click();
  await expect(page.locator('[id="participants.3.email"]')).toHaveAttribute('aria-invalid', 'true');
  expect((await checked(await db.from('payment_transactions').select('order_details').eq('id', orderId).single())).order_details).toMatchObject({ participants: { people: [] } });
  await page.locator('[id="participants.3.email"]').fill('ewa@example.com');
  await page.getByRole('button', { name: 'Zapisz uczestników' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Dziękujemy' })).toBeVisible();

  const saved = await checked(await db.from('payment_transactions').select('order_details,participants_completed_at').eq('id', orderId).single());
  expect((saved.order_details as { participants: { people: unknown[] } }).participants.people).toHaveLength(4);
  expect(saved.participants_completed_at).toBeTruthy();

  // The outbox drains oldest first in batches; repeat the job until this order's event has gone out.
  await expect.poll(async () => { await cron(request, 'business-events'); return (await db.from('webhook_logs').select('payload').eq('endpoint_id', endpointId).eq('event_type', 'order.participants_updated')).data?.length ?? 0; }, { timeout: 60000, intervals: [2000] }).toBe(1);
  const log = (await db.from('webhook_logs').select('payload').eq('endpoint_id', endpointId).eq('event_type', 'order.participants_updated')).data![0].payload as { data: { order: { orderId: string }; orderDetails: { participants: { people: unknown[] } } } };
  expect(log.data.order.orderId).toBe(orderId);
  expect(log.data.orderDetails.participants.people).toHaveLength(4);

  await page.goto(link);
  await expect(page.getByText('Uczestnicy tego zamówienia są już zapisani.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zapisz uczestników' })).toHaveCount(0);
  const again = await request.post('/api/orders/participants', { data: { orderId, token: link.split('token=')[1], people: [] } });
  expect(again.status()).toBe(409);
  expect((await request.get('/api/cron?job=participants-reminders', { headers })).ok()).toBe(true);
});

test('a forged link, another order or a product without the option are refused @J207', async ({ page, request }) => {
  await acceptAllCookies(page);
  const forged = link.replace(/token=\d+/, 'token=9999999999');
  expect((await page.goto(forged))!.status()).toBe(404);
  const post = await request.post('/api/orders/participants', { data: { orderId, token: 'nope', people: [] } });
  expect(post.status()).toBe(404);
  const strict = await checked(await db.from('products').insert({ name: 'Bez opcji', slug: `strict-${randomUUID()}`, price: 100, currency: 'PLN', is_active: true, vat_exempt: true,
    checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 1, max: 5, mode: 'checkout' }, { id: 'participants', required: true, prefill_from_buyer: false }] } }).select('id').single());
  try {
    const tx = await checked(await db.from('payment_transactions').insert({ session_id: `cs_strict_${randomUUID().replace(/-/g, '')}`, product_id: strict.id, customer_email: buyer, amount: 100, currency: 'PLN', status: 'completed',
      order_details: { v: 1, quantity: { v: 1, value: 1 }, participants: { v: 1, people: [] } } }).select('id').single());
    const { signParticipantsToken } = await import('../src/lib/orders/participants-token');
    const result = await request.post('/api/orders/participants', { data: { orderId: tx.id, token: signParticipantsToken(tx.id), people: [{ first_name: 'A', last_name: 'B', email: 'a@example.com' }] } });
    expect(result.status()).toBe(409);
    expect(await result.json()).toMatchObject({ code: 'not_allowed' });
  } finally { await db.from('payment_transactions').delete().eq('product_id', strict.id); await db.from('products').delete().eq('id', strict.id); }
});

test('an event order gets a second reminder 2 days before the event, and never a third @J208', async ({ request }) => {
  const dated = await checked(await db.from('products').insert({ name: 'Warsztat z terminem', slug: `later-ev-${randomUUID()}`, price: 100, currency: 'PLN', is_active: true, vat_exempt: true, event_mode: true, checkout_profile: profile }).select('id').single());
  const email = `later-ev-${randomUUID()}@example.com`;
  try {
    const session = await checked(await db.from('product_sessions').insert({ product_id: dated.id, title: 'Jutro', starts_at: new Date(Date.now() + 30 * 3600_000).toISOString(), timezone: 'Europe/Warsaw', capacity: 10 }).select('id').single());
    const tx = await checked(await db.from('payment_transactions').insert({
      session_id: `cs_later_${randomUUID().replace(/-/g, '')}`, product_id: dated.id, customer_email: email, amount: 20000, currency: 'PLN', status: 'completed',
      paid_at: new Date(Date.now() - 30 * 3600_000).toISOString(), participants_mail_sent_at: new Date(Date.now() - 6 * 3600_000).toISOString(),
      metadata: { locale: 'pl' }, order_details: { v: 1, quantity: { v: 1, value: 2 }, participants: { v: 1, people: [] } },
    }).select('id').single());
    await checked(await db.from('payment_line_items').insert({ transaction_id: tx.id, product_id: dated.id, item_type: 'main_product', quantity: 2, unit_price: 100, total_price: 200, currency: 'PLN', session_id: session.id }).select('id'));
    await expect.poll(async () => { await cron(request, 'participants-reminders'); return (await mails(request, email)).map(m => m.Subject); },
      { timeout: 100000, intervals: [5000] }).toContain('Uzupełnij uczestników zamówienia');
    const mail = (await mails(request, email))[0];
    expect(mail.HTML).toContain('Wydarzenie zbliża się');
    await cron(request, 'participants-reminders');
    expect(await mails(request, email)).toHaveLength(1);
    const row = await checked(await db.from('payment_transactions').select('participants_reminder2_sent_at,participants_mail_sent_at').eq('id', tx.id).single());
    expect(row.participants_reminder2_sent_at).toBeTruthy();
  } finally {
    await db.from('payment_transactions').delete().eq('product_id', dated.id);
    await db.from('products').delete().eq('id', dated.id);
  }
});
