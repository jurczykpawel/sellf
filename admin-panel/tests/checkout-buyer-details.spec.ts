/** Buyer details must be persisted before confirming payment.
 * @see src/app/api/update-payment-metadata/route.ts
 * @see tests/helpers/database-container.ts
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { startNativeCheckout } from './helpers/checkout-intent';
import { getTestDatabaseContainer } from './helpers/database-container';
import { acceptAllCookies } from './helpers/consent';

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const NIP = '5260250274';
test.use({ trace: 'retain-on-failure', screenshot: 'only-on-failure' });
let product: { id: string; slug: string };
let container: string;

function readBuyer(sessionId: string): Record<string, unknown> | null {
  expect(sessionId).toMatch(/^cs_test_[a-zA-Z0-9]+$/);
  const raw = execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-tA', '-v', 'ON_ERROR_STOP=1', '-v', `session_id=${sessionId}`], {
    input: "SELECT order_details->'buyer' FROM public.payment_transactions WHERE session_id = :'session_id';",
    encoding: 'utf8',
  }).trim();
  return raw ? JSON.parse(raw) : null;
}

async function fillBuyer(page: Page): Promise<string> {
  await page.route('**/api/gus/fetch-company-data', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      nazwa: 'Pracownia Cyfrowa Sp. z o.o.', ulica: 'ul. Prosta', nrNieruchomosci: '20',
      miejscowosc: 'Warszawa', kodPocztowy: '00-850', nip: NIP,
    } }),
  }));
  await acceptAllCookies(page);
  await page.goto(`/pl/checkout/${product.slug}`);
  const response = await startNativeCheckout(page);
  const { checkoutSessionId } = await response.json();
  await page.locator('#checkoutEmail').fill('buyer@example.com');
  await page.locator('#fullName').fill('Anna Kowalska');
  await page.locator('#nip').fill(NIP);
  await page.locator('#nip').blur();
  await expect(page.locator('#companyName')).toHaveValue('Pracownia Cyfrowa Sp. z o.o.');
  await expect(page.locator('#address')).toHaveValue('ul. Prosta 20');
  const terms = page.locator('input[type="checkbox"]');
  for (const checkbox of await terms.all()) if (await checkbox.isVisible()) await checkbox.check();
  await expect(page.getByRole('button', { name: /^Zapłać/ })).toBeEnabled({ timeout: 30000 });
  return checkoutSessionId;
}

test.beforeAll(async () => {
  container = getTestDatabaseContainer();
  expect(container).toBe(process.env.SUPABASE_DB_CONTAINER);
  const { data, error } = await admin.from('products').insert({
    name: 'Warsztat projektowania produktów cyfrowych', slug: `buyer-details-${randomUUID()}`,
    price: 100, currency: 'PLN', is_active: true, vat_rate: 23, price_includes_vat: true,
  }).select('id,slug').single();
  expect(error).toBeNull();
  product = data!;
});

test.afterAll(async () => {
  if (!product) return;
  await admin.from('payment_transactions').delete().eq('product_id', product.id);
  await admin.from('products').delete().eq('id', product.id);
});

test('stores the invoice NIP on this session before Stripe confirmation', async ({ page }) => {
  // Stop any payment request; this test ends at the pre-confirmation boundary.
  await page.route('https://api.stripe.com/**/confirm', route => route.abort());
  const sessionId = await fillBuyer(page);
  const saved = page.waitForResponse('**/api/update-payment-metadata');
  await page.getByRole('button', { name: /^Zapłać/ }).click();
  expect((await saved).status()).toBe(200);
  await expect.poll(() => readBuyer(sessionId)).toMatchObject({ nip: NIP, source: 'checkout', needs_invoice: true });
});

test('keeps payment editable when buyer details cannot be saved', async ({ page }) => {
  const confirmations: string[] = [];
  page.on('request', request => { if (/api\.stripe\.com\/.*\/confirm/.test(request.url())) confirmations.push(request.url()); });
  await page.route('**/api/update-payment-metadata', route => route.fulfill({
    status: 500, contentType: 'application/json', body: '{"error":"x"}',
  }));
  const sessionId = await fillBuyer(page);
  await page.getByRole('button', { name: /^Zapłać/ }).click();
  await expect(page.getByText('Nie udało się zapisać danych. Spróbuj ponownie.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Zapłać/ })).toBeEnabled();
  await expect(page).toHaveURL(new RegExp(`/pl/checkout/${product.slug}$`));
  expect(confirmations).toEqual([]);
  expect(readBuyer(sessionId)).toBeNull();
});
