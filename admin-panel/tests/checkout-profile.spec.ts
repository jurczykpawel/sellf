/** Checkout profile collection and pre-payment validation. @see lib/checkout-modules/registry.ts */
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { test, startNativeCheckout } from './helpers/checkout-intent';

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
  if (quantity !== 1) await page.getByLabel('Ilość', { exact: true }).fill(String(quantity));
  await expect.poll(async () => await page.getByRole('button', { name: 'Przejdź do płatności', exact: true }).isVisible()
    || await page.locator('[data-test-email]').isVisible()
    || await page.locator('input[name=payment-method][value=online]').isVisible(), { timeout: 30000 }).toBe(true);
  const buyerEmail = page.locator('[id="buyer.email"]');
  if (await buyerEmail.count()) await buyerEmail.fill('buyer@example.com');
  const fields = page.locator('input[id^="buyer."], input[id^="participants."], #phone');
  const fieldIds = await fields.evaluateAll(inputs => inputs.map(input => input.id));
  for (const id of fieldIds) {
    const input = page.locator(`[id="${id}"]`);
    if (id === 'buyer.email' || quantity === 1 && id.startsWith('participants.') && await page.locator('[id="buyer.first_name"]').count()) continue;
    await input.fill(id === 'phone' ? '500100200' : id.endsWith('.email') ? `${id.split('.')[1]}@example.com` : 'Jan');
  }
  const response = await startNativeCheckout(page);
  const paymentEmail = page.locator('#checkoutEmail');
  if (await paymentEmail.count()) await paymentEmail.fill('buyer@example.com');
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
  await button.click();
}
for (const mode of ['checkout', 'product_page']) {
  for (const value of ['0', '-1', '', 'abc', '1.5', '6']) {
    test(`${mode} quantity ${JSON.stringify(value)} hides the total until quantity is valid`, async ({ page }) => {
      expect((await db.from('products').update({ checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 1, max: 5, mode }] } }).eq('id', product.id)).error).toBeNull();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await acceptAllCookies(page);
      await page.goto(`/pl/checkout/${product.slug}`);
      await expect(page.getByRole('button', { name: 'Przejdź do płatności' })).toHaveCount(0);
      const quantity = page.getByLabel('Ilość', { exact: true });
      await quantity.fill('3');
      const summary = page.locator('[data-testid="order-summary-total"]');
      await expect(summary).toContainText('300,00');
      await quantity.fill(value);
      await expect(quantity).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#checkoutQuantity-error')).toHaveText('Wpisz poprawną wartość. (1–5)');
      await expect(page.getByRole('button', { name: 'Przejdź do płatności' })).toHaveCount(0);
      await expect(summary).toHaveText('—');
      expect(errors).toEqual([]);
      await quantity.fill('2');
      await expect(summary).toContainText('200,00');
      await expect(quantity).toHaveAttribute('aria-invalid', 'false');
      await expect(page.getByRole('button', { name: 'Przejdź do płatności' })).toHaveCount(0);
    });
  }
}
test('product route validates quantity and initialized checkout keeps its last valid session', async ({ page }) => {
  expect((await db.from('products').update({ is_listed: true, checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 1, max: 5, mode: 'product_page' }] } }).eq('id', product.id)).error).toBeNull();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await acceptAllCookies(page);
  await page.goto(`/p/${product.slug}`);
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toHaveCount(0);
  const quantity = page.getByLabel('Quantity', { exact: true });
  await quantity.fill('0');
  await expect(page.locator('#checkoutQuantity-error')).toContainText('Enter a valid value.');
  await expect(page.getByRole('button', { name: 'Continue to payment' })).toHaveCount(0);
  await quantity.fill('3');
  await startNativeCheckout(page);
  await page.locator('#checkoutEmail').fill('buyer@example.com');
  const pay = page.getByRole('button', { name: /^Pay/ });
  await expect(pay).toBeEnabled({ timeout: 30000 });
  const before = await pay.textContent();
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/create-payment-intent' && !request.postDataJSON()?.expireOnly) requests.push(request.url()); });
  await quantity.fill('abc');
  await expect(pay).toBeDisabled();
  await expect(pay).toHaveText(before!);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`long B2B profile focuses the first displayed error on every attempt at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    expect((await db.from('products').update({ checkout_profile: profile }).eq('id', product.id)).error).toBeNull();
    await acceptAllCookies(page);
    await page.goto(`/pl/checkout/${product.slug}`);
    await startNativeCheckout(page);
    await page.locator('#checkoutEmail').fill('buyer@example.com');
    const start = page.getByRole('button', { name: /^Zapłać/ });
    const terms = page.getByRole('checkbox', { name: /Zgadzam|Akceptuję/ });
    await expect(start).toBeEnabled({ timeout: 30000 });
    await page.getByLabel('Ilość', { exact: true }).fill('5');
    await page.getByLabel('Typ nabywcy').selectOption('organization');
    await party(page, 'buyer');
    await page.locator('[id="buyer.first_name"]').fill('Jan');
    await page.locator('[id="buyer.last_name"]').fill('Nowak');
    await page.locator('[id="buyer.nip"]').fill('123');
    await page.locator('#phone').fill('500100200');
    for (let i = 0; i < 5; i++) {
      for (const [key, value] of Object.entries({ first_name: 'Jan', last_name: 'Nowak', email: `person${i}@example.com` })) {
        await page.locator(`[id="participants.${i}.${key}"]`).fill(value);
      }
    }
    await expect(start).toBeEnabled({ timeout: 30000 });
    if (await terms.count()) await terms.check();
    const nip = page.locator('[id="buyer.nip"]');
    for (let attempt = 0; attempt < 2; attempt++) {
      await start.scrollIntoViewIfNeeded();
      await expect(nip).not.toBeInViewport();
      await start.click();
      await expect(nip).toBeFocused();
      await expect(nip).toBeInViewport({ ratio: 1 });
    }
    // Organization validation lists company fields before optional buyer names.
    await page.locator('[id="buyer.first_name"]').fill('J'.repeat(101));
    await start.click();
    await expect(page.locator('[id="buyer.first_name"]')).toBeFocused();
    await expect(page.locator('[id="buyer.first_name"]')).toBeInViewport({ ratio: 1 });
    await expect(start).toBeEnabled();
  });
}
test('invalid profile fields are marked, described and focused', async ({ page }) => {
  expect((await db.from('products').update({ checkout_profile: profile }).eq('id', product.id)).error).toBeNull();
  await open(page, 2);
  await page.getByLabel('Typ nabywcy').selectOption('organization');
  await party(page, 'buyer');
  await page.locator('[id="buyer.nip"]').fill('123');
  await page.locator('#phone').fill('+48 12');
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
  await submit(page);
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
  for (const id of ['buyer.first_name', 'buyer.last_name', 'phone', 'participants.0.first_name', 'participants.0.last_name']) await page.locator(`[id="${id}"]`).fill('');
  await submit(page);
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
    const requests: string[] = [];
    page.on('request', request => {
      if (['/api/create-payment-intent', '/api/orders/bank-transfer'].includes(new URL(request.url()).pathname) && !request.postDataJSON()?.expireOnly) requests.push(request.url());
    });
    await acceptAllCookies(page);
    await page.goto(`/pl/checkout/${product.slug}`);
    await expect(page.getByRole('radio', { name: /Przelew tradycyjny/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Przejdź do płatności', exact: true })).toHaveCount(0);
    expect(requests).toEqual([]);
    await page.locator('input[name=payment-method][value=online]').check();
    await startNativeCheckout(page);
    await page.locator('#checkoutEmail').fill('buyer@example.com');
    await submit(page);
    await expect(page.locator('[id="buyer.first_name"]')).toBeFocused();
    await expect(page.locator('#phone-error')).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]).pathname).toBe('/api/create-payment-intent');
    await open(page);
    requests.length = 0;
    await page.locator('[id="buyer.first_name"]').fill('');
    await page.locator('#phone').fill('');
    await submit(page);
    await expect(page.locator('[id="buyer.first_name"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[id="buyer.first_name"]')).toBeFocused();
    await page.locator('[id="buyer.first_name"]').fill('Jan');
    await page.getByRole('radio', { name: /Przelew tradycyjny/ }).check();
    const transferTerms = page.getByRole('checkbox', { name: /Zgadzam|Akceptuję/ });
    if (await transferTerms.count()) await transferTerms.check();
    const button = page.getByRole('button', { name: 'Zamawiam z obowiązkiem zapłaty' });
    await expect(button).toBeEnabled({ timeout: 30000 });
    await button.click();
    await expect(page.locator('#phone-error')).toBeVisible();
    await expect(page.locator('[id="buyer.first_name"]')).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#phone')).toBeFocused();
    await page.locator('[id="buyer.first_name"]').fill('');
    await button.click();
    await expect(page.locator('[id="buyer.first_name"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[id="buyer.first_name"]')).toBeFocused();
    expect(requests).toEqual([]);
  } finally {
    expect((await db.from('bank_transfer_config').upsert(saved.data!)).error).toBeNull();
    expect((await db.from('products').update({ checkout_profile: profile }).eq('id', product.id)).error).toBeNull();
  }
});
test('phone: a number without a country code is explained, a 00 prefix is stored as +', async ({ page }) => {
  expect((await db.from('products').update({ checkout_profile: { v: 1, modules: [{ id: 'phone', required: true }] } }).eq('id', product.id)).error).toBeNull();
  try {
    await acceptAllCookies(page);
    await page.goto(`/pl/checkout/${product.slug}`);
    const response = await startNativeCheckout(page);
    await page.locator('#checkoutEmail').fill('buyer@example.com');
    const start = page.getByRole('button', { name: /^Zapłać/ });
    const terms = page.getByRole('checkbox', { name: /Zgadzam|Akceptuję/ });
    if (await terms.count()) await terms.check();
    await expect(start).toBeEnabled({ timeout: 30000 });
    await page.locator('#phone').fill('1234567');
    await start.click();
    await expect(page.locator('#phone-error')).toContainText('Zacznij numer od kierunkowego kraju');
    await page.locator('#phone').fill('+48 12');
    await start.click();
    await expect(page.locator('#phone-error')).toContainText('za krótki');
    await page.locator('#phone').fill('00 48 500 600 700');
    const session = (await response.json()).checkoutSessionId as string;
    const paymentEmail = page.locator('#checkoutEmail');
    if (await paymentEmail.count()) await paymentEmail.fill('buyer@example.com');
    await page.route('https://api.stripe.com/**/confirm', route => route.abort());
    const updated = page.waitForResponse('**/api/update-payment-metadata');
    await submit(page);
    expect((await updated).status()).toBe(200);
    await expect(page.locator('#phone-error')).toHaveCount(0);
    const { data: tx } = await db.from('payment_transactions').select('order_details').eq('session_id', session).single();
    expect(tx!.order_details.phone.value).toBe('+48500600700');
  } finally {
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
  const updated = page.waitForResponse('**/api/update-payment-metadata');
  await submit(page);
  expect((await updated).status()).toBe(200);
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
  await submit(page);
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


for (const [country, nip, stored, type] of [['DE', 'DE123456789', 'DE123456789', 'eu_vat'], ['DE', '123 456 789', 'DE123456789', 'eu_vat'], ['US', 'EIN 12-3456789', 'EIN 12-3456789', 'other'], ['US', '', '', undefined]] as const) {
  test(`organization in ${country} saves its tax number "${nip}" with country and type @J220`, async ({ page }) => {
    expect((await db.from('products').update({ checkout_profile: profile }).eq('id', product.id)).error).toBeNull();
    const session = await open(page);
    await page.getByLabel('Typ nabywcy').selectOption('organization');
    await party(page, 'buyer');
    await expect(page.locator('label[for="buyer.nip"]')).toHaveText('NIP / numer VAT');
    await page.locator('[id="buyer.country"]').selectOption(country);
    await page.locator('[id="buyer.nip"]').fill(nip);
    await page.getByLabel('Inny odbiorca').check();
    await party(page, 'recipient');
    await page.locator('[id="recipient.country"]').selectOption(country);
    await page.locator('[id="recipient.nip"]').fill(nip);
    const updated = page.waitForResponse('**/api/update-payment-metadata');
    await submit(page);
    expect((await updated).status()).toBe(200);
    const { data: tx, error } = await db.from('payment_transactions').select('order_details').eq('session_id', session).single();
    expect(error).toBeNull();
    const taxId = type ? { tax_id_type: type, tax_id_country: country } : {};
    expect(tx!.order_details).toMatchObject({ buyer: { country, nip: stored, ...taxId }, recipient: { country, nip: stored, ...taxId } });
    if (!type) expect(tx!.order_details).not.toHaveProperty('buyer.tax_id_type');
  });
}

test('EU tax number error explains the format of the selected country', async ({ page }) => {
  expect((await db.from('products').update({ checkout_profile: profile }).eq('id', product.id)).error).toBeNull();
  await open(page);
  await page.getByLabel('Typ nabywcy').selectOption('organization');
  await party(page, 'buyer');
  await page.locator('[id="buyer.country"]').selectOption('DE');
  await page.locator('[id="buyer.nip"]').fill('FRAB123456789');
  await submit(page);
  await expect(page.locator('[id="buyer.nip-error"]')).toContainText('w formacie wybranego kraju');
  await expect(page.locator('[id="buyer.nip"]')).toBeFocused();
});

test('phone has one visible label and an accessible input in both languages', async ({ page }) => {
  expect((await db.from('products').update({ checkout_profile: { v: 1, modules: [{ id: 'phone', required: true }] } }).eq('id', product.id)).error).toBeNull();
  await acceptAllCookies(page);
  for (const [locale, label] of [['pl', 'Telefon'], ['en', 'Phone']]) {
    await page.goto(`/${locale}/checkout/${product.slug}`);
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    await expect(page.getByText(label, { exact: true })).toHaveCount(1);
    await page.getByLabel(label, { exact: true }).fill('500100200');
  }
});
