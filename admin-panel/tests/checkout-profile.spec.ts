/** Checkout profile collection and pre-payment validation. @see lib/checkout-modules/registry.ts */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { startNativeCheckout } from './helpers/checkout-intent';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const profile = { v: 1, modules: [
  { id: 'buyer', types: ['person', 'organization'], gus: false },
  { id: 'recipient', for: ['organization'] }, { id: 'phone', required: true },
  { id: 'quantity', min: 1, max: 5, mode: 'checkout' },
  { id: 'participants', required: true, prefill_from_buyer: true },
] };
let product: { id: string; slug: string };
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  const { data, error } = await db.from('products').insert({
    name: 'Warsztat zespołowy', slug: `profile-${randomUUID()}`, price: 100, description: '',
    currency: 'PLN', is_active: true, checkout_profile: profile, price_includes_vat: true, vat_rate: 0,
  }).select('id,slug').single();
  expect(error).toBeNull(); product = data!;
});
test.afterAll(async () => {
  if (!product) return;
  await db.from('guest_purchases').delete().eq('product_id', product.id);
  await db.from('payment_transactions').delete().eq('product_id', product.id);
  await db.from('products').delete().eq('id', product.id);
});
async function open(page: Page, quantity = 1) {
  await acceptAllCookies(page);
  await page.goto(`/pl/checkout/${product.slug}`);
  await expect(page.getByRole('button', { name: 'Przejdź do płatności' })).toBeEnabled();
  if (quantity !== 1) await page.getByLabel('Ilość', { exact: true }).fill(String(quantity));
  const response = await startNativeCheckout(page);
  await expect(page.locator('#checkoutEmail')).toBeVisible();
  await page.locator('#checkoutEmail').fill('buyer@example.com');
  await page.route('https://api.stripe.com/**/confirm', route => route.abort());
  return (await response.json()).checkoutSessionId as string;
}
async function party(page: Page, prefix: string, omitNip = false) {
  for (const [key, value] of Object.entries({ company_name: 'Pracownia', nip: '5260250274', address: 'Prosta 1', postal_code: '00-001', city: 'Warszawa' })) {
    if (!(omitNip && key === 'nip')) await page.locator(`[id="${prefix}.${key}"]`).fill(value);
  }
}
async function submit(page: Page) {
  const terms = page.getByRole('checkbox', { name: /Zgadzam|Akceptuję/ });
  if (await terms.count()) await terms.check();
  const button = page.getByRole('button', { name: /^Zapłać/ });
  await expect(button).toBeEnabled({ timeout: 30000 });
  const response = page.waitForResponse('**/api/update-payment-metadata');
  await button.click();
  return await response;
}
for (const mode of ['checkout', 'product_page']) {
  for (const value of ['0', '-1', '', 'abc', '1.5', '6']) {
    test(`${mode} quantity ${JSON.stringify(value)} keeps the last valid price`, async ({ page }) => {
      expect((await db.from('products').update({ checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 1, max: 5, mode }] } }).eq('id', product.id)).error).toBeNull();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await acceptAllCookies(page);
      await page.goto(`/pl/checkout/${product.slug}`);
      await expect(page.getByRole('button', { name: 'Przejdź do płatności' })).toBeEnabled();
      const quantity = page.getByLabel('Ilość', { exact: true });
      await quantity.fill('3');
      const summary = page.locator('[data-testid="order-summary-total"]');
      await expect(summary).toContainText('300,00');
      const before = await summary.textContent();
      await quantity.fill(value);
      await expect(quantity).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#checkoutQuantity-error')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Przejdź do płatności' })).toBeDisabled();
      expect(await summary.textContent()).toBe(before);
      expect(errors).toEqual([]);
      await quantity.fill('2');
      await expect(quantity).toHaveAttribute('aria-invalid', 'false');
      await expect(page.getByRole('button', { name: 'Przejdź do płatności' })).toBeEnabled();
    });
  }
}
test('product route validates quantity and initialized checkout keeps its last valid session', async ({ page }) => {
  expect((await db.from('products').update({ is_listed: true, checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 1, max: 5, mode: 'product_page' }] } }).eq('id', product.id)).error).toBeNull();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await acceptAllCookies(page);
  await page.goto(`/p/${product.slug}`);
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeEnabled();
  const quantity = page.getByLabel('Quantity', { exact: true });
  await quantity.fill('0');
  await expect(page.locator('#checkoutQuantity-error')).toContainText('Enter a valid value.');
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  await quantity.fill('3');
  await startNativeCheckout(page);
  const pay = page.getByRole('button', { name: /^Pay/ });
  await expect(pay).toBeEnabled({ timeout: 30000 });
  const before = await pay.textContent();
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/create-payment-intent') requests.push(request.url()); });
  await quantity.fill('abc');
  await expect(pay).toBeDisabled();
  await expect(pay).toHaveText(before!);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
