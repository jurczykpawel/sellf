/** Routed affiliate screens and private response contract. @see lib/affiliates/portal/service.ts */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setAuthSession } from './helpers/admin-auth';
import { createTestUser, supabaseAdmin } from './helpers/admin-auth';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
const member = 'af000000-0000-4000-a000-000000000001';
test('keeps affiliate pages and CSV private for signed-out visitors', async ({ request }) => {
  for (const path of ['/my-affiliate', '/affiliates/apply', '/dashboard/affiliates']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['x-robots-tag']).toContain('noindex');
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.headers().location).toContain('/login');
  }
  const csv = await request.get(`/api/affiliates/payouts/${member}/csv?version=1`);
  expect(csv.status()).toBe(401); expect(csv.headers()['cache-control']).toContain('no-store');
});
for (const locale of ['en', 'pl'] as const) for (const width of [1440, 390]) {
  test(`${locale} ${width} integrated partner and seller screens`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const screens = [
      ['admin', '/dashboard/affiliates', true],
      ['earnings', `/dashboard/affiliates/earnings?member=${member}`, true],
      ['payouts', '/dashboard/affiliates/payouts', true],
      ['portal', '/my-affiliate', false],
      ['apply', '/affiliates/apply', false],
    ] as const;
    for (const [name, path, admin] of screens) {
      await setAuthSession(page, admin ? 'demo@sellf.app' : 'buyer@demo.sellf.app', admin ? 'demo123' : 'demo1234');
      const response = await page.goto(`/${locale}${path}`);
      expect(response?.headers()['cache-control']).toContain('no-store');
      expect(response?.headers()['x-robots-tag']).toContain('noindex');
      for (const meta of await page.locator('meta[name="robots"]').all()) await expect(meta).toHaveAttribute('content', /noindex/);
      await expect(page.locator('main h1').first()).toBeVisible();
      if (name === 'payouts') { await expect(page.getByRole('combobox').first()).toHaveValue('Demo Partner'); await expect(page.locator('main dl').first()).toBeVisible(); }
      if (name === 'earnings') await expect(page.getByRole('combobox')).toHaveValue('Demo Partner');
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/a18-${name}-${locale}-${width}.png`, fullPage: true });
      // Limit axe to the delivered surface; the shared shell has its own regression coverage.
      const audit = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(audit.violations).toEqual([]);
      if (width === 390) {
        await page.setViewportSize({ width: 320, height: 1000 });
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; document.documentElement.classList.add('dark'); });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
        await page.setViewportSize({ width, height: 1000 });
      }
    }
  });
}
test('keeps admin earnings selection named and own portal independent of query identity', async ({ page }) => {
  await setAuthSession(page, 'demo@sellf.app', 'demo123');
  await page.goto('/dashboard/affiliates/earnings');
  const picker = page.getByRole('combobox');
  await picker.fill('Demo'); await expect(page.getByRole('option', { name: 'Demo Partner' })).toBeVisible();
  await picker.press('ArrowDown'); await picker.press('Enter');
  await expect(page).toHaveURL(new RegExp(`member=${member}`));
  await expect(page.getByRole('heading', { name: 'Partner earnings' })).toBeVisible();
  const user = await createTestUser('affiliate-route');
  try {
    await setAuthSession(page, user.email, user.password);
    await page.goto(`/my-affiliate?member=${member}`);
    await expect(page.getByRole('link', { name: 'Apply to become a partner' })).toBeVisible();
    await expect(page.getByText('PARTNER10')).toHaveCount(0);
    await page.goto('/dashboard/affiliates'); await expect(page).not.toHaveURL(/dashboard\/affiliates/);
  } finally { await user.cleanup(); }
});

for (const locale of ['en', 'pl'] as const) test(`${locale} saved coupon exposes named affiliate settings`, async ({ page }) => {
  const code = `A18UI${Date.now()}`;
  const coupon = await supabaseAdmin.from('coupons').insert({ code, discount_type: 'percentage', discount_value: 10, is_active: true }).select('id').single();
  expect(coupon.error).toBeNull();
  try {
    await setAuthSession(page, 'demo@sellf.app', 'demo123'); await page.goto(`/${locale}/dashboard/coupons`);
    const copy = locale === 'en' ? en : pl;
    await page.getByRole('row').filter({ hasText: code }).getByRole('button', { name: copy.admin.coupons.edit, exact: true }).click();
    await expect(page.getByRole('heading', { name: copy.affiliates.products.owner, exact: true })).toBeVisible();
    await expect(page.getByRole('combobox')).toBeVisible();
    expect(await page.locator('form form').count()).toBe(0);
  } finally { await supabaseAdmin.from('coupons').delete().eq('id', coupon.data!.id); }
});
