import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { affiliateAdminMessages } from '@/components/affiliates/admin/messages';
for (const locale of ['en', 'pl'] as const) for (const theme of ['light', 'dark']) for (const view of ['admin', 'apply']) for (const zoom of [1, 2]) {
  test(`${locale}/${theme}/${view}/zoom${zoom}: labels, keyboard, overflow and accessibility`, async ({ page }) => {
    await page.setViewportSize({ width: zoom === 1 ? 320 : 1280, height: 900 });
    await page.goto(`/tests/affiliates/admin/harness.html?locale=${locale}&theme=${theme}&view=${view}&zoom=${zoom}`);
    await expect(page.getByRole('heading', { name: affiliateAdminMessages[locale].title, exact: true })).toBeVisible();
    await expect(page.getByLabel(view === 'admin' ? affiliateAdminMessages[locale].status : affiliateAdminMessages[locale].code)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press('Tab'); await expect(page.locator(view === 'admin' ? 'summary' : 'input').first()).toBeFocused();
    expect(await page.locator(view === 'admin' ? 'summary' : 'input').first().evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
    if (view === 'admin') { await page.keyboard.press('Enter'); await expect(page.getByLabel(affiliateAdminMessages[locale].hold)).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true); }
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
  });
}

for (const locale of ['en', 'pl'] as const) for (const width of [1440, 390]) for (const view of ['admin', 'apply']) {
  test(`screenshots ${locale}/${width}/${view}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/tests/affiliates/admin/harness.html?locale=${locale}&theme=light&view=${view}`);
    await expect(page.getByRole('heading', { name: affiliateAdminMessages[locale].title, exact: true })).toBeVisible();
    await page.screenshot({ path: `/tmp/a1-2-${view}-${locale}-${width}.png`, fullPage: true });
    if (view === 'admin') { await page.getByText(affiliateAdminMessages[locale].settings, { exact: true }).click(); await page.screenshot({ path: `/tmp/a1-2-settings-${locale}-${width}.png`, fullPage: true }); }
  });
}

for (const locale of ['en', 'pl'] as const) for (const status of ['pending', 'approved', 'suspended']) {
  test(`status actions ${locale}/${status}`, async ({ page }) => {
    const t = affiliateAdminMessages[locale];
    await page.goto(`/tests/affiliates/admin/harness.html?locale=${locale}&theme=light&status=${status}`);
    const card = page.getByRole('article', { name: 'Partner A' });
    const visible = status === 'pending' ? [t.approved, t.rejected] : status === 'approved' ? [t.suspended, t.terminated] : [t.restore, t.terminated];
    for (const name of [t.approved, t.rejected, t.suspended, t.terminated, t.restore]) await expect(card.getByRole('button', { name, exact: true })).toHaveCount(visible.includes(name) ? 1 : 0);
    await expect(card.getByLabel(t.reason)).toHaveCount(0);
    const action = status === 'pending' ? t.rejected : t.terminated;
    await card.getByRole('button', { name: action, exact: true }).click();
    await expect(card.getByLabel(t.reason)).toBeFocused();
    await card.getByRole('button', { name: t.cancel }).click();
    await expect(card.getByLabel(t.reason)).toHaveCount(0);
    await expect(card.getByRole('button', { name: action, exact: true })).toBeFocused();
  });
}
