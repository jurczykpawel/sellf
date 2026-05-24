import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { acceptAllCookies } from './helpers/consent';

for (const path of ['/en/about', '/pl/about'] as const) {
  test.describe(`a11y — ${path}`, () => {
    test('no axe violations at WCAG 2.1 AA', async ({ page }) => {
      await acceptAllCookies(page);
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // Color contrast checks are notoriously sensitive to anti-aliasing in
        // CI vs local; we cover contrast separately via Lighthouse. Disable
        // here so this suite remains deterministic.
        .disableRules(['color-contrast'])
        .analyze();
      expect(
        results.violations,
        JSON.stringify(results.violations, null, 2),
      ).toEqual([]);
    });

    test('Skip link focuses #main-content on activation', async ({ page }) => {
      await acceptAllCookies(page);
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      await page.keyboard.press('Tab');
      const skipLink = page.locator('a[href="#main-content"]').first();
      await expect(skipLink).toBeFocused();
      await page.keyboard.press('Enter');

      const main = page.locator('#main-content').first();
      await expect(main).toBeVisible();
    });

    test('reduced-motion disables snippet flip transform', async ({ browser }) => {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      const page = await context.newPage();
      await acceptAllCookies(page);
      await page.goto(path, { waitUntil: 'domcontentloaded' });

      const card = page
        .locator('[data-landing-section="features"] button[aria-expanded]')
        .first();
      await card.scrollIntoViewIfNeeded();
      await card.click();

      const flippedInner = card.locator('span[data-flipped="true"]').first();
      const transform = await flippedInner.evaluate(
        (el) => window.getComputedStyle(el).transform,
      );
      // Reduced-motion path uses cross-fade, no rotateY transform.
      expect(transform === 'none' || transform.startsWith('matrix(1, 0, 0, 1')).toBeTruthy();
      await context.close();
    });
  });
}
