/**
 * 2026.11.0 W153: the seller reads sales sources in the panel; a Polish buyer of a free product
 * gets a Polish confirmation.
 * @see src/app/[locale]/dashboard/attribution/page.tsx
 * @see src/app/[locale]/checkout/[slug]/components/FreeProductForm.tsx
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestAdmin, createTestUser, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';

test('seller sees sales sources by last and first touch, partners included, without horizontal scroll @J290', async ({ page }) => {
  const admin = await createTestAdmin('w153-sources');
  const run = randomUUID().slice(0, 8);
  const product = await db.from('products').insert({ name: `W153 ${run}`, slug: `w153-${run}`, price: 40, currency: 'PLN', is_active: true }).select('id').single();
  expect(product.error).toBeNull();
  const ref = `cs_w153_${run}`;
  const payload = { v: 1, consent: 'analytics', mode: 'stored', sessions_count: 2,
    first: { source: 'google', medium: 'cpc', campaign: `first-${run}`, landing_path: '/' },
    last: { source: 'listmonk', medium: 'email', campaign: `last-${run}`, landing_path: '/offer' } };
  expect((await db.rpc('store_checkout_attribution', { p_ref: ref, p_payload: payload })).error).toBeNull();
  const tx = await db.from('payment_transactions').insert({ product_id: product.data!.id, amount: 4000, currency: 'PLN', status: 'completed',
    customer_email: `w153-${run}@example.test`, session_id: ref, stripe_payment_intent_id: `pi_w153_${run}` }).select('id').single();
  expect(tx.error).toBeNull();
  try {
    await setAuthSession(page, admin.email, admin.password);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/pl/dashboard');
    await page.getByRole('link', { name: 'Źródła sprzedaży' }).first().click();
    await expect(page.getByRole('heading', { name: 'Źródła sprzedaży' })).toBeVisible();
    const table = page.locator('table');
    await expect(table.getByRole('row').filter({ hasText: `last-${run}` })).toContainText('email');
    await expect(table.getByRole('row').filter({ hasText: `last-${run}` })).toContainText('listmonk');
    await page.getByLabel('Przypisanie').selectOption('first');
    await page.getByRole('button', { name: 'Pokaż', exact: true }).click();
    const firstRow = table.getByRole('row').filter({ hasText: `first-${run}` });
    await expect(firstRow).toContainText('paid_search');
    await expect(firstRow).toContainText('google');
    await expect(table.getByRole('row').filter({ hasText: `last-${run}` })).toHaveCount(0);

    for (const locale of ['pl', 'en']) for (const width of [390, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/dashboard/attribution?touch=last`);
      await expect(page.getByText(`last-${run}`).filter({ visible: true }).first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: `${locale} ${width}` }).toBeLessThanOrEqual(width);
    }
    await expect(page.getByRole('heading', { name: 'Sales sources' })).toBeVisible();
  } finally {
    await db.from('purchase_attribution').delete().eq('transaction_id', tx.data!.id);
    await db.from('payment_transactions').delete().eq('id', tx.data!.id);
    await db.from('products').delete().eq('id', product.data!.id);
    await admin.cleanup();
  }
});

test('signed-in Polish buyer of a free product sees the confirmation in Polish @J293', async ({ page }) => {
  const buyer = await createTestUser('w153-free');
  const run = randomUUID().slice(0, 8);
  const product = await db.from('products').insert({ name: `W153 darmowy ${run}`, slug: `w153-free-${run}`, price: 0, currency: 'PLN', is_active: true }).select('id').single();
  expect(product.error).toBeNull();
  try {
    await setAuthSession(page, buyer.email, buyer.password);
    await page.goto(`/pl/checkout/w153-free-${run}`);
    await page.getByRole('button', { name: /Uzyskaj darmowy dostęp|Odbierz darmowy dostęp/ }).click();
    await expect(page.getByText('Dostęp przyznany pomyślnie!')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Access granted successfully')).toHaveCount(0);
  } finally {
    await db.from('user_product_access').delete().eq('product_id', product.data!.id);
    await db.from('products').delete().eq('id', product.data!.id);
    await buyer.cleanup();
  }
});
