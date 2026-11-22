/**
 * Product archive in the admin panel: "Delete" of a sold product moves it to the archive,
 * the archive filter lists it, it can be restored, and "Delete permanently" shows what is
 * kept (orders, invoices, licenses) and what ends (buyer access).
 *
 * @see src/components/ProductRemoveDialog.tsx
 */
import { archiveLegacyBundleComponent } from './helpers/legacy-bundle';
import en from '../src/messages/en.json';
import pl from '../src/messages/pl.json';
import { generateKeyPairSync } from 'node:crypto';
import { signLicense } from '@/lib/license-keys/format';
import { test, expect, type Page } from '@playwright/test';
import { insertTestApiKey } from './helpers/api-key';
import { acceptAllCookies } from './helpers/consent';
import { createTestAdmin, createTestUser, setAuthSession, supabaseAdmin } from './helpers/admin-auth';

test.describe.configure({ mode: 'serial' });

let admin: Awaited<ReturnType<typeof createTestAdmin>>;
const productIds: string[] = [];
let apiKey: string;
let apiKeyId: string;

/** A paid product with one completed order and an issued license. */
async function soldProduct(name: string): Promise<{ id: string; orderId: string; licenseId: string }> {
  const { data: product, error } = await supabaseAdmin.from('products').insert({
    name, slug: `archive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, price: 49, currency: 'PLN', is_active: true,
  }).select('id').single();
  expect(error).toBeNull();
  productIds.push(product!.id);
  const { data: order, error: orderError } = await supabaseAdmin.from('payment_transactions').insert({
    product_id: product!.id, customer_email: 'archive-buyer@example.com', amount: 4900, currency: 'PLN',
    status: 'completed', session_id: `cs_test_archive${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
  }).select('id').single();
  expect(orderError).toBeNull();
  const { data: seller } = await supabaseAdmin.from('admin_users').select('user_id').limit(1).single();
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const token = signLicense({ v: 1, kid: 'archive', product: product!.id, email: 'archive-buyer@example.com', order: order!.id, tier: 'original', iat: 1, exp: null }, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  const { data: license, error: licenseError } = await supabaseAdmin.from('issued_licenses').insert({
    seller_id: seller!.user_id, original_seller_id: seller!.user_id, product_id: product!.id,
    email: 'archive-buyer@example.com', order_id: order!.id, kid: 'archive', license_key: token,
  }).select('id').single();
  expect(licenseError).toBeNull();
  return { id: product!.id, orderId: order!.id, licenseId: license!.id };
}

async function openProducts(page: Page, search: string) {
  await acceptAllCookies(page);
  await page.goto('/');
  await setAuthSession(page, admin.email, admin.password);
  await page.goto('/pl/dashboard/products');
  await page.getByPlaceholder(/szukaj/i).fill(search);
}

async function rowAction(page: Page, name: string, action: RegExp) {
  await page.locator('tr').filter({ hasText: name }).locator('button[aria-expanded]').click();
  await page.locator('button').filter({ hasText: action }).first().click();
}

test.beforeAll(async () => {
  admin = await createTestAdmin('product-archive-admin');
  const owner = await supabaseAdmin.from('admin_users').select('id').limit(1).single();
  expect(owner.error).toBeNull();
  apiKey = `sf_test_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
  const key = await insertTestApiKey(supabaseAdmin, apiKey, {
    name: 'Archive fixture', admin_user_id: owner.data!.id, scopes: ['products:read', 'products:write'], is_active: true,
  });
  apiKeyId = key.data.id;
});
test.afterAll(async () => {
  for (const id of productIds) expect((await supabaseAdmin.from('products').delete().eq('id', id)).error).toBeNull();
  await supabaseAdmin.from('api_keys').delete().eq('id', apiKeyId);
  await admin.cleanup();
});

test('deleting a sold product moves it to the archive and restore brings it back inactive @J600', async ({ page }) => {
  const name = `Archive Archiwum ${Date.now()}`;
  const product = await soldProduct(name);
  await openProducts(page, name);
  await expect(page.locator('tr').filter({ hasText: name })).toBeVisible();

  await rowAction(page, name, /^Usuń$/);
  const dialog = page.getByTestId('product-remove-dialog');
  await expect(dialog).toContainText('Produkt ma 1 zamówienie — zostanie przeniesiony do archiwum.');
  await expect(dialog).toContainText('Kupujący zachowują dostęp do treści, a zamówienia, faktury i licencje zostają.');
  await page.getByRole('button', { name: 'Przenieś do archiwum' }).click();
  await expect(page.getByText(`Produkt "${name}" przeniesiono do archiwum`)).toBeVisible();
  await expect(page.locator('tr').filter({ hasText: name })).toHaveCount(0);

  const kept = await supabaseAdmin.from('payment_transactions').select('product_id').eq('id', product.orderId).single();
  expect(kept.data?.product_id).toBe(product.id);
  const archived = await supabaseAdmin.from('products').select('archived_at,is_active').eq('id', product.id).single();
  expect(archived.data?.archived_at).not.toBeNull();
  expect(archived.data?.is_active).toBe(false);

  await page.locator('#status-filter').selectOption('archived');
  const row = page.locator('tr').filter({ hasText: name });
  await expect(row).toContainText('W archiwum');
  await rowAction(page, name, /^Przywróć$/);
  await expect(page.getByText(`Produkt "${name}" przywrócono.`, { exact: false })).toBeVisible();
  await expect(page.locator('tr').filter({ hasText: name })).toHaveCount(0);

  await page.locator('#status-filter').selectOption('all');
  await expect(page.locator('tr').filter({ hasText: name })).toContainText('Nieaktywny');
  const restored = await supabaseAdmin.from('products').select('archived_at,is_active').eq('id', product.id).single();
  expect(restored.data).toEqual({ archived_at: null, is_active: false });
  const restoredRow = page.locator('tr').filter({ hasText: name });
  await restoredRow.getByRole('button', { name: 'Nieaktywny', exact: true }).click();
  await expect(restoredRow.getByRole('button', { name: 'Aktywny', exact: true })).toBeVisible();
  expect((await supabaseAdmin.from('products').select('is_active').eq('id', product.id).single()).data?.is_active).toBe(true);
  await restoredRow.getByRole('button', { name: 'Aktywny', exact: true }).click();
  const inactive = restoredRow.getByRole('button', { name: 'Nieaktywny', exact: true });
  await inactive.focus(); await inactive.press('Enter');
  await expect(restoredRow.getByRole('button', { name: 'Aktywny', exact: true })).toBeVisible();
  expect((await supabaseAdmin.from('products').select('is_active').eq('id', product.id).single()).data?.is_active).toBe(true);
});

test('permanent delete from the archive lists the kept records and keeps the order and license @J601', async ({ page }) => {
  const name = `Archive Trwale ${Date.now()}`;
  const product = await soldProduct(name);
  const buyer = await createTestUser('archive-perm-buyer');
  expect((await supabaseAdmin.from('user_product_access').insert({ user_id: buyer.userId, product_id: product.id, grant_source: 'purchase' })).error).toBeNull();
  expect((await supabaseAdmin.from('products').update({ archived_at: new Date().toISOString(), is_active: false }).eq('id', product.id)).error).toBeNull();
  await openProducts(page, name);
  await page.locator('#status-filter').selectOption('archived');
  await expect(page.locator('tr').filter({ hasText: name })).toBeVisible();

  expect((await supabaseAdmin.from('products').update({ license_tier: 'changed' }).eq('id', product.id)).error).toBeNull();
  const before = await page.request.get(`/api/v1/licenses/${product.licenseId}`);
  expect(before.status()).toBe(200);
  expect((await before.json()).data.tier).toBe('original');
  await rowAction(page, name, /^Usuń trwale$/);
  const dialog = page.getByTestId('product-remove-dialog');
  await expect(dialog).toContainText('zamówienia (1), faktury (0), licencje (1)');
  await expect(dialog).toContainText('Kupujący stracą dostęp do treści produktu: 1 dostęp zostanie usunięty.');
  await expect(dialog).toContainText('Produktu nie będzie można przywrócić.');
  await page.getByRole('button', { name: 'Usuń trwale' }).click();
  await expect(page.getByText(`Produkt "${name}" został pomyślnie usunięty`)).toBeVisible();
  await expect(page.locator('tr').filter({ hasText: name })).toHaveCount(0);

  expect((await supabaseAdmin.from('products').select('id').eq('id', product.id).maybeSingle()).data).toBeNull();
  const order = await supabaseAdmin.from('payment_transactions').select('product_id,product_name,status').eq('id', product.orderId).single();
  expect(order.data).toEqual({ product_id: null, product_name: name, status: 'completed' });
  const license = await supabaseAdmin.from('issued_licenses').select('product_id,product_name').eq('id', product.licenseId).single();
  expect(license.data).toEqual({ product_id: null, product_name: name });
  const detail = await page.request.get(`/api/v1/licenses/${product.licenseId}`);
  expect(detail.status()).toBe(200);
  expect((await detail.json()).data).toMatchObject({ productId: null, tier: 'original', product: { name, slug: null }, token: expect.any(String) });
  const list = await page.request.get('/api/v1/licenses?email=archive-buyer%40example.com');
  expect(list.status()).toBe(200);
  const item = (await list.json()).data.find((row: { id: string }) => row.id === product.licenseId);
  expect(item).toMatchObject({ tier: 'original' }); expect(item).not.toHaveProperty('token');
  expect((await supabaseAdmin.from('user_product_access').select('id').eq('user_id', buyer.userId)).data).toEqual([]);
  await buyer.cleanup();
});

test('a buyer keeps the content of an archived product while the public no longer sees it @J603', async ({ page, browser }) => {
  const name = `Archive Kupujacy ${Date.now()}`;
  const product = await soldProduct(name);
  const { data: row } = await supabaseAdmin.from('products').select('slug').eq('id', product.id).single();
  const buyer = await createTestUser('archive-buyer');
  expect((await supabaseAdmin.from('user_product_access').insert({ user_id: buyer.userId, product_id: product.id, grant_source: 'purchase' })).error).toBeNull();
  expect((await supabaseAdmin.from('products').update({ archived_at: new Date().toISOString(), is_active: false, enable_waitlist: true }).eq('id', product.id)).error).toBeNull();

  const anonymous = await browser.newContext();
  const anonPage = await anonymous.newPage();
  const publicApi = await anonPage.request.get(`/api/public/products/${row!.slug}`);
  expect(publicApi.status()).toBe(404);
  const publicPage = await anonPage.goto(`/pl/p/${row!.slug}`);
  expect(publicPage?.status()).toBe(404);
  await anonymous.close();

  await acceptAllCookies(page);
  await page.goto('/');
  await setAuthSession(page, buyer.email, buyer.password);
  await page.goto(`/pl/p/${row!.slug}`);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Ten produkt nie jest już dostępny dla nowych klientów')).toBeVisible();
  await page.goto('/pl/my-products');
  await expect(page.getByText(name).first()).toBeVisible();
  await buyer.cleanup();
});

for (const state of ['unsold', 'sold', 'archived']) {
  test(`bundle component ${state} cannot be removed in the panel or API @J602`, async ({ page }) => {
    const name = `Component ${state} ${Date.now()}`;
    const component = await soldProduct(name);
    if (state === 'unsold') {
      expect((await supabaseAdmin.from('issued_licenses').delete().eq('id', component.licenseId)).error).toBeNull();
      expect((await supabaseAdmin.from('payment_transactions').delete().eq('id', component.orderId)).error).toBeNull();
    }
    const { data: bundle, error } = await supabaseAdmin.from('products').insert({
      name: `Containing ${name}`, slug: `bundle-${component.id}`, price: 79, is_bundle: true, is_active: true,
    }).select('id,name').single();
    expect(error).toBeNull();
    productIds.unshift(bundle!.id);
    expect((await supabaseAdmin.from('bundle_items').insert({ bundle_product_id: bundle!.id, component_product_id: component.id })).error).toBeNull();
    if (state === 'archived') archiveLegacyBundleComponent(component.id);
    const before = await supabaseAdmin.from('bundle_items').select('*').eq('bundle_product_id', bundle!.id);
    await openProducts(page, name);
    if (state === 'archived') await page.locator('#status-filter').selectOption('archived');
    const row = page.locator('tr').filter({ has: page.getByText(name, { exact: true }) });
    await row.locator('button[aria-expanded]').click();
    await page.locator('button').filter({ hasText: state === 'archived' ? /^Usuń trwale$/ : /^Usuń$/ }).first().click();
    const dialog = page.getByTestId('product-remove-dialog');
    await expect(dialog).toContainText(bundle!.name);
    await expect(dialog).toContainText('Usuń go najpierw ze składu tych pakietów');
    await expect(page.getByRole('button', { name: state === 'archived' ? 'Usuń trwale' : state === 'sold' ? 'Przenieś do archiwum' : 'Usuń', exact: true }).last()).toBeDisabled();
    const response = await page.request.delete(`/api/v1/products/${component.id}${state === 'archived' ? '?permanent=true' : ''}`, { headers: { Authorization: `Bearer ${apiKey}`, Origin: new URL(page.url()).origin } });
    expect(response.status()).toBe(409);
    expect((await response.json()).error.message).toContain(bundle!.name);
    expect((await supabaseAdmin.from('bundle_items').select('*').eq('bundle_product_id', bundle!.id)).data).toEqual(before.data);
    const kept = await supabaseAdmin.from('products').select('archived_at,is_active').eq('id', component.id).single();
    expect(kept.error).toBeNull();
    expect(Boolean(kept.data!.archived_at)).toBe(state === 'archived');
    expect(kept.data!.is_active).toBe(state !== 'archived');
  });
}

for (const locale of ['en', 'pl']) {
  test(`archived components are refused on PATCH and legacy offers show the full contents in ${locale} @J602`, async ({ page }) => {
    const component = await soldProduct(`Legacy component ${crypto.randomUUID()}`);
    const { data: bundle, error } = await supabaseAdmin.from('products').insert({
      name: `Legacy bundle ${crypto.randomUUID()}`, slug: `legacy-${component.id}`, price: 79,
      is_bundle: true, is_active: true,
    }).select('id,name,slug').single();
    expect(error).toBeNull(); productIds.unshift(bundle!.id);
    expect((await supabaseAdmin.from('bundle_items').insert({ bundle_product_id: bundle!.id, component_product_id: component.id })).error).toBeNull();
    archiveLegacyBundleComponent(component.id);
    const { data: original } = await supabaseAdmin.from('products').select('name').eq('id', component.id).single();
    await page.goto(`/${locale}/checkout/${bundle!.slug}`);
    await expect(page.getByTestId('bundle-contents-preview')).toContainText(original!.name);
    await openProducts(page, bundle!.name);
    for (const headers of [{ Origin: new URL(page.url()).origin }, { Origin: new URL(page.url()).origin, Authorization: `Bearer ${apiKey}` }]) {
      const response = await page.request.patch(`/api/v1/products/${bundle!.id}`, { headers, data: { bundleItemIds: [component.id] } });
      expect(response.status()).toBe(400);
      expect((await response.json()).error.details.bundleItemIds).toEqual(['archived']);
    }
    expect((await supabaseAdmin.from('bundle_items').select('component_product_id').eq('bundle_product_id', bundle!.id)).data)
      .toEqual([{ component_product_id: component.id }]);
    await page.goto(`/${locale}/dashboard/products`);
    await page.getByPlaceholder(locale === 'pl' ? /szukaj/i : /search/i).fill(bundle!.name);
    const row = page.locator('tr').filter({ has: page.getByText(bundle!.name, { exact: true }) });
    await row.getByRole('button', { name: (locale === 'pl' ? pl : en).admin.products.editLabel.replace('{name}', bundle!.name), exact: true }).click();
    const { openFormSection } = await import('./helpers/product-form');
    await openFormSection(page, (locale === 'pl' ? pl : en).admin.products.form.sections.delivery.title);
    await expect(page.getByRole('dialog')).toContainText(locale === 'pl' ? 'Najpierw przywróć produkt' : 'Restore the product first');
    await expect(page.getByRole('button', { name: `${locale === 'pl' ? 'Dodaj' : 'Add'} ${original!.name}`, exact: true })).toHaveCount(0);
  });
}

test('Escape closes product actions and returns focus to the trigger @J600', async ({ page }) => {
  const name = `Keyboard actions ${Date.now()}`;
  await soldProduct(name); await openProducts(page, name);
  const trigger = page.locator('tr').filter({ hasText: name }).locator('button[aria-expanded]');
  for (const focusItem of [false, true]) {
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    if (focusItem) await page.getByRole('button', { name: /Testuj lejek/ }).focus();
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  }
});
