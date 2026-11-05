import { test, expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin } from './helpers/admin-auth';

test('admin reads buyer, recipient, phone and five participants from the seeded order @J60', async ({ page }) => {
  test.setTimeout(90_000);
  const admin = await createTestAdmin('order-details');
  try {
    await page.setViewportSize({ width: 1280, height: 1600 });
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/payments');
    const row = page.getByRole('row').filter({ hasText: 'office@example.com' });
    await row.getByRole('button', { name: /szczegóły/i }).click();
    const section = page.getByRole('region', { name: 'Dane z koszyka' });
    await expect(section.getByText('Gmina Przykładowa')).toBeVisible();
    await expect(section.getByText('Szkoła Podstawowa nr 1')).toBeVisible();
    await expect(section.getByText('+48500100200', { exact: false })).toBeVisible();
    await expect(section.getByRole('table').getByRole('row')).toHaveCount(6);
    await expect(section.getByText('anna5@example.com')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('order-details.png'), fullPage: true });
  } finally {
    await admin.cleanup();
  }
});

test('literal order searches return successful empty results in the panel and payment API @J60', async ({ page, request }) => {
  const { supabaseAdmin: db } = await import('./helpers/admin-auth');
  const { insertTestApiKey } = await import('./helpers/api-key');
  const admin = await createTestAdmin('order-search');
  const owner = await db.from('admin_users').select('id').limit(1).single();
  const plaintext = `sf_test_${crypto.randomUUID().replaceAll('-', '')}`;
  const key = await insertTestApiKey(db, plaintext, { admin_user_id: owner.data!.id, name: 'Order search acceptance', scopes: ['payments:read'], is_active: true });
  try {
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/payments');
    await page.getByRole('tab', { name: 'Zamówienia', exact: true }).click();
    for (const phrase of ["' OR 1=1 --", 'a OR 1=1 --']) {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/orders' && new URL(r.url()).searchParams.get('search') === phrase);
      await page.getByPlaceholder(/Szukaj po nr zamówienia/).fill(phrase);
      expect((await response).status()).toBe(200);
      const api = await request.get(`/api/v1/payments?${new URLSearchParams({ search: phrase })}`, { headers: { 'X-API-Key': plaintext } });
      expect(api.status()).toBe(200);
      expect((await api.json()).data).toEqual([]);
    }
    await expect(page.getByText('Nie udało się wczytać zamówień')).toHaveCount(0);
  } finally {
    await db.from('api_keys').delete().eq('id', key.data.id);
    await admin.cleanup();
  }
});
