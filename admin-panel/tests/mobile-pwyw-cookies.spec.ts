/** Buyer locale state, consent access, and narrow settings regression coverage. */
import { test, expect } from '@playwright/test';
import { createTestAdmin, setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import en from '../src/messages/en.json';
import pl from '../src/messages/pl.json';

const slug = 'locale-amount-regression';
let productId: string;
let admin: Awaited<ReturnType<typeof createTestAdmin>>;
test.describe.configure({ mode: 'default' });
test.beforeEach(async ({ page }) => { page.setDefaultTimeout(10000); });
test.beforeAll(async () => {
  admin = await createTestAdmin('mobile-settings');
  const inserted = await supabaseAdmin.from('products').upsert({ name: 'Locale amount', slug, price: 19.99, currency: 'USD', is_active: true, allow_custom_price: true, custom_price_min: 0, show_price_presets: true, custom_price_presets: [0, 10, 19.99] }, { onConflict: 'slug' }).select('id').single();
  expect(inserted.error).toBeNull(); productId = inserted.data!.id;
  expect((await supabaseAdmin.from('integrations_config').upsert({ id: 1, cookie_consent_enabled: true })).error).toBeNull();
});
test.afterAll(async () => {
  if (productId) await supabaseAdmin.from('products').delete().eq('id', productId);
  await admin?.cleanup();
});

for (const locale of ['pl', 'en'] as const) {
  const messages = locale === 'pl' ? pl : en;
  test(`${locale}: all settings tabs fit 390px`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 390, height: 844 });
    await acceptAllCookies(page); await setAuthSession(page, admin.email, admin.password);
    await page.goto(`/${locale}/dashboard/settings`);
    for (const [id, tab] of Object.entries(messages.settings.tabs)) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      const headings: Record<string, string> = { shop: messages.settings.shop.title, payments: messages.settings.paymentMethods.title, legal: messages.settings.legal.title, license: messages.settings.license.title, system: messages.systemUpdate.settings.title };
      await expect(page.getByRole('heading', { name: headings[id], exact: true })).toBeVisible();
      if (id === 'payments') await expect(page.getByRole('button', { name: messages.settings.paymentMethods.recommended.reset, exact: true })).toBeVisible();
      if (id === 'system') await expect(page.getByText(messages.securityAudit.lastRun, { exact: false })).toBeVisible();
      await expect(page.locator('main .animate-spin')).toHaveCount(0);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) console.log('Overflow tab', id, await page.evaluate(() => [...document.querySelectorAll('main *')].map(el => ({ tag: el.tagName, text: el.textContent?.slice(0, 70), right: el.getBoundingClientRect().right })).filter(el => el.right > innerWidth).slice(-15)));
      await expect.poll(() => page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }))).toEqual({ document: 390, viewport: 390 });
    }
  });
}
for (const amount of ['0', '7,25']) {
  test(`language menu preserves PWYW ${amount} both ways`, async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/pl/p/${slug}?source=locale-test`);
    const input = page.locator('input[inputmode="decimal"]');
    if (amount === '0') await page.getByRole('button', { name: pl.checkout.customPrice.freePreset, exact: true }).click();
    else await input.fill(amount);
    for (const [locale, language, messages] of [['en', 'English', en], ['pl', 'Polski', pl]] as const) {
      await page.getByRole('button', { name: /menu/i }).click();
      await page.getByRole('menuitem', { name: new RegExp(language) }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(`${locale === 'en' ? '' : '/pl'}/p/${slug}`);
      await expect(page.getByRole('heading', { name: messages.checkout.customPrice.title, exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { name: messages.checkout.customPrice.title, exact: true })).toBeVisible();
      await expect(input).toHaveValue(amount === '0' ? '0' : /7[.,]25/);
      expect(new URL(page.url()).searchParams.get('source')).toBe('locale-test');
      if (amount === '0') await expect(page.getByText(messages.checkout.customPrice.getForFree, { exact: true })).toBeVisible();
      else await expect(page.getByTestId('order-summary-total')).toContainText(/7[.,]25/);
    }
  });
}
for (const locale of ['pl', 'en'] as const) {
  for (const decision of ['accept', 'reject'] as const) {
    test(`${locale}: footer reopens cookies after ${decision} on store and buyer pages`, async ({ page }) => {
      test.setTimeout(120000);
      await page.goto(`/${locale}`);
      const banner = page.locator('#cc-main .cm');
      await expect(banner).toBeVisible();
      await banner.locator(`[data-role="${decision === 'accept' ? 'all' : 'necessary'}"]`).click();
      await expect(banner).toBeHidden();
      for (const path of ['', `/p/${slug}`, '/login', '/privacy', '/terms', '/payment/error']) {
        await page.goto(path === '/payment/error' ? path : `/${locale}${path}`);
        const language = path === '/payment/error' ? 'en' : locale;
        const footerButton = page.locator('footer').getByRole('button', { name: language === 'pl' ? 'Preferencje ciasteczek' : 'Cookie preferences', exact: true });
        await expect(footerButton).toBeVisible();
        await footerButton.click();
        await expect(page.locator('#cc-main .pm')).toBeVisible();
        await page.locator('#cc-main .pm').getByRole('button', { name: language === 'pl' ? 'Zamknij' : 'Close', exact: true }).click();
        await expect(page.locator('#cc-main .pm')).toBeHidden();
      }
    });
  }
}
