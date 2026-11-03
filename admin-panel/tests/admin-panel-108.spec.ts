/**
 * Admin panel 2026.10.8: open an order from a link, Orders tab, grouped menu, licenses in Sales.
 * @see src/components/admin/PaymentsDashboard.tsx
 * @see src/components/admin/OrdersTable.tsx
 * @see src/lib/navigation/admin-nav.ts
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestAdmin, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';

test('seller opens an order straight from its link and sees the Orders tab without horizontal scroll @J191 @J190', async ({ page }) => {
  const admin = await createTestAdmin('w135-orders');
  const run = randomUUID().replaceAll('-', '');
  const product = await db.from('products').insert({ name: `W135 ${run}`, slug: `w135-${run}`, price: 49, currency: 'PLN', is_active: true }).select('id').single();
  expect(product.error).toBeNull();
  const email = `w135-${run}@example.test`;
  const tx = await db.from('payment_transactions').insert({ product_id: product.data!.id, amount: 4900, currency: 'PLN', status: 'completed',
    customer_email: email, session_id: `cs_w135_${run}`, stripe_payment_intent_id: `pi_w135_${run}` }).select('id, order_number').single();
  expect(tx.error).toBeNull();
  const orderNumber = tx.data!.order_number as number;
  try {
    await setAuthSession(page, admin.email, admin.password);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/pl/dashboard/payments?order=${orderNumber}`);
    const dialog = page.getByText('Szczegóły transakcji');
    await expect(dialog).toBeVisible();
    await expect(page.getByText(`#${orderNumber}`).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Wystaw licencję dla tego klienta' })).toHaveAttribute('href', `/dashboard/licenses?email=${encodeURIComponent(email)}&product=${product.data!.id}`);
    await page.getByRole('button', { name: 'Zamknij' }).last().click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => new URL(page.url()).searchParams.get('order')).toBeNull();

    for (const locale of ['pl', 'en']) for (const width of [1366, 1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/dashboard/payments`);
      await page.getByRole('tab', { name: locale === 'pl' ? 'Zamówienia' : 'Orders' }).click();
      await expect(page.getByText(email).first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: `${locale} ${width}` }).toBeLessThanOrEqual(width);
    }
  } finally {
    await db.from('payment_transactions').delete().eq('id', tx.data!.id);
    await db.from('products').delete().eq('id', product.data!.id);
    await admin.cleanup();
  }
});

test('grouped menu leads to Sales > Licenses and keeps the pinned state @J194 @J193', async ({ page }) => {
  const admin = await createTestAdmin('w135-nav');
  try {
    await setAuthSession(page, admin.email, admin.password);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem('sf_sidebar_pinned', 'true'));
    await page.goto('/pl/dashboard');
    for (const group of ['Sprzedaż i raporty', 'Produkty', 'System']) {
      await expect(page.getByRole('navigation', { name: group, exact: true }).first()).toBeAttached();
    }
    await page.getByRole('navigation', { name: 'Sprzedaż i raporty' }).first().getByRole('link', { name: 'Licencje' }).click();
    await expect(page).toHaveURL(/\/dashboard\/licenses/);
    await expect(page.getByRole('heading', { level: 1, name: 'Wystawione licencje produktowe' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('sf_sidebar_pinned'))).toBe('true');
    await page.goto('/pl/dashboard/settings');
    await page.getByRole('button', { name: /^Licencja$/i }).click();
    await expect(page.getByText('Wystaw licencję ręcznie')).toHaveCount(0);
  } finally {
    await admin.cleanup();
  }
});
