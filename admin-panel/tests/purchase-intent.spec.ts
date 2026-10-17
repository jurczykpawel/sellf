/** Public product views and recorded checkout attempts. @see lib/actions/checkout-funnel.ts */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
test('counts purchase intent while leaving product views out of the funnel', async ({ page }) => {
  const slug = `intent-${randomUUID()}`;
  const created = await db.from('products').insert({ name: 'Checkout intent course', slug, price: 49, currency: 'PLN', is_active: true, is_listed: true, vat_rate: 23 }).select('id').single();
  expect(created.error).toBeNull();
  const id = created.data!.id;
  const sessions: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/create-payment-intent')) sessions.push(request.url()); });
  try {
    for (const locale of ['en', 'pl']) {
      await page.goto(`/${locale}/p/${slug}`);
      await expect(page.getByRole('button', { name: /Pay|Zapłać/ })).toBeVisible();
      expect(sessions).toHaveLength(0);
      const records = await db.from('payment_transactions').select('id').eq('product_id', id);
      expect(records.data).toEqual([]);
      const funnel = await db.rpc('get_checkout_funnel', { p_days: 30, p_product_id: id });
      expect(funnel.error).toBeNull();
      expect(funnel.data.totals).toEqual({ started: 0, paid: 0, pending: 0, abandoned: 0 });
    }
    const response = page.waitForResponse(r => r.url().includes('/api/create-payment-intent') && r.request().method() === 'POST');
    await page.getByRole('button', { name: /Zapłać/ }).click();
    expect((await response).ok()).toBe(true);
    await expect(page.locator('#checkoutEmail')).toBeVisible({ timeout: 90000 });
    expect(sessions).toHaveLength(1);
    const funnel = await db.rpc('get_checkout_funnel', { p_days: 30, p_product_id: id });
    expect(funnel.data.totals).toEqual({ started: 1, paid: 0, pending: 1, abandoned: 0 });
  } finally {
    await db.from('payment_transactions').delete().eq('product_id', id);
    await db.from('products').delete().eq('id', id);
  }
});
