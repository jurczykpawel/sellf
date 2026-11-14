/**
 * Product archive in the admin panel: "Delete" of a sold product moves it to the archive,
 * the archive filter lists it, it can be restored, and "Delete permanently" shows what is
 * kept (orders, invoices, licenses) and what ends (buyer access).
 *
 * @see src/components/ProductRemoveDialog.tsx
 */
import { test, expect, type Page } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { createTestAdmin, createTestUser, setAuthSession, supabaseAdmin } from './helpers/admin-auth';

test.describe.configure({ mode: 'serial' });

let admin: Awaited<ReturnType<typeof createTestAdmin>>;
const productIds: string[] = [];

/** A paid product with one completed order and an issued license. */
async function soldProduct(name: string): Promise<{ id: string; orderId: string; licenseId: string }> {
  const { data: product, error } = await supabaseAdmin.from('products').insert({
    name, slug: `w250-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, price: 49, currency: 'PLN', is_active: true,
  }).select('id').single();
  expect(error).toBeNull();
  productIds.push(product!.id);
  const { data: order, error: orderError } = await supabaseAdmin.from('payment_transactions').insert({
    product_id: product!.id, customer_email: 'w250-buyer@example.com', amount: 4900, currency: 'PLN',
    status: 'completed', session_id: `cs_test_w250${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
  }).select('id').single();
  expect(orderError).toBeNull();
  const { data: seller } = await supabaseAdmin.from('admin_users').select('user_id').limit(1).single();
  const { data: license, error: licenseError } = await supabaseAdmin.from('issued_licenses').insert({
    seller_id: seller!.user_id, original_seller_id: seller!.user_id, product_id: product!.id,
    email: 'w250-buyer@example.com', order_id: order!.id, kid: 'w250', license_key: `w250-${order!.id}`,
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

test.beforeAll(async () => { admin = await createTestAdmin('w250-archive'); });
test.afterAll(async () => {
  for (const id of productIds) await supabaseAdmin.from('products').delete().eq('id', id);
  await admin.cleanup();
});

test('deleting a sold product moves it to the archive and restore brings it back inactive @J600', async ({ page }) => {
  const name = `W250 Archiwum ${Date.now()}`;
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
});

test('permanent delete from the archive lists the kept records and keeps the order and license @J601', async ({ page }) => {
  const name = `W250 Trwale ${Date.now()}`;
  const product = await soldProduct(name);
  const buyer = await createTestUser('w250-perm-buyer');
  expect((await supabaseAdmin.from('user_product_access').insert({ user_id: buyer.userId, product_id: product.id, grant_source: 'purchase' })).error).toBeNull();
  expect((await supabaseAdmin.from('products').update({ archived_at: new Date().toISOString(), is_active: false }).eq('id', product.id)).error).toBeNull();
  await openProducts(page, name);
  await page.locator('#status-filter').selectOption('archived');
  await expect(page.locator('tr').filter({ hasText: name })).toBeVisible();

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
  expect((await supabaseAdmin.from('user_product_access').select('id').eq('user_id', buyer.userId)).data).toEqual([]);
  await buyer.cleanup();
});

test('a buyer keeps the content of an archived product while the public no longer sees it @J603', async ({ page, browser }) => {
  const name = `W250 Kupujacy ${Date.now()}`;
  const product = await soldProduct(name);
  const { data: row } = await supabaseAdmin.from('products').select('slug').eq('id', product.id).single();
  const buyer = await createTestUser('w250-buyer');
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
