/** Registered accounts and seller form presentation. @see app/api/v1/users/route.ts */
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestAdmin, createTestUser, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';
import en from '../src/messages/en.json';
import pl from '../src/messages/pl.json';

test('aligns the registered user count and renders seller forms in both languages', async ({ page, browser }) => {
  test.setTimeout(180000);
  mkdirSync('/tmp/rcfix-core-shots', { recursive: true });
  const admin = await createTestAdmin('core-seller-ui');
  const buyer = await createTestUser('core-registered');
  const shop = await db.from('shop_config').select('id,default_currency,country').single();
  expect(shop.error).toBeNull();
  const product = await db.from('products').insert({ name: 'Reporting course settings', icon: '📘', slug: `seller-ui-${randomUUID()}`, price: 49, currency: 'PLN', is_active: true, is_listed: true, vat_rate: 23 }).select('id,name').single();
  expect(product.error).toBeNull();
  try {
    await db.from('shop_config').update({ default_currency: 'PLN', country: 'US' }).eq('id', shop.data!.id);
    await setAuthSession(page, admin.email, admin.password);
    const users = await page.request.get('/api/v1/users?limit=100');
    expect(users.ok()).toBe(true);
    const body = await users.json();
    const stats = await db.rpc('get_dashboard_stats');
    expect(stats.error).toBeNull();
    expect(body.pagination.total).toBe(stats.data.totalUsers);
    expect(body.data.some((user: { id: string }) => user.id === buyer.userId)).toBe(true);
    const details = await page.request.get(`/api/v1/users/${buyer.userId}`);
    expect(details.ok()).toBe(true);
    for (const locale of ['en', 'pl']) for (const width of [1440, 390]) {
      const messages = locale === 'pl' ? pl : en;
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/dashboard/users`);
      await expect(page.getByText(buyer.email, { exact: true }).first()).toBeVisible();
      await page.screenshot({ path: `/tmp/rcfix-core-shots/users-${locale}-${width}.png`, fullPage: true, animations: 'disabled' });
      await page.goto(`/${locale}/dashboard/settings`);
      await page.getByRole('button', { name: messages.settings.tabs.legal, exact: true }).click();
      await expect(page.getByText(messages.settings.legal.notPolishShopNotice)).toBeVisible();
      await page.screenshot({ path: `/tmp/rcfix-core-shots/legal-${locale}-${width}.png`, fullPage: true, animations: 'disabled' });
      await page.goto(`/${locale}/dashboard/coupons`);
      await page.getByRole('button', { name: messages.admin.coupons.create, exact: true }).click();
      await expect(page.getByText(`${messages.admin.coupons.fixed} (PLN)`, { exact: true })).toBeVisible();
      await page.getByText(`${messages.admin.coupons.fixed} (PLN)`, { exact: true }).click();
      await expect(page.getByRole('combobox', { name: messages.admin.coupons.form.currency })).toHaveValue('PLN');
      await page.screenshot({ path: `/tmp/rcfix-core-shots/coupon-${locale}-${width}.png`, fullPage: true, animations: 'disabled' });
      await page.goto(`/${locale}/dashboard/products`);
      await page.getByRole('button', { name: messages.admin.products.editLabel.replace('{name}', product.data!.name), exact: true }).click();
      if (width < 640) await page.getByRole('button', { name: '3', exact: true }).click();
      else await page.getByText(messages.admin.products.form.wizard.step3, { exact: true }).click();
      await page.locator('[data-step3-group="E"] > button').click();
      const save = page.getByRole('button', { name: messages.affiliates.products.ruleSave, exact: true });
      await expect(save).toBeEnabled();
      await save.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/rcfix-core-shots/product-settings-${locale}-${width}.png`, fullPage: true, animations: 'disabled' });
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const login = await context.newPage();
        await login.goto(`http://localhost:3777/${locale}/login`);
        await expect(login.locator('#password')).toHaveAttribute('placeholder', messages.auth.passwordEntryPlaceholder);
        await login.screenshot({ path: `/tmp/rcfix-core-shots/login-${locale}-${width}.png`, fullPage: true, animations: 'disabled' });
      } finally { await context.close(); }
    }
  } finally {
    await db.from('shop_config').update({ default_currency: shop.data!.default_currency, country: shop.data!.country }).eq('id', shop.data!.id);
    await db.from('products').delete().eq('id', product.data!.id);
    await buyer.cleanup();
    await admin.cleanup();
  }
});
