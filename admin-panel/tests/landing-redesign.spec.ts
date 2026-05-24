import { test, expect } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';

const ABOUT_PATHS = ['/en/about', '/pl/about'] as const;

const SECTIONS = [
  'hero',
  'social-proof',
  'fee-comparison',
  'features',
  'embed-demo',
  'use-cases',
  'tax',
  'how-it-works',
  'self-hosted',
  'tech-stack',
  'license-tier',
  'faq',
  'final-cta',
] as const;

for (const path of ABOUT_PATHS) {
  test.describe(`landing redesign — ${path}`, () => {
    test.beforeEach(async ({ page }) => {
      await acceptAllCookies(page);
      await page.goto(path, { waitUntil: 'domcontentloaded' });
    });

    test('renders all 13 marked sections', async ({ page }) => {
      for (const name of SECTIONS) {
        const section = page.locator(`[data-landing-section="${name}"]`).first();
        await section.scrollIntoViewIfNeeded();
        await expect(section).toBeVisible();
      }
    });

    test('hero revenue badge updates after slider input change', async ({ page }) => {
      const slider = page
        .locator('[data-landing-section="fee-comparison"] input[type="range"]')
        .first();
      await slider.scrollIntoViewIfNeeded();
      await slider.evaluate((el) => {
        const input = el as HTMLInputElement;
        input.value = '20000';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      const hero = page.locator('[data-landing-section="hero"]').first();
      await hero.scrollIntoViewIfNeeded();
      const badge = hero.locator('[data-revenue-badge="active"]').first();
      await expect(badge).toBeVisible();
    });

    test('feature snippet flip toggles aria-expanded', async ({ page }) => {
      const flipCards = page.locator(
        '[data-landing-section="features"] button[aria-expanded]',
      );
      const first = flipCards.first();
      await first.scrollIntoViewIfNeeded();
      await expect(first).toHaveAttribute('aria-expanded', 'false');
      await first.click();
      await expect(first).toHaveAttribute('aria-expanded', 'true');
    });

    test('embed demo skeleton appears after Run click', async ({ page }) => {
      const section = page.locator('[data-landing-section="embed-demo"]').first();
      await section.scrollIntoViewIfNeeded();
      const runBtn = section.locator('[data-action="run-snippet"]').first();
      await runBtn.click();
      const skeleton = section
        .locator('[data-checkout-state="loaded"]')
        .first();
      await expect(skeleton).toBeVisible({ timeout: 3000 });
    });

    test('embed copy button writes snippet to clipboard', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const section = page.locator('[data-landing-section="embed-demo"]').first();
      await section.scrollIntoViewIfNeeded();
      await section.locator('[data-action="copy-snippet"]').first().click();
      const value = await page.evaluate(() => navigator.clipboard.readText());
      expect(value).toContain('embed/v1/checkout.js');
    });

    test('webhook timeline eventually lights all ticks', async ({ page }) => {
      const section = page.locator('[data-landing-section="how-it-works"]').first();
      await section.scrollIntoViewIfNeeded();
      // HowItWorks renders mobile + desktop step bodies side-by-side in DOM
      // (Tailwind md:hidden / hidden md:flex). Scope to visible to get the one
      // rendering at this viewport.
      const ticks = section.locator('[role="img"][aria-label*="webhook step"]:visible');
      await expect(ticks).toHaveCount(3);
      await expect(ticks.nth(2)).toHaveAttribute('data-state', 'lit', {
        timeout: 5000,
      });
    });

    test('Pro license column carries the shimmer flag', async ({ page }) => {
      const section = page.locator('[data-landing-section="license-tier"]').first();
      await section.scrollIntoViewIfNeeded();
      const proColumn = section.locator('[data-tier="pro"]').first();
      await expect(proColumn).toHaveAttribute('data-shimmer', 'true');
    });
  });
}
