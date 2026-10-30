/** Event storefront acceptance with explicit inventory/deadline fixtures. */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';
import { test, startNativeCheckout } from './helpers/checkout-intent';
import { getTestDatabaseContainer } from './helpers/database-container';
import type { Page } from '@playwright/test';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let product: { id: string; slug: string }; let session: string; let cheap: string;
async function checked<T>(r: { data: T; error: unknown }): Promise<NonNullable<T>> { if (r.error) throw r.error; return r.data!; }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }); }
test.beforeEach(async () => {
  product = await checked(await db.from('products').insert({ name: 'Warsztat wydarzeń', slug: `event-ui-${randomUUID()}`, price: 99, currency: 'PLN', is_active: true, is_listed: true, event_mode: true, vat_exempt: true }).select('id,slug').single());
  session = (await checked(await db.from('product_sessions').insert({ product_id: product.id, starts_at: '2099-06-01T12:00:00Z', timezone: 'America/New_York', title: 'Edycja czerwcowa', venue: 'Sala 1', extra_days: 'Także w sobotę', capacity: 60 }).select('id').single())).id;
  cheap = (await checked(await db.from('product_price_tiers').insert({ session_id: session, price: 47, seats: 30, sale_ends_at: '2099-05-01T12:00:00Z', sort: 0 }).select('id').single())).id;
  await checked(await db.from('product_price_tiers').insert({ session_id: session, price: 67, sort: 1 }));
});
test.afterEach(async () => {
  if (!product) return;
  await checked(await db.from('guest_purchases').delete().eq('product_id', product.id));
  await checked(await db.from('payment_transactions').delete().eq('product_id', product.id));
  await checked(await db.from('products').delete().eq('id', product.id));
});
async function open(page: Page, path = 'checkout', query = '') {
  await acceptAllCookies(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/pl/${path}/${product.slug}?email=event-buyer%40example.com${query}`);
  await expect(page.getByTestId('event-sessions')).toBeVisible();
}
async function hold(quantity: number) {
  return checked(await db.rpc('place_order', { p_order: { product_id: product.id, currency: 'PLN', customer_email: `${randomUUID()}@example.com`, session_id: `cs_test_${randomUUID().replaceAll('-','')}` }, p_lines: [{ product_id: product.id, item_type: 'main_product', product_name: 'Workshop', quantity, unit_price: 47, total_price: 47*quantity, discounted_total: 47*quantity, currency: 'PLN', session_id: session }] }));
}
test('(a) product and checkout show promotional tier, timezone and hold at 47', async ({ page }) => {
  await acceptAllCookies(page); await page.goto(`/pl/p/${product.slug}`);
  await page.getByLabel('E-mail nabywcy').fill('event-buyer@example.com');
  await page.getByLabel('E-mail nabywcy').blur();
  await expect(page.getByText('Zostało 30 miejsc w tej cenie')).toBeVisible();
  await expect(page.getByText(/Ta cena do/)).toBeVisible();
  await expect(page.getByText(/Potem.*67/)).toBeVisible();
  await expect(page.getByText(/America\/New_York/).first()).toBeVisible();
  await expect(page.getByText(/Najniższa cena/)).toHaveCount(0);
  await expect(page.getByRole('radio')).toBeChecked();
  await page.screenshot({ path: '/private/tmp/w13-event-ui.png', fullPage: true, animations: 'disabled' });
  const response = await startNativeCheckout(page);
  expect(response.request().postDataJSON().sessionId).toBe(session);
  const tx = await checked(await db.from('payment_transactions').select('id,amount').eq('session_id',(await response.json()).checkoutSessionId).single());
  expect(Number(tx.amount)).toBe(4700);
  expect(await checked(await db.from('seat_reservations').select('status,tier_id').eq('transaction_id',tx.id).single())).toMatchObject({ status: 'held', tier_id: cheap });
});
test('(b) thirty-first buyer sees 67 after thirty promotional places are held @J51', async ({ page }) => {
  await hold(30); await open(page);
  await expect(page.getByText('Tańsze miejsca wyprzedane')).toBeVisible();
  const response = await startNativeCheckout(page);
  const tx = await checked(await db.from('payment_transactions').select('amount').eq('session_id',(await response.json()).checkoutSessionId).single());
  expect(Number(tx.amount)).toBe(6700);
});
test('(c) an elapsed sale deadline switches to 67 without waiting for time @J51', async ({ page }) => {
  sql(`UPDATE public.product_price_tiers SET sale_ends_at='2000-01-01' WHERE id='${cheap}'`);
  await open(page); await expect(page.getByText('Tańsze miejsca wyprzedane')).toBeVisible();
  await expect(page.getByText(/Zostało 30/)).toHaveCount(0);
  const response = await startNativeCheckout(page);
  expect(Number((await checked(await db.from('payment_transactions').select('amount').eq('session_id',(await response.json()).checkoutSessionId).single())).amount)).toBe(6700);
});
test('(d) exhausted session has no purchase control', async ({ page }) => {
  sql(`UPDATE public.product_sessions SET capacity=1 WHERE id='${session}'`); await hold(1); await open(page);
  await expect(page.getByText('Brak wolnych miejsc')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Przejdź do płatności' })).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(0);
});
test('(e) URL selects a session and changing it replaces the payment session', async ({ page }) => {
  const second = (await checked(await db.from('product_sessions').insert({ product_id: product.id, starts_at: '2099-07-01T12:00:00Z', title: 'Lipcowy' }).select('id').single())).id;
  await checked(await db.from('product_price_tiers').insert({ session_id: second, price: 77, sort: 0 }));
  await open(page, 'p', `&session=${second}`);
  await expect(page.locator(`input[value="${second}"]`)).toBeChecked();
  const first = await startNativeCheckout(page); const firstBody = await first.json(); expect(first.request().postDataJSON().sessionId).toBe(second);
  const nextResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/create-payment-intent' && r.request().postDataJSON()?.sessionId === session && !r.request().postDataJSON()?.expireOnly);
  await page.locator(`input[value="${session}"]`).check();
  await startNativeCheckout(page);
  const next = await nextResponse; expect(next.status()).toBe(200);
  expect((await next.json()).checkoutSessionId).not.toBe(firstBody.checkoutSessionId);
});
test('(f) recording bump gives three registered participants recording access', async ({ page }) => {
  const recording = await checked(await db.from('products').insert({ name: 'Nagranie', slug: `recording-${randomUUID()}`, price: 10, currency: 'PLN', vat_exempt: true }).select('id').single());
  const people = Array.from({ length: 3 }, () => ({ first_name: 'Jan', last_name: 'Nowak', email: `participant-${randomUUID()}@example.com` }));
  const users: string[] = [];
  try {
    await checked(await db.from('products').update({ checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 3, max: 3, mode: 'hidden' }, { id: 'participants', required: true, prefill_from_buyer: false }] } }).eq('id', product.id));
    await checked(await db.from('order_bumps').insert({ main_product_id: product.id, bump_product_id: recording.id, bump_title: 'Nagranie', bump_price: 10, is_active: true }));
    await open(page); await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    for (let i=0;i<3;i++) for (const [key,value] of Object.entries(people[i])) await page.locator(`[id="participants.${i}.${key}"]`).fill(value);
    const response = await startNativeCheckout(page); const body = await response.json();
    await expect(page.locator('[data-test-email]')).toHaveAttribute('data-test-email', 'event-buyer@example.com');
    await expect(page.locator('#checkoutEmail')).toHaveCount(0);
    const tx = await checked(await db.from('payment_transactions').select('id').eq('session_id',(await response.json()).checkoutSessionId).single());
    const metadata = await page.request.post('/api/update-payment-metadata', { headers: { origin: new URL(page.url()).origin }, data: { clientSecret: body.clientSecret, bindingToken: body.bindingToken, productId: product.id, moduleValues: { quantity: 3, participants: people }, termsAccepted: true, locale: 'pl' } });
    expect(metadata.status()).toBe(200);
    expect((await checked(await db.from('payment_transactions').select('order_details').eq('id',tx.id).single())).order_details.participants.people).toHaveLength(3);
    sql(`SELECT public._order_grant_and_record('${tx.id}',NULL,NULL,NULL,NULL,'none')`);
    for (const person of people) {
      const created = await db.auth.admin.createUser({ email: person.email, email_confirm: true }); expect(created.error).toBeNull(); users.push(created.data.user!.id);
      expect(await checked(await db.from('user_product_access').select('id').eq('user_id',created.data.user!.id).eq('product_id',recording.id))).toHaveLength(1);
    }
  } finally {
    for (const id of users) await db.auth.admin.deleteUser(id);
    await db.from('guest_purchases').delete().eq('product_id', recording.id);
    await db.from('order_bumps').delete().eq('main_product_id',product.id);
    await db.from('products').delete().eq('id',recording.id);
  }
});
test('409 refreshes current availability and 429 shows a translated retry message', async ({ page }) => {
  await page.route('**/api/create-payment-intent', route => route.fulfill({ status: 409, json: { error: 'sold_out' } }));
  const refreshed = page.waitForResponse('**/availability');
  await open(page); await refreshed;
  await expect(page.getByText('Brak wolnych miejsc')).toBeVisible();
  await page.route('**/api/create-payment-intent', route => route.fulfill({ status: 429, json: { error: 'event_hold_limit' } }));
  await page.reload();
  await expect(page.getByText('Zbyt wiele rezerwacji. Spróbuj ponownie później.')).toBeVisible();
});
test('catalogue renders the live nearest-session price and date through its public contract', async ({ page }) => {
  await checked(await db.from('products').update({ name: product.slug, sale_price: 1 }).eq('id',product.id));
  const later = (await checked(await db.from('product_sessions').insert({ product_id: product.id, starts_at: '2099-07-01T12:00:00Z' }).select('id').single())).id;
  await checked(await db.from('product_price_tiers').insert({ session_id: later, price: 77, sort: 0 }));
  await acceptAllCookies(page);
  const response = await page.goto(`/pl/store?search=${product.slug}`);
  expect(response?.status()).toBe(200);
  const card = page.locator('article').filter({ hasText: product.slug });
  await expect(card.getByText(/od 47,00/)).toBeVisible();
  await expect(card.getByText(/America\/New_York/)).toBeVisible();
  await expect(card.getByText(/Najniższa cena/)).toHaveCount(0);
});

test('unlisted event shows sessions and tier price from a direct link but stays out of the catalogue', async ({ page }) => {
  await checked(await db.from('products').update({ is_listed: false, name: product.slug }).eq('id', product.id));
  await acceptAllCookies(page);
  await page.goto(`/pl/p/${product.slug}`);
  await expect(page).toHaveURL(new RegExp(`/pl/checkout/${product.slug}`));
  await expect(page.getByTestId('event-sessions')).toBeVisible();
  await expect(page.getByText('Edycja czerwcowa', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Zostało 30 miejsc w tej cenie')).toBeVisible();
  await expect(page.getByRole('radio')).toBeChecked();
  await expect(page.getByTestId('event-sessions').getByText(/^47,00/)).toBeVisible();
  const availability = await page.request.get(`/api/public/products/${product.slug}/availability`);
  expect(availability.status()).toBe(200);
  expect((await availability.json()).sessions[0].currentTier.price).toBe(47);
  await page.goto(`/pl/store?search=${product.slug}`);
  await expect(page.locator('article').filter({ hasText: product.slug })).toHaveCount(0);
});
