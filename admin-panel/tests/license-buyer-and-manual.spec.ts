/** Buyer sees the real license state; a seller's manual issuance reaches the buyer's inbox. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestAdmin, createTestUser, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';
import { openSettingsTab } from './helpers/settings-tabs';
import { waitForEmail } from './helpers/mailpit';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';

test.describe.configure({ mode: 'serial' });

let sellerId: string, product: string, slug: string, kid: string;
let cleanups: Array<() => Promise<void>> = [];

test.beforeAll(async () => {
  const seller = await createTestUser('w133-e2e-seller');
  sellerId = seller.userId;
  cleanups.push(seller.cleanup);
  const pair = generateSellerKeypair();
  kid = pair.kid;
  await storeSellerKey(db, { sellerId, ...pair, custody: 'managed' });
  product = randomUUID();
  slug = `w133-e2e-${product.slice(0, 8)}`;
  const { error } = await db.from('products').insert({
    id: product, name: 'W133 E2E Plugin', slug, price: 10, currency: 'PLN', is_active: true,
    seller_id: sellerId, issue_license_on_purchase: true, license_tier: 'pro',
  });
  expect(error).toBeNull();
});

test.afterAll(async () => {
  await db.from('issued_licenses').delete().eq('product_id', product);
  await db.from('user_product_access').delete().eq('product_id', product);
  await db.from('products').delete().eq('id', product);
  await db.from('seller_license_keys').delete().eq('kid', kid);
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
  cleanups = [];
});

test('buyer sees a valid, expired and revoked license for what it is @J178', async ({ page }) => {
  const buyer = await createTestUser('w133-e2e-buyer');
  cleanups.push(buyer.cleanup);
  expect((await db.from('user_product_access').insert({ user_id: buyer.userId, product_id: product })).error).toBeNull();
  const license = randomUUID();
  expect((await db.from('issued_licenses').insert({
    id: license, seller_id: sellerId, original_seller_id: sellerId, product_id: product, email: buyer.email,
    user_id: buyer.userId, order_id: `e2e_${license}`, kid, license_key: 'e2epayload.e2esignature',
  })).error).toBeNull();
  await setAuthSession(page, buyer.email, buyer.password);
  const status = page.locator('[data-license-status]');

  await page.goto(`/en/p/${slug}`);
  await expect(status).toHaveText('Valid', { timeout: 30000 });
  await expect(page.getByText('e2epayload.e2esignature')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();

  await db.from('issued_licenses').update({ expires_at: new Date(Date.now() - 86400000).toISOString() }).eq('id', license);
  await page.reload();
  await expect(status).toHaveText('Expired', { timeout: 30000 });

  await db.rpc('revoke_issued_licenses', { p_license_ids: [license] });
  await page.reload();
  await expect(status).toHaveText('Revoked', { timeout: 30000 });
  await expect(page.getByText('e2epayload.e2esignature')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy' })).toHaveCount(0);
  await expect(page.getByText(/no longer works/)).toBeVisible();
});

test('seller issues a license manually and the buyer receives the key by mail @J20', async ({ page }) => {
  const admin = await createTestAdmin('w133-e2e-admin');
  cleanups.push(admin.cleanup);
  const email = `w133-e2e-recipient-${Date.now()}@example.com`;
  await setAuthSession(page, admin.email, admin.password);
  const heading = page.getByRole('heading', { name: 'Issue a license manually' });
  await openSettingsTab(page, /^License$|^Licencja$/i, heading, '/en/dashboard/settings');
  const form = page.locator('form').filter({ has: heading });
  await form.locator('select').first().selectOption(product);
  await form.locator('input[type="email"]').fill(email);
  await expect(form.getByRole('checkbox')).toBeChecked();
  page.once('dialog', dialog => void dialog.accept());
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await form.getByRole('button', { name: 'Issue license' }).click();

  const message = await waitForEmail(email, { timeout: 30000 });
  const { data } = await db.from('issued_licenses').select('license_key, issuance_source').eq('product_id', product).eq('email', email).single();
  expect(data?.issuance_source).toBe('manual');
  expect(message.HTML).toContain(data!.license_key);
  expect(message.HTML).toContain(slug);
});
