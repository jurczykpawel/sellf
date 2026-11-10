/** Seller grants access with a license and can retain or revoke that specific key. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { useSupabaseBuyerEmails } from './helpers/buyer-email-setting-playwright';
import { createTestAdmin, createTestUser, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';
import { waitForEmail } from './helpers/mailpit';
import { generateSellerKeypair, storeSellerKey } from '@/lib/license-keys/keys';
useSupabaseBuyerEmails();
test.describe.configure({ mode: 'serial' });
for (const locale of ['en', 'pl'] as const) {
  test(`access license checkboxes and buyer mail (${locale}) @J20`, async ({ page }) => {
    const admin = await createTestAdmin('access-ui-admin');
    const buyer = await createTestUser('access-ui-buyer');
    const owner = await createTestUser('access-ui-owner');
    const product = randomUUID(), seed = randomUUID();
    const pl = locale === 'pl';
    try {
      await storeSellerKey(db, { sellerId: owner.userId, ...generateSellerKeypair(), custody: 'managed' });
      expect((await db.from('products').insert([
        { id: product, slug: product, name: `Access UI ${locale}`, price: 10, currency: 'PLN', seller_id: owner.userId, is_active: true, issue_license_on_purchase: true, license_tier: 'pro', license_duration_days: 30 },
        { id: seed, slug: seed, name: 'Initial access', price: 0, currency: 'PLN', is_active: true, issue_license_on_purchase: false },
      ])).error).toBeNull();
      expect((await db.from('user_product_access').insert({ user_id: buyer.userId, product_id: seed })).error).toBeNull();
      await setAuthSession(page, admin.email, admin.password);
      await page.goto(`/${locale}/dashboard/users`);
      await page.locator('input[type="text"]').first().fill(buyer.email);
      await page.getByRole('button', { name: `${pl ? 'Zarządzaj dostępem dla' : 'Manage access for'} ${buyer.email}`, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: pl ? 'Dodaj nowy dostęp' : 'Add New Access', exact: true }).click();
      await dialog.locator('#product-select').selectOption(product);
      await expect(dialog.getByRole('checkbox', { name: pl ? 'Wystaw licencję' : 'Issue a license', exact: true })).toBeChecked();
      if (pl) {
        await test.step('Grant access without a license', async () => {
          await dialog.getByRole('checkbox', { name: 'Wystaw licencję', exact: true }).uncheck();
          const accessOnly = page.waitForResponse(response => response.url().includes(`/api/users/${buyer.userId}/access`) && response.request().method() === 'POST');
          await dialog.getByRole('button', { name: 'Przyznaj dostęp', exact: true }).click();
          const response = await accessOnly;
          expect(response.status()).toBe(201);
          expect((await response.json()).license).toBeNull();
          expect((await db.from('issued_licenses').select('id').eq('product_id', product)).data).toEqual([]);
        });
        await test.step('Remove the access without a license', async () => {
          const removed = page.waitForResponse(response => response.url().includes(`/api/users/${buyer.userId}/access?product_id=${product}`) && response.request().method() === 'DELETE');
          await dialog.locator('.group').filter({ hasText: `Access UI ${locale}` }).getByRole('button', { name: 'Usuń', exact: true }).click();
          expect((await removed).status()).toBe(200);
        });
        await test.step('Start a new grant with licensing enabled by default', async () => {
          await dialog.getByRole('button', { name: 'Dodaj nowy dostęp', exact: true }).click();
          await dialog.locator('#product-select').selectOption(product);
          await expect(dialog.getByRole('checkbox', { name: 'Wystaw licencję', exact: true })).toBeChecked();
        });
      }
      const grant = page.waitForResponse(response => response.url().includes(`/api/users/${buyer.userId}/access`) && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: pl ? 'Przyznaj dostęp' : 'Grant Access', exact: true }).click();
      expect((await grant).status()).toBe(201);
      const license = await db.from('issued_licenses').select('id,license_key').eq('product_id', product).single();
      expect(license.error).toBeNull();
      expect((await waitForEmail(buyer.email)).HTML).toContain(license.data!.license_key);
      const revoke = dialog.getByRole('checkbox', { name: pl ? 'Odbierz też licencję' : 'Also revoke the license', exact: true });
      await expect(revoke).toBeChecked();
      if (pl) await revoke.uncheck();
      const removed = page.waitForResponse(response => response.url().includes(`/api/users/${buyer.userId}/access?product_id=${product}`) && response.request().method() === 'DELETE');
      await dialog.locator('.group').filter({ hasText: `Access UI ${locale}` }).getByRole('button', { name: pl ? 'Usuń' : 'Remove', exact: true }).click();
      expect((await removed).status()).toBe(200);
      const saved = await db.from('issued_licenses').select('revoked_at').eq('id', license.data!.id).single();
      if (pl) expect(saved.data!.revoked_at).toBeNull();
      else expect(saved.data!.revoked_at).toBeTruthy();
    } finally {
      await db.from('issued_licenses').delete().eq('product_id', product);
      await db.from('user_product_access').delete().in('product_id', [product, seed]);
      await db.from('products').delete().in('id', [product, seed]);
      await db.from('seller_license_keys').delete().eq('seller_id', owner.userId);
      await buyer.cleanup(); await owner.cleanup(); await admin.cleanup();
    }
  });
}
