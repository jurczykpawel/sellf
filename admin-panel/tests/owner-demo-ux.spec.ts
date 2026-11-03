/** Owner demo feedback: funnel readability, compact participants, phone requirement. @see priv/tasks/2026-10-29-owner-demo-feedback.md */
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { test, startNativeCheckout } from './helpers/checkout-intent';
import { createTestAdmin, loginAsAdmin } from './helpers/admin-auth';
import { checkAccessibility } from './helpers/axe';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const created: string[] = [];
test.describe.configure({ mode: 'serial' });
test.afterAll(async () => {
  for (const id of created) {
    await db.from('payment_transactions').delete().eq('product_id', id);
    await db.from('products').delete().eq('id', id);
  }
});

async function makeProduct(name: string, modules: unknown[]) {
  const { data, error } = await db.from('products').insert({
    name, slug: `owner-ux-${randomUUID()}`, price: 100, description: '', currency: 'PLN', is_active: true,
    checkout_profile: { v: 1, modules }, price_includes_vat: true, vat_rate: 0,
  }).select('id,slug').single();
  expect(error).toBeNull();
  created.push(data!.id);
  return data!;
}
async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
async function openCheckout(page: Page, slug: string, quantity: number) {
  await acceptAllCookies(page);
  await page.goto(`/pl/checkout/${slug}`);
  await page.getByLabel('Ilość', { exact: true }).fill(String(quantity));
  await expect(page.locator('[id="buyer.first_name"]')).toBeVisible({ timeout: 30000 });
}
async function pay(page: Page) {
  await page.route('https://api.stripe.com/**/confirm', route => route.abort());
  const session = await (await startNativeCheckout(page)).json();
  const paymentEmail = page.locator('#checkoutEmail');
  if (await paymentEmail.count()) await paymentEmail.fill('buyer@example.com');
  const updated = page.waitForResponse('**/api/update-payment-metadata');
  await submit(page);
  expect((await updated).status()).toBe(200);
  return session.checkoutSessionId as string;
}
async function submit(page: Page) {
  const terms = page.getByRole('checkbox', { name: /Zgadzam|Akceptuję/ });
  if (await terms.count()) await terms.check();
  const button = page.getByRole('button', { name: /^Zapłać/ });
  await expect(button).toBeEnabled({ timeout: 30000 });
  await button.click();
}
const base = [{ id: 'buyer', types: ['person'], gus: false }, { id: 'quantity', min: 1, max: 20, mode: 'checkout' }];

