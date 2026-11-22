/**
 * The standard checkout's invoice section. Every buyer type
 * goes from the browser to the order (order_details + Stripe metadata); one real card payment on the
 * Stripe sandbox proves the recipient reaches the signed purchase.completed delivery.
 * GUS answers are mocked in the browser (the register itself is never called).
 *
 * @see src/components/checkout/InvoiceSection.tsx
 * @see src/lib/checkout/invoice-section.ts
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import type { Page } from '@playwright/test';
import { readBuyerPayload } from '@/lib/webhooks/buyer-payload-storage';
import { test, startNativeCheckout, clickNativeCheckoutPay } from './helpers/checkout-intent';
import { acceptAllCookies } from './helpers/consent';

test.describe.configure({ mode: 'serial' });
test.use({ trace: 'retain-on-failure', screenshot: 'only-on-failure' });

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const SHOTS = process.env.INVOICE_SECTION_SHOTS_DIR || path.resolve('test-results/invoice-section');
const GUS: Record<string, Record<string, string>> = {
  '1181697228': { nazwa: 'Gmina Przykładowo', ulica: 'ul. Wzorcowa', nrNieruchomosci: '12', nrLokalu: '4', miejscowosc: 'Warszawa', kodPocztowy: '00-001', regon: '1', nip: '1181697228' },
  '5260250995': { nazwa: 'Szkoła Podstawowa nr 1 w Przykładowie', ulica: 'ul. Szkolna', nrNieruchomosci: '1', nrLokalu: '', miejscowosc: 'Przykładowo', kodPocztowy: '11-111', regon: '2', nip: '5260250995' },
};
let product: { id: string; slug: string };
let settingsBefore: Record<string, unknown> = {};
const openedSessions: string[] = [];

async function setRecipientSetting(enabled: boolean) {
  const { data } = await db.from('shop_config').select('id, custom_settings').single();
  const { error } = await db.from('shop_config').update({ custom_settings: { ...(data!.custom_settings as object), invoice_recipient_enabled: enabled } }).eq('id', data!.id);
  expect(error).toBeNull();
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.getByTestId('invoice-section').screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function openCheckout(page: Page, { confirm = false } = {}): Promise<string> {
  if (!confirm) await page.route('https://api.stripe.com/**/confirm', route => route.abort());
  await page.route('**/api/gus/fetch-company-data', async route => {
    const { nip } = route.request().postDataJSON() as { nip: string };
    const data = GUS[nip];
    await route.fulfill({ status: data ? 200 : 404, json: data ? { success: true, data } : { success: false, code: 'NOT_FOUND' } });
  });
  await acceptAllCookies(page);
  await page.goto(`/pl/checkout/${product.slug}`);
  const { checkoutSessionId } = await (await startNativeCheckout(page)).json();
  openedSessions.push(checkoutSessionId);
  await page.locator('#checkoutEmail').fill(`invoice-${randomUUID().slice(0, 8)}@example.com`);
  await page.locator('#fullName').fill('Anna Kowalska');
  return checkoutSessionId;
}

async function submit(page: Page): Promise<number> {
  for (const box of await page.locator('input[type="checkbox"]:not(#wantInvoice):not(#wantRecipient)').all()) if (await box.isVisible()) await box.check();
  const saved = page.waitForResponse('**/api/update-payment-metadata');
  await clickNativeCheckoutPay(page);
  return (await saved).status();
}

async function order(sessionId: string) {
  const { data } = await db.from('payment_transactions').select('order_details, status').eq('session_id', sessionId).single();
  return data as { order_details: Record<string, any>; status: string };
}

async function fillAddress(page: Page, prefix: '' | 'recipient', values: { name: string; street: string; zip: string; city: string }) {
  const id = (key: string) => prefix ? `#recipient${key[0].toUpperCase()}${key.slice(1)}` : `#${key}`;
  await page.locator(id('companyName')).fill(values.name);
  await page.locator(id('address')).fill(values.street);
  await page.locator(id('postalCode')).fill(values.zip);
  await page.locator(id('city')).fill(values.city);
}

test.beforeAll(async () => {
  const { data, error } = await db.from('products').insert({
    name: 'Szkolenie z automatyzacji', slug: `invoice-section-${randomUUID()}`, price: 149, currency: 'PLN',
    is_active: true, vat_rate: 23, price_includes_vat: true,
  }).select('id,slug').single();
  expect(error).toBeNull();
  product = data!;
  settingsBefore = ((await db.from('shop_config').select('custom_settings').single()).data?.custom_settings ?? {}) as Record<string, unknown>;
  await setRecipientSetting(false);
});

