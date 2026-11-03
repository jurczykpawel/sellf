/** The buyer's product page tells a working license from a revoked or expired one. */
import { test, expect } from '@playwright/test';
import { createTestUser, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

const TOKEN = 'cGF5bG9hZA.c2lnbmF0dXJl';
const ids: { product?: string; license?: string } = {};
let buyer: Awaited<ReturnType<typeof createTestUser>>, seller: Awaited<ReturnType<typeof createTestUser>>, slug: string;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  buyer = await createTestUser('license-buyer'); seller = await createTestUser('license-seller');
  slug = `license-state-${crypto.randomUUID()}`;
  const product = await db.from('products').insert({ name: 'Licencjonowany produkt', slug, price: 0, currency: 'PLN', is_active: true, seller_id: seller.userId, issue_license_on_purchase: true, license_tier: 'registered',
    content_delivery_type: 'content', content_config: { content_items: [] } }).select('id').single();
  expect(product.error).toBeNull(); ids.product = product.data!.id;
  expect((await db.from('user_product_access').insert({ user_id: buyer.userId, product_id: ids.product })).error).toBeNull();
  const license = await db.from('issued_licenses').insert({ seller_id: seller.userId, original_seller_id: seller.userId, product_id: ids.product, email: buyer.email, user_id: buyer.userId,
    order_id: `free_${buyer.userId}_${ids.product}`, kid: 'kid-fixture', license_key: TOKEN, issuance_source: 'purchase' }).select('id').single();
  expect(license.error).toBeNull(); ids.license = license.data!.id;
});
test.afterAll(async () => {
  if (ids.license) await db.from('issued_licenses').delete().eq('id', ids.license);
  if (ids.product) { await db.from('user_product_access').delete().eq('product_id', ids.product); await db.from('products').delete().eq('id', ids.product); }
  await buyer?.cleanup(); await seller?.cleanup();
});
test.beforeEach(async ({ page }) => { await acceptAllCookies(page); await setAuthSession(page, buyer.email, buyer.password); });

test('a working license is shown valid with a copy button @J235', async ({ page }) => {
  await page.goto(`/pl/p/${slug}`);
  await expect(page.locator('[data-license-status="active"]')).toHaveText('Ważna');
  await expect(page.getByText(TOKEN)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kopiuj' })).toBeVisible();
});
test('a revoked license is marked revoked and its key is neither shown nor copyable @J236', async ({ page }) => {
  expect((await db.from('issued_licenses').update({ revoked_at: new Date().toISOString() }).eq('id', ids.license!)).error).toBeNull();
  await page.goto(`/pl/p/${slug}`);
  await expect(page.locator('[data-license-status="revoked"]')).toHaveText('Odwołana');
  await expect(page.getByText('i już nie działa')).toBeVisible();
  await expect(page.getByText(TOKEN)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Kopiuj' })).toHaveCount(0);
  expect(await page.content()).not.toContain(TOKEN);
});
test('an expired license is marked expired @J237', async ({ page }) => {
  expect((await db.from('issued_licenses').update({ revoked_at: null, expires_at: '2020-01-01T00:00:00Z' }).eq('id', ids.license!)).error).toBeNull();
  await page.goto(`/pl/p/${slug}`);
  await expect(page.locator('[data-license-status="expired"]')).toHaveText('Wygasła');
});
