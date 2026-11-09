/** Seller form corrections and available payment actions. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin as db } from './helpers/admin-auth';

let admin: Awaited<ReturnType<typeof createTestAdmin>>;
let productId: string;
const run = randomUUID();
const transferEmail = `transfer-${run}@example.com`, yenEmail = `yen-${run}@example.com`;
let transferId: string;
test.beforeAll(async () => {
  admin = await createTestAdmin('panel-corrections');
  const product = await db.from('products').insert({ name: `Panel ${run}`, slug: `panel-${run}`, price: 100, currency: 'PLN', is_active: true }).select('id').single();
  expect(product.error).toBeNull(); productId = product.data!.id;
  const transfer = await db.from('payment_transactions').insert({ product_id: productId, session_id: null, pricing_snapshot_version: 1, payment_provider: 'bank_transfer', status: 'awaiting_payment', amount: 10000, currency: 'PLN', customer_email: transferEmail }).select('id').single();
  expect(transfer.error).toBeNull(); transferId = transfer.data!.id;
  expect((await db.from('payment_transactions').insert({ product_id: productId, session_id: `pi_yen_${run.replaceAll('-', '')}`, payment_provider: 'stripe', status: 'completed', amount: 200, currency: 'JPY', customer_email: yenEmail, stripe_payment_intent_id: `pi_fixture_${run.replaceAll('-', '')}` })).error).toBeNull();
});
test.afterAll(async () => {
  if (productId) { await db.from('payment_transactions').delete().eq('product_id', productId); await db.from('products').delete().eq('id', productId); }
  await admin?.cleanup();
});
test('booked amount errors stay by the field and bank transfers have no Stripe refund action @J232 @J192', async ({ page }) => {
  await loginAsAdmin(page, admin.email, admin.password);
  await page.goto('/en/dashboard/payments');
  await page.getByRole('row').filter({ hasText: transferEmail }).getByRole('button', { name: 'Details', exact: true }).click();
  const region = page.getByRole('region', { name: 'Traditional bank transfer', exact: true });
  const amount = region.getByRole('spinbutton');
  await amount.fill('99.99');
  await region.getByLabel('Date received (UTC)').fill(new Date().toISOString().slice(0, 10));
  await region.getByRole('button', { name: 'Mark as paid', exact: true }).click();
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  const errorId = await amount.getAttribute('aria-describedby');
  await expect(page.locator(`[id="${errorId}"]`)).toContainText('full order amount');
  await expect(page.locator(`[id="${errorId}"]`)).toBeInViewport();
  await amount.fill('100');
  await expect(amount).toHaveAttribute('aria-invalid', 'false');
  await expect(region.getByRole('alert')).toHaveCount(0);
  // A previously booked transfer is read-only for Stripe refunds.
  expect((await db.from('payment_transactions').update({ status: 'completed' }).eq('id', transferId)).error).toBeNull();
  await page.goto('/en/dashboard/payments');
  const row = page.getByRole('row').filter({ hasText: transferEmail });
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Refund', exact: true })).toHaveCount(0);
  const response = await page.request.post('/api/admin/payments/refund', { data: { transactionId: transferId } });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toContain('Bank transfer');
  const state = await db.from('payment_transactions').select('status,refunded_amount').eq('id', transferId).single();
  expect(state.data).toMatchObject({ status: 'completed', refunded_amount: 0 });
});
test('JPY refund instructions use whole units in both panel languages @J192', async ({ page }) => {
  await loginAsAdmin(page, admin.email, admin.password);
  for (const locale of ['en', 'pl']) {
    await page.goto(`/${locale}/dashboard/payments`);
    await page.getByRole('row').filter({ hasText: yenEmail }).getByRole('button', { name: locale === 'en' ? 'Refund' : 'Zwrot', exact: true }).click();
    const amount = page.locator('#sf-refund-amount');
    await amount.fill('0.5');
    await expect(page.locator('#sf-refund-amount-error')).toContainText(locale === 'en' ? 'whole currency units' : 'całych jednostkach');
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await amount.fill('100');
    await expect(amount).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#sf-refund-amount-error')).toHaveCount(0);
  }
});
test('correcting a product slug clears its validation message @J47', async ({ page }) => {
  await loginAsAdmin(page, admin.email, admin.password);
  await test.step('open a standard product and enter the invalid slug', async () => {
    await page.goto('/pl/dashboard/products');
    await page.getByRole('button', { name: /Dodaj produkt/ }).click();
    await page.locator('#name').fill('Slug correction');
    await page.locator('#price').fill('10');
    await page.locator('#slug').fill('Zła Ścieżka!');
  });
  const slug = page.locator('#slug');
  await test.step('submit and display the slug error', async () => {
    const publish = page.getByRole('button', { name: /Publikuj/ });
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(slug).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#slug-error')).toBeVisible();
  });
  await test.step('correct the slug and clear its error', async () => {
    await slug.fill(`corrected-${run}`);
    await expect(slug).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#slug-error')).toHaveCount(0);
  });
});