test.afterAll(async () => {
  for (const id of openedSessions) {
    const session = await stripe.checkout.sessions.retrieve(id).catch(() => null);
    if (session?.status === 'open') await stripe.checkout.sessions.expire(id).catch(() => undefined);
  }
  await db.from('shop_config').update({ custom_settings: settingsBefore }).not('id', 'is', null);
  if (!product) return;
  await db.from('payment_transactions').delete().eq('product_id', product.id);
  await db.from('products').delete().eq('id', product.id);
});

test('a person buys without a company invoice: no company data on the order or in Stripe @J620', async ({ page }) => {
  const sessionId = await openCheckout(page);
  await expect(page.locator('#wantInvoice')).not.toBeChecked();
  await expect(page.locator('#nip')).toHaveCount(0);
  await shot(page, '01-person');
  expect(await submit(page)).toBe(200);
  expect((await order(sessionId)).order_details.buyer).toMatchObject({ type: 'person', needs_invoice: false, nip: '', company_name: '', full_name: 'Anna Kowalska' });
  // Stripe drops metadata keys set to an empty string.
  const metadata = (await stripe.checkout.sessions.retrieve(sessionId)).metadata ?? {};
  expect(metadata.needs_invoice).toBe('false');
  expect(metadata.nip ?? '').toBe('');
  expect(metadata.company_name ?? '').toBe('');
});

test('a Polish company: GUS fills the company card, the country is locked to Poland @J620 @J125', async ({ page }) => {
  const sessionId = await openCheckout(page);
  await page.locator('#wantInvoice').check();
  await page.locator('#nip').fill('118-169-72-28');
  const card = page.getByTestId('buyer-company-card');
  await expect(card).toContainText('Gmina Przykładowo');
  await expect(card).toContainText('ul. Wzorcowa 12/4, 00-001 Warszawa');
  await shot(page, '02-pl-gus-card');
  await page.getByRole('button', { name: 'Popraw dane' }).click();
  await expect(page.locator('#country')).toHaveValue('Polska');
  await expect(page.locator('#country')).toHaveAttribute('readonly', '');
  await expect(page.locator('#companyName')).toHaveValue('Gmina Przykładowo');
  await shot(page, '03-pl-gus-edit');
  expect(await submit(page)).toBe(200);
  expect((await order(sessionId)).order_details.buyer).toMatchObject({
    type: 'organization', needs_invoice: true, nip: '1181697228', company_name: 'Gmina Przykładowo',
    address: 'ul. Wzorcowa 12/4', postal_code: '00-001', city: 'Warszawa', country: 'PL',
  });
  expect((await stripe.checkout.sessions.retrieve(sessionId)).metadata).toMatchObject({ needs_invoice: 'true', nip: '1181697228', company_name: 'Gmina Przykładowo', country: 'PL' });
});

test('an EU company: the VAT prefix locks the country, the address is entered by hand @J620', async ({ page }) => {
  const sessionId = await openCheckout(page);
  await page.locator('#wantInvoice').check();
  await page.locator('#nip').fill('DE123456789');
  await expect(page.getByText('Firma z UE. Danych z tego kraju nie pobieramy automatycznie')).toBeVisible();
  await expect(page.locator('#country')).toHaveValue('Niemcy');
  await fillAddress(page, '', { name: 'Muster GmbH', street: 'Hauptstraße 1', zip: '10115', city: 'Berlin' });
  await shot(page, '04-eu-vat');
  expect(await submit(page)).toBe(200);
  expect((await order(sessionId)).order_details.buyer).toMatchObject({ needs_invoice: true, nip: 'DE123456789', country: 'DE', company_name: 'Muster GmbH', city: 'Berlin' });
});

test('a company outside the EU is entered by hand with an optional tax number @J620', async ({ page }) => {
  const sessionId = await openCheckout(page);
  await page.locator('#wantInvoice').check();
  await page.getByRole('button', { name: 'Nie mam NIP albo firma jest spoza UE' }).click();
  await page.locator('#country').selectOption('US');
  await fillAddress(page, '', { name: 'Acme Inc.', street: '1 Main St', zip: '10001', city: 'New York' });
  await page.locator('#taxIdManual').fill('EIN 12-3456789');
  await shot(page, '05-outside-eu-manual');
  expect(await submit(page)).toBe(200);
  expect((await order(sessionId)).order_details.buyer).toMatchObject({ needs_invoice: true, nip: 'EIN 12-3456789', country: 'US', company_name: 'Acme Inc.' });
});

