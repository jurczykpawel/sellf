/** @see src/app/api/v1/payments/export/route.ts */
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { supabaseAdmin, createTestAdmin, loginAsAdmin } from './helpers/admin-auth';

test.describe('Payments CSV active filters', () => {
  let productId: string;
  let needleEmail: string;
  let admin: Awaited<ReturnType<typeof createTestAdmin>>;
  const recent = new Date().toISOString();
  const old = new Date(Date.now() - 400 * 86400000).toISOString();
  const rows = (csv: string) => csv.trim().split('\n').slice(1);

  test.beforeAll(async () => {
    admin = await createTestAdmin('csv-filters');
    const suffix = crypto.randomUUID().replaceAll('-', '');
    needleEmail = `needle-${suffix}@example.com`;
    const { data, error } = await supabaseAdmin.from('products').insert({
      name: `CSV ${suffix}`, slug: `csv-${suffix}`, price: 1000, currency: 'USD', is_active: true,
    }).select('id').single();
    if (error) throw error;
    productId = data.id;
    const transactions = Array.from({ length: 1005 }, (_, index) => ({
      product_id: productId, customer_email: index === 0 ? needleEmail : `filler-${index}-${suffix}@example.com`,
      amount: 1000, currency: 'USD', session_id: `cs_test_csv${suffix}${index}`,
      stripe_payment_intent_id: `pi_csv${suffix}${index}`,
      status: index === 1 ? 'refunded' : index === 2 ? 'disputed' : 'completed',
      created_at: index < 3 ? recent : old,
      refund_reason: index === 1 ? '=1+1' : null,
    }));
    const inserted = await supabaseAdmin.from('payment_transactions').insert(transactions);
    if (inserted.error) throw inserted.error;
  });
  test.afterAll(async () => {
    if (productId) {
      await supabaseAdmin.from('payment_transactions').delete().eq('product_id', productId);
      await supabaseAdmin.from('products').delete().eq('id', productId);
    }
    if (admin) await admin.cleanup();
  });
  test.beforeEach(async ({ page }) => {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) throw error;
    const user = data.users.find(user => user.email === admin.email);
    if (!user) throw new Error('Test admin not found');
    await supabaseAdmin.from('application_rate_limits').delete().eq('identifier', `user:${user.id}`).eq('action_type', 'admin_export');
    await loginAsAdmin(page, admin.email, admin.password);
  });

  test('email filter exports the same single transaction shown in Payments @J58', async ({ page }) => {
    await page.goto('/en/dashboard/payments');
    await page.locator('#payment-date-range-filter').selectOption('all');
    await page.locator('#payment-search-filter').fill(needleEmail);
    await expect(page.getByRole('button', { name: /Payment transactions \(1\)/i })).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export CSV/ }).click();
    const download = await downloadPromise;
    const csv = await readFile((await download.path())!, 'utf8');
    expect(rows(csv)).toHaveLength(1);
    expect(csv).toContain(needleEmail);
  });
  test('API combines status, product and date filters and keeps CSV cells literal', async ({ page }) => {
    const response = await page.request.post('/api/v1/payments/export', { data: {
      status: 'refunded', product_id: productId, date_from: recent, date_to: recent,
    } });
    expect(response.status()).toBe(200);
    const csv = await response.text();
    expect(rows(csv)).toHaveLength(1);
    expect(csv).toContain('"\'=1+1"');
  });
  test('API supports dashboard disputed status and relative date range', async ({ page }) => {
    const response = await page.request.post('/api/v1/payments/export', { data: {
      status: 'disputed', product_id: productId, dateRange: '7',
    } });
    expect(response.status()).toBe(200);
    expect(rows(await response.text())).toHaveLength(1);
  });
  test('relative range excludes old transactions', async ({ page }) => {
    const response = await page.request.post('/api/v1/payments/export', { data: { product_id: productId, dateRange: '7' } });
    expect(response.status()).toBe(200);
    expect(rows(await response.text())).toHaveLength(3);
  });
  test('unfiltered export includes all records beyond a database response page', async ({ page }) => {
    const response = await page.request.post('/api/v1/payments/export', { data: {} });
    expect(response.status()).toBe(200);
    const csv = await response.text();
    expect(rows(csv).filter(row => row.includes(needleEmail.split('@')[0].slice(7)))).toHaveLength(1005);
  });
  test('searching by product name exports all matching transactions', async ({ page }) => {
    const response = await page.request.post('/api/v1/payments/export', { data: { search: `CSV ${needleEmail.slice(7).split('@')[0]}` } });
    expect(response.status()).toBe(200);
    expect(rows(await response.text())).toHaveLength(1005);
  });
});
