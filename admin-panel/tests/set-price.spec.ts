/** Set-price coupons through native checkout and transfer placement. */
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { supabaseAdmin as db, loginAsAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { readCheckoutTerms, setCheckoutTerms, restoreCheckoutTerms } from './helpers/checkout-settings';
import { test, startNativeCheckout } from './helpers/checkout-intent';

let product: { id: string; slug: string }, code: string, couponId: string;
let bank: Record<string, unknown>;
let savedTerms: boolean | null | undefined;
const settingsAdmin = { email: 'demo@sellf.app', password: 'demo123' };
async function checked<T>(result: { data: T; error: unknown }): Promise<NonNullable<T>> { if (result.error) throw result.error; return result.data!; }
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  savedTerms = await readCheckoutTerms();
  bank = await checked(await db.from('bank_transfer_config').select('*').single());
  await checked(await db.from('bank_transfer_config').update({ bank_transfer_enabled: true, bank_account_holder: 'Test shop', bank_account_number: 'PL61109010140000071219812874' }).eq('id', bank.id as boolean).select());
});
test.afterAll(async ({ browser }) => {
  try { if (bank) await checked(await db.from('bank_transfer_config').upsert(bank as never).select()); }
  finally { if (savedTerms !== undefined) await restoreCheckoutTerms(browser, settingsAdmin, savedTerms); }
});
test.beforeEach(async ({ page }) => {
  await setCheckoutTerms(page, settingsAdmin, true);
  code = `PRICE-${randomUUID().slice(0, 8)}`.toUpperCase();
  product = await checked(await db.from('products').insert({ name: 'Kupon 49 na 30', slug: `set-price-${randomUUID()}`, price: 49, currency: 'PLN', is_active: true, is_listed: true, vat_exempt: true }).select('id,slug').single());
  couponId = (await checked(await db.from('coupons').insert({ code, discount_type: 'set_price', discount_value: 30, currency: 'PLN', allowed_product_ids: [product.id] }).select('id').single())).id;
});
test.afterEach(async () => {
  await db.from('guest_purchases').delete().eq('product_id', product.id);
  await db.from('payment_transactions').delete().eq('product_id', product.id);
  await db.from('coupons').delete().eq('id', couponId);
  await db.from('products').delete().eq('id', product.id);
});
for (const event of [false, true]) test(`${event ? 'event tier 67' : 'product 49'} from coupon link charges 30 in Elements`, async ({ page }) => {
  if (event) {
    await checked(await db.from('products').update({ event_mode: true }).eq('id', product.id).select());
    const session = await checked(await db.from('product_sessions').insert({ product_id: product.id, title: 'Workshop', starts_at: '2099-06-01T12:00:00Z', timezone: 'Europe/Warsaw', capacity: 60 }).select('id').single());
    await checked(await db.from('product_price_tiers').insert([{ session_id: session.id, price: 47, sort: 0, sale_ends_at: '2000-01-01T12:00:00Z' }, { session_id: session.id, price: 67, sort: 1 }]).select());
  }
  await acceptAllCookies(page);
  await page.goto(`/pl/checkout/${product.slug}?coupon=${code}&email=price-buyer%40example.com`);
  await expect(page.getByRole('button', { name: /Usuń kod/ })).toBeVisible();
  await expect(page.getByTestId('order-summary-total')).toContainText('30,00');
  const response = await startNativeCheckout(page);
  expect(response.request().postDataJSON().couponCode).toBe(code);
  const tx = await checked(await db.from('payment_transactions').select('id,amount,coupon_id').eq('session_id', (await response.json()).checkoutSessionId).single());
  expect(Number(tx.amount)).toBe(3000); expect(tx.coupon_id).toBe(couponId);
  const lines = await checked(await db.from('payment_line_items').select('unit_price,discounted_total').eq('transaction_id', tx.id).single());
  expect(Number(lines.unit_price)).toBe(event ? 67 : 49); expect(Number(lines.discounted_total)).toBe(30);
});
test('product 49 from coupon link places a transfer for 30', async ({ page }) => {
  await checked(await db.from('products').update({ checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['organization'], gus: false, bank_transfer_for: ['organization'] }] } }).eq('id', product.id).select());
  await acceptAllCookies(page);
  await page.goto(`/pl/checkout/${product.slug}?coupon=${code}`);
  await expect(page.getByRole('button', { name: /Usuń kod/ })).toBeVisible();
  await page.getByRole('radio', { name: /Przelew tradycyjny/ }).check();
  for (const [key, value] of Object.entries({ company_name: 'Testowa firma', nip: '5260250274', address: 'Prosta 1', postal_code: '00-001', city: 'Warszawa' })) await page.locator(`[id="buyer.${key}"]`).fill(value);
  await page.getByLabel('Email', { exact: true }).fill(`price-${randomUUID()}@example.com`);
  await page.getByRole('checkbox', { name: /Zgadzam/ }).check();
  await expect(page.getByTestId('order-summary-total')).toContainText('30,00');
  const response = page.waitForResponse('**/api/orders/bank-transfer');
  await page.getByRole('button', { name: 'Zamawiam z obowiązkiem zapłaty' }).click();
  const result = await response; expect(result.status()).toBe(200);
  const body = await result.json(); expect(body.amount).toBe(3000);
  const tx = await checked(await db.from('payment_transactions').select('amount,coupon_id').eq('id', body.orderId).single());
  expect(Number(tx.amount)).toBe(3000); expect(tx.coupon_id).toBe(couponId);
});


test('v1 creates and edits a set-price coupon with currency validation @J100', async ({ page }) => {
  await loginAsAdmin(page, 'demo@sellf.app', 'demo123');
  let id: string | undefined;
  try {
    const created = await page.request.post('/api/v1/coupons', { data: { code: `API-${code}`, discount_type: 'set_price', discount_value: 30, currency: 'pln' } });
    expect(created.status()).toBe(201);
    const result = (await created.json()).data; id = result.id;
    expect(result).toMatchObject({ discount_type: 'set_price', discount_value: 30, currency: 'PLN' });
    expect((await page.request.patch(`/api/v1/coupons/${id}`, { data: { discount_value: 0 } })).status()).toBe(200);
    for (const data of [{ currency: null }, { discount_type: 'unknown' }, { currency: 'JPY', discount_value: 30.5 }]) {
      expect((await page.request.patch(`/api/v1/coupons/${id}`, { data })).status()).toBe(400);
    }
    expect((await page.request.patch(`/api/v1/coupons/${id}`, { data: { currency: 'JPY', discount_value: 30 } })).status()).toBe(200);
  } finally { if (id) await db.from('coupons').delete().eq('id', id); }
});