test('an organization without a NIP still gets a company invoice @J620', async ({ page }) => {
  const sessionId = await openCheckout(page);
  await page.locator('#wantInvoice').check();
  await page.getByRole('button', { name: 'Nie mam NIP albo firma jest spoza UE' }).click();
  await expect(page.locator('#taxIdManual')).toHaveCount(0);
  await fillAddress(page, '', { name: 'Fundacja Przykładowa', street: 'ul. Prosta 1', zip: '30-001', city: 'Kraków' });
  expect(await submit(page)).toBe(200);
  expect((await order(sessionId)).order_details.buyer).toMatchObject({ type: 'organization', needs_invoice: true, nip: '', country: 'PL', company_name: 'Fundacja Przykładowa' });
  const metadata = (await stripe.checkout.sessions.retrieve(sessionId)).metadata ?? {};
  expect(metadata).toMatchObject({ needs_invoice: 'true', company_name: 'Fundacja Przykładowa' });
  expect(metadata.nip ?? '').toBe('');
});

test('a wrong NIP and missing data stop the payment before anything is saved @J620', async ({ page }) => {
  await openCheckout(page);
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/update-payment-metadata')) requests.push(request.url()); });
  await page.locator('#wantInvoice').check();
  await page.locator('#nip').fill('1234567890');
  await page.locator('#nip').blur();
  await expect(page.getByText('Ten NIP ma błąd w cyfrach')).toBeVisible();
  for (const box of await page.locator('input[type="checkbox"]:not(#wantInvoice)').all()) if (await box.isVisible()) await box.check();
  await clickNativeCheckoutPay(page);
  await expect(page.getByText('Popraw dane do faktury.')).toBeVisible();
  await shot(page, '06-validation');
  expect(requests).toEqual([]);
});

test('with the shop setting off there is no recipient option @J621', async ({ page }) => {
  await openCheckout(page);
  await page.locator('#wantInvoice').check();
  await expect(page.locator('#nip')).toBeVisible();
  await expect(page.locator('#wantRecipient')).toHaveCount(0);
});

test('with the shop setting on, a paid order carries the recipient to the order and the signed webhook @J621', async ({ page }) => {
  test.setTimeout(240000);
  expect(process.env.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  await setRecipientSetting(true);
  // The delivery is persisted before any HTTP attempt; the .invalid host is never reachable.
  const endpoint = await db.from('webhook_endpoints').insert({ url: 'https://invoice-section-receiver.invalid/hook', secret: 'whsec_invoice_section', events: ['purchase.completed'], is_active: true }).select('id').single();
  expect(endpoint.error).toBeNull();
  let sessionId: string | undefined;
  try {
    sessionId = await openCheckout(page, { confirm: true });
    await page.locator('#wantInvoice').check();
    await page.locator('#nip').fill('1181697228');
    await expect(page.getByTestId('buyer-company-card')).toContainText('Gmina Przykładowo');
    await page.locator('#wantRecipient').check();
    await page.locator('#recipientNip').fill('5260250995');
    await expect(page.getByTestId('recipient-company-card')).toContainText('Szkoła Podstawowa nr 1 w Przykładowie');
    await shot(page, '07-recipient');
    const frame = page.frameLocator('iframe[src*="elements-inner-payment"]');
    await frame.locator('input[name=number]').fill('4242424242424242');
    await frame.locator('input[name=expiry]').fill('12 / 34');
    await frame.locator('input[name=cvc]').fill('123');
    const country = frame.locator('select[name=country]');
    if (await country.count()) await country.selectOption('PL');
    expect(await submit(page)).toBe(200);
    await expect.poll(async () => (await order(sessionId!)).status, { timeout: 120000 }).toBe('completed');
    const expectedRecipient = {
      v: 1, differs: true, company_name: 'Szkoła Podstawowa nr 1 w Przykładowie', nip: '5260250995', address: 'ul. Szkolna 1',
      postal_code: '11-111', city: 'Przykładowo', country: 'PL', tax_id_type: 'pl_nip', tax_id_country: 'PL',
    };
    expect((await order(sessionId)).order_details.recipient).toEqual(expectedRecipient);
    await expect.poll(async () => (await db.from('webhook_logs').select('id').eq('endpoint_id', endpoint.data!.id).eq('event_type', 'purchase.completed')).data?.length ?? 0, { timeout: 60000 }).toBe(1);
    const { data: logs } = await db.from('webhook_logs').select('payload').eq('endpoint_id', endpoint.data!.id).single();
    const payload = await readBuyerPayload(logs!.payload) as { data: { invoice: Record<string, unknown> } };
    expect(payload.data.invoice).toMatchObject({
      needsInvoice: true, nip: '1181697228', taxIdType: 'pl_nip', companyName: 'Gmina Przykładowo',
      address: 'ul. Wzorcowa 12/4', postalCode: '00-001', city: 'Warszawa', country: 'PL', recipient: expectedRecipient,
    });
  } finally {
    await setRecipientSetting(false);
    await db.from('webhook_logs').delete().eq('endpoint_id', endpoint.data!.id);
    await db.from('webhook_endpoints').delete().eq('id', endpoint.data!.id);
    if (sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.status === 'open') await stripe.checkout.sessions.expire(sessionId).catch(() => undefined);
    }
  }
});