test('dashboard funnel adds up and keeps details collapsed on a phone @J190', async ({ page }) => {
  const product = await makeProduct('Funnel UX', []);
  const rows = ['completed', 'pending', 'abandoned', 'cancelled'].map(status => ({
    session_id: `cs_ux_${randomUUID().replace(/-/g, '')}`, product_id: product.id, customer_email: 'pending@sellf.app',
    amount: 10000, currency: 'PLN', status,
  }));
  expect((await db.from('payment_transactions').insert(rows)).error).toBeNull();
  const admin = await createTestAdmin('funnel-ux');
  try {
    await loginAsAdmin(page, admin.email, admin.password);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/pl/dashboard?productId=${product.id}`);
    const sum = page.getByText(/Zapisane próby: 4 = 1 opłaconych \+ 1 oczekujących \+ 1 porzuconych \+ 1 innych/);
    await expect(sum).toBeVisible({ timeout: 30000 });
    const section = page.locator('section[aria-labelledby="checkout-funnel-title"]');
    const details = section.locator('details');
    expect(await details.count()).toBeGreaterThanOrEqual(2);
    for (const item of await details.all()) await expect(item).not.toHaveAttribute('open', '');
    await expect(section.locator('table')).toBeHidden();
    await section.locator('summary', { hasText: 'Podział na produkty' }).click();
    await expect(section.locator('table')).toBeVisible();
    await noHorizontalScroll(page);
  } finally { await admin.cleanup(); }
});

test('ten participants fit a compact list: paste fills rows, no horizontal scroll, accessible on 390 px @J191', async ({ page }) => {
  const product = await makeProduct('Ten seats', [...base, { id: 'participants', required: true, prefill_from_buyer: false }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await openCheckout(page, product.slug, 10);
  await page.locator('[id="buyer.first_name"]').fill('Anna');
  await page.locator('[id="buyer.last_name"]').fill('Nowak');
  const list = Array.from({ length: 10 }, (_, i) => `Osoba${i}, Nazwisko${i}, osoba${i}@example.com`).join('\n');
  await page.getByLabel('Wklej listę').fill(list);
  await page.getByRole('button', { name: 'Wypełnij z listy' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Wypełniono 10 z 10' })).toBeVisible();
  await expect(page.locator('[id="participants.9.email"]')).toHaveValue('osoba9@example.com');
  await noHorizontalScroll(page);
  const rowHeight = await page.locator('ol > li').first().evaluate(el => el.getBoundingClientRect().height);
  expect(rowHeight).toBeLessThan(140);
  await checkAccessibility(page, { excludeSelectors: ['iframe'] });
  const sessionId = await pay(page);
  const { data: tx } = await db.from('payment_transactions').select('order_details').eq('session_id', sessionId).single();
  expect(tx!.order_details.participants.people).toHaveLength(10);
  expect(tx!.order_details.participants.people[9]).toEqual({ first_name: 'Osoba9', last_name: 'Nazwisko9', email: 'osoba9@example.com' });
});

test('participants can be imported from a CSV file @J191', async ({ page }) => {
  const product = await makeProduct('CSV seats', [...base, { id: 'participants', required: true, prefill_from_buyer: false }]);
  await openCheckout(page, product.slug, 3);
  await page.getByLabel('Importuj CSV').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from('imię,nazwisko,email\nJan,Nowak,jan@example.com\nAnna,Kowalska,anna@example.com\n') });
  await expect(page.getByRole('status').filter({ hasText: 'Wypełniono 2 z 3' })).toBeVisible();
  await expect(page.locator('[id="participants.1.last_name"]')).toHaveValue('Kowalska');
  await expect(page.locator('[id="participants.2.email"]')).toHaveValue('');
});

test('the buyer can add participants later when the product allows it @J192', async ({ page }) => {
  const product = await makeProduct('Later seats', [...base, { id: 'participants', required: true, prefill_from_buyer: false, allow_later: true }]);
  await openCheckout(page, product.slug, 4);
  await page.locator('[id="buyer.first_name"]').fill('Anna');
  await page.locator('[id="buyer.last_name"]').fill('Nowak');
  await page.getByLabel('Uzupełnię uczestników później').check();
  await expect(page.locator('[id="participants.0.first_name"]')).toHaveCount(0);
  const sessionId = await pay(page);
  const { data: tx } = await db.from('payment_transactions').select('order_details').eq('session_id', sessionId).single();
  expect(tx!.order_details.participants.people).toEqual([]);
  expect(tx!.order_details.quantity.value).toBe(4);
});

test('phone is required, optional or hidden per product @J193', async ({ page }) => {
  const required = await makeProduct('Phone required', [{ id: 'buyer', types: ['person'], gus: false }, { id: 'phone', required: true }]);
  const optional = await makeProduct('Phone optional', [{ id: 'buyer', types: ['person'], gus: false }, { id: 'phone', required: false }]);
  const hidden = await makeProduct('Phone hidden', [{ id: 'buyer', types: ['person'], gus: false }]);
  await acceptAllCookies(page);
  for (const [item, visible] of [[required, true], [optional, true], [hidden, false]] as const) {
    await page.goto(`/pl/checkout/${item.slug}`);
    await expect(page.locator('[id="buyer.first_name"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#phone')).toHaveCount(visible ? 1 : 0);
  }
  await page.goto(`/pl/checkout/${optional.slug}`);
  await page.locator('[id="buyer.first_name"]').fill('Anna');
  await page.locator('[id="buyer.last_name"]').fill('Nowak');
  const sessionId = await pay(page);
  const { data: tx } = await db.from('payment_transactions').select('order_details').eq('session_id', sessionId).single();
  expect(tx!.order_details.phone.value).toBe('');
});
