/** Fresh browser navigation through the canonical locale routes. */
import { expect, test } from '@playwright/test';
import { createTestAdmin, createTestUser } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import en from '../src/messages/en.json';
import pl from '../src/messages/pl.json';

for (const path of ['/login', '/en/login', '/pl/login']) {
  test(`${path} reaches the login form`, async ({ page }) => {
    const navigations: number[] = [];
    page.on('response', response => {
      if (response.request().isNavigationRequest()) navigations.push(response.status());
    });
    const response = await page.goto(`${path}?redirect_to=%2Fmy-products`);
    expect(response?.status()).toBe(200);
    expect(navigations.filter(status => status >= 300 && status < 400).length).toBeLessThanOrEqual(1);
    await expect(page).toHaveURL(new RegExp(`${path === '/pl/login' ? '/pl' : ''}/login\\?redirect_to=%2Fmy-products$`));
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
}

for (const locale of ['en', 'pl'] as const) {
  test(`${locale}: guest partner receives guidance for the configured login method`, async ({ page, request }) => {
    const config = await (await request.get('/api/runtime-config')).json();
    const messages = locale === 'pl' ? pl : en;
    const key = config.demoMode ? 'demoLoginHint' : config.passwordLoginEnabled ? 'passwordLoginHint' : config.oauthProviders.length ? 'oauthLoginHint' : 'magicLinkLoginHint';
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/${locale}/affiliates/apply`);
    await expect(page).toHaveURL(/\/login\?redirect_to=/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(messages.affiliates.admin.joinTitle);
    await expect(page.getByText(messages.auth[key], { exact: true })).toBeVisible();
    await expect(page.getByText(messages.affiliates.admin.joinHint, { exact: true })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(config.passwordLoginEnabled ? 1 : 0);
    if (config.oauthProviders.includes('google')) await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(config.passwordLoginEnabled ? 0 : 1);
    await expect(page.getByRole('button', { name: config.passwordLoginEnabled ? messages.auth.signIn : messages.auth.sendMagicLink, exact: true })).toBeVisible();
    for (const width of [390, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/private/tmp/rcr2-login-${locale}-${key}-${width}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });
}

for (const locale of ['en', 'pl'] as const) {
  test(`${locale}: buyer login uses shop name and buyer guidance`, async ({ page, request }) => {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await db.from('shop_config').select('shop_name').single();
    expect(error).toBeNull();
    const config = await (await request.get('/api/runtime-config')).json();
    await page.goto(`/${locale}/login`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(data!.shop_name);
    if (config.passwordLoginEnabled && !config.demoMode) {
      await expect(page.getByText(locale === 'pl' ? 'Zaloguj się, aby uzyskać dostęp do swoich zakupów.' : 'Sign in to access your purchases.', { exact: true })).toBeVisible();
    }
  });
  test(`${locale}: dashboard entry keeps panel login heading`, async ({ page }) => {
    await page.goto(`/${locale}/dashboard/products`);
    await expect(page).toHaveURL(/\/login\?redirect_to=/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText((locale === 'pl' ? pl : en).auth.title);
  });
}

for (const role of ['buyer', 'admin'] as const) {
  test(`${role} can sign in through the login form`, async ({ page }) => {
    const user = await (role === 'admin' ? createTestAdmin('login-panel') : createTestUser('login-buyer'));
    try {
      await acceptAllCookies(page);
      await page.goto(role === 'admin' ? '/login?redirect_to=%2Fdashboard' : '/login');
      await page.locator('input[type="email"]').fill(user.email);
      await page.locator('input[type="password"]').fill(user.password);
      await page.getByRole('button', { name: en.auth.signIn, exact: true }).click();
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      expect((await page.request.get('/api/refund-requests')).status()).toBe(200);
      if (role === 'admin') await expect(page).toHaveURL(/\/dashboard/);
    } finally {
      await user.cleanup();
    }
  });
}