test('invalid profile fields are marked, described and focused', async ({ page }) => {
  expect((await db.from('products').update({ checkout_profile: profile }).eq('id', product.id)).error).toBeNull();
  await open(page, 2);
  await page.getByLabel('Typ nabywcy').selectOption('organization');
  await party(page, 'buyer');
  await page.locator('[id="buyer.nip"]').fill('123');
  await page.locator('#phone').fill('abc');
  for (let i = 0; i < 2; i++) {
    for (const [key, value] of Object.entries({ first_name: 'Jan', last_name: 'Nowak', email: 'same@example.com' })) {
      await page.locator(`[id="participants.${i}.${key}"]`).fill(value);
    }
  }
  const terms = page.getByRole('checkbox', { name: /Zgadzam|Akceptuję/ });
  if (await terms.count()) await terms.check();
  await expect(page.getByRole('button', { name: /^Zapłać/ })).toBeEnabled({ timeout: 30000 });
  const scan = async () => {
    await page.mouse.move(0, 0);
    await expect.poll(() => page.getByRole('button', { name: /^Zapłać/ }).evaluate(button => getComputedStyle(button).opacity)).toBe('1');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('iframe').exclude('altcha-widget').analyze();
    return results.violations.flatMap(violation => violation.nodes.map(node => ({ id: violation.id, target: node.target })));
  };
  const baseline = await scan();
  expect(baseline).toEqual([]);
  expect((await submit(page)).status()).toBe(422);
  for (const id of ['buyer.nip', 'phone', 'participants.1.email']) {
    const input = page.locator(`[id="${id}"]`);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveClass(/border-sf-danger/);
    await expect(page.locator(`[id="${id}-error"]`)).toBeVisible();
  }
  await expect(page.locator('[id="participants.0.email"]')).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('[id="buyer.nip"]')).toBeFocused();
  expect(await scan()).toEqual(baseline);
});
test('required profile fields receive inline errors and first-field focus', async ({ page }) => {
  expect((await db.from('products').update({ checkout_profile: profile }).eq('id', product.id)).error).toBeNull();
  await open(page);
  expect((await submit(page)).status()).toBe(422);
  for (const id of ['buyer.first_name', 'buyer.last_name', 'phone', 'participants.0.first_name', 'participants.0.last_name']) {
    await expect(page.locator(`[id="${id}"]`)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator(`[id="${id}-error"]`)).toBeVisible();
  }
  await expect(page.locator('[id="buyer.first_name"]')).toBeFocused();
});
test('shared profile displays online and transfer validation errors', async ({ page }) => {
  const saved = await db.from('bank_transfer_config').select('*').single();
  expect(saved.error).toBeNull();
  try {
    expect((await db.from('bank_transfer_config').update({ bank_transfer_enabled: true, bank_account_holder: 'Test', bank_account_number: 'PL61109010140000071219812874' }).eq('id', true)).error).toBeNull();
    const shared = { v: 1, modules: [{ id: 'buyer', types: ['person', 'organization'], gus: false, bank_transfer_for: ['person', 'organization'] }, { id: 'phone', required: true }] };
    expect((await db.from('products').update({ checkout_profile: shared }).eq('id', product.id)).error).toBeNull();
    await open(page);
    expect((await submit(page)).status()).toBe(422);
    await expect(page.locator('[id="buyer.first_name"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[id="buyer.first_name"]')).toBeFocused();
    await page.getByRole('radio', { name: /Przelew tradycyjny/ }).check();
    await page.getByRole('checkbox', { name: /Zgadzam|Akceptuję/ }).check();
    const button = page.getByRole('button', { name: 'Zamawiam z obowiązkiem zapłaty' });
    await expect(button).toBeEnabled({ timeout: 30000 });
    await button.click();
    await expect(page.locator('#phone-error')).toBeVisible();
    await expect(page.locator('[id="buyer.first_name"]')).toBeFocused();
  } finally {
    expect((await db.from('bank_transfer_config').upsert(saved.data!)).error).toBeNull();
    expect((await db.from('products').update({ checkout_profile: profile }).eq('id', product.id)).error).toBeNull();
  }
});
test('organization, recipient, phone and five participants save against five units', async ({ page }) => {
  const session = await open(page, 5);
  await page.getByLabel('Typ nabywcy').selectOption('organization');
  await party(page, 'buyer');
  await page.getByLabel('Inny odbiorca').check();
  await party(page, 'recipient');
  await page.locator('[id="phone"]').fill('500100200');
  for (let i = 0; i < 5; i++) {
    for (const [key, value] of Object.entries({ first_name: 'Jan', last_name: 'Nowak', email: `person${i}@example.com` })) {
      await page.locator(`[id="participants.${i}.${key}"]`).fill(value);
    }
  }
  expect((await submit(page)).status()).toBe(200);
  const { data: tx } = await db.from('payment_transactions').select('id,amount,order_details').eq('session_id', session).single();
  expect(tx).toMatchObject({ amount: 50000, order_details: { buyer: { type: 'organization', nip: '5260250274' }, recipient: { differs: true }, phone: { value: '+48500100200' }, quantity: { value: 5 } } });
  expect(tx!.order_details.participants.people).toHaveLength(5);
  await page.screenshot({ path: '/private/tmp/sellf-w9/profile-b2b.png', fullPage: true });
});
test('person omits company and recipient and prefills one editable participant', async ({ page }) => {
  await open(page);
  await expect(page.locator('[id="buyer.company_name"]')).toHaveCount(0);
  await expect(page.getByLabel('Inny odbiorca')).toHaveCount(0);
  await page.locator('[id="buyer.first_name"]').fill('Anna');
  await page.locator('[id="buyer.last_name"]').fill('Nowak');
  await expect(page.locator('[id="participants.0.first_name"]')).toHaveValue('Anna');
  await expect(page.locator('[id="participants.0.email"]')).toHaveValue('buyer@example.com');
  await page.locator('[id="participants.0.first_name"]').fill('Ewa');
  await page.locator('[id="buyer.first_name"]').fill('Maria');
  await expect(page.locator('[id="participants.0.first_name"]')).toHaveValue('Ewa');
});
test('missing recipient tax number renders a field error and stops confirmation', async ({ page }) => {
  await open(page);
  await page.getByLabel('Typ nabywcy').selectOption('organization');
  await party(page, 'buyer');
  await page.getByLabel('Inny odbiorca').check();
  await party(page, 'recipient', true);
  await page.locator('[id="phone"]').fill('500100200');
  expect((await submit(page)).status()).toBe(422);
  await expect(page.locator('[id="recipient.nip-error"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/pl/checkout/${product.slug}$`));
});
test('hidden quantity has no control and uses the configured minimum', async ({ page }) => {
  const hidden = { v: 1, modules: [{ id: 'quantity', min: 2, max: 5, mode: 'hidden' }] };
  expect((await db.from('products').update({ checkout_profile: hidden }).eq('id', product.id)).error).toBeNull();
  const session = await open(page);
  await expect(page.getByLabel('Ilość', { exact: true })).toHaveCount(0);
  const { data: tx } = await db.from('payment_transactions').select('amount').eq('session_id', session).single();
  expect(tx!.amount).toBe(20000);
});
test('product-page quantity immediately updates totals and replaces the initialized session', async ({ page }) => {
  expect((await db.from('products').update({ checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 1, max: 5, mode: 'product_page' }] } }).eq('id', product.id)).error).toBeNull();
  const oldSession = await open(page);
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/create-payment-intent' && response.request().postDataJSON()?.quantity === 3);
  await page.getByLabel('Ilość', { exact: true }).fill('3');
  expect((await response).status()).toBe(200);
  const newSession = (await (await response).json()).checkoutSessionId;
  expect(newSession).not.toBe(oldSession);
  const { data: tx } = await db.from('payment_transactions').select('amount').eq('session_id', newSession).single();
  expect(tx!.amount).toBe(30000);
  await expect(page.getByRole('button', { name: /^Zapłać/ })).toContainText('300');
});
test('product without profile retains the original form', async ({ page }) => {
  expect((await db.from('products').update({ checkout_profile: null }).eq('id', product.id)).error).toBeNull();
  await open(page);
  await expect(page.locator('#fullName')).toBeVisible();
  await expect(page.locator('#nip')).toBeVisible();
  await expect(page.getByLabel('Typ nabywcy')).toHaveCount(0);
  await expect(page.getByLabel('Ilość', { exact: true })).toHaveCount(0);
});
