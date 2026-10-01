import { test, expect } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';

const ABOUT_PATHS = ['/en/about', '/pl/about'] as const;

const SECTIONS = [
  'hero',
  'social-proof',
  'use-cases',
  'fee-comparison',
  'how-it-works',
  'conversion-stack',
  'license-tier',
  'features',
  'login-wall',
  'subscriptions-demo',
  'tax',
  'self-hosted',
  'tech-stack',
  'objections',
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
      const hero = page.locator('[data-landing-section="hero"]').first();
      const badge = hero.locator('[data-revenue-badge="active"]').first();

      // Retry the input events — under load they can fire before hydration attaches handlers.
      await expect(async () => {
        await slider.evaluate((el) => {
          const input = el as HTMLInputElement;
          input.value = '20000';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await hero.scrollIntoViewIfNeeded();
        await expect(badge).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 20000 });
    });

    test('feature snippet flip toggles aria-expanded', async ({ page }) => {
      const flipCards = page.locator(
        '[data-landing-section="features"] button[aria-expanded]',
      );
      const first = flipCards.first();
      await first.scrollIntoViewIfNeeded();
      await expect(first).toHaveAttribute('aria-expanded', 'false');
      // Retry the click — under load it can land before hydration attaches the handler.
      await expect(async () => {
        await first.click();
        await expect(first).toHaveAttribute('aria-expanded', 'true', { timeout: 2000 });
      }).toPass({ timeout: 20000 });
    });

    test('conversion stack: product → checkout (inline bump+coupon) → pay → OTO → done', async ({ page }) => {
      const section = page.locator('[data-landing-section="conversion-stack"]').first();
      await section.scrollIntoViewIfNeeded();

      // Stage 1: product → click Buy
      // Retry the click — under load it can land before hydration attaches the handler.
      await expect(async () => {
        await section.locator('[data-action="buy-now"]').click();
        await expect(section.locator('[data-stage-screen="checkout"]')).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 20000 });

      // Stage 2: checkout — bump inline
      await section.locator('[data-action="toggle-bump"]').check();
      await expect(section.locator('[data-cart-line="bump"]')).toBeVisible();

      // Stage 2: checkout — apply coupon via URL link (Sellf anti-hunting pattern)
      await section.locator('[data-action="apply-coupon-link"]').click();
      await expect(section.locator('[data-url-bar="with-coupon"]')).toBeVisible();
      await expect(section.locator('[data-coupon-state="auto-applied"]')).toBeVisible();
      await expect(section.locator('[data-cart-line="coupon"]')).toBeVisible();

      // Pay → success splash → OTO modal
      await section.locator('[data-action="pay-now"]').click();
      await expect(section.locator('[data-oto-state="open"]')).toBeVisible({ timeout: 2500 });

      // OTO decline → downsell → decline → done
      await section.locator('[data-action="oto-decline"]').click();
      await section.locator('[data-action="downsell-decline"]').click();
      await expect(section.locator('[data-action="replay"]')).toBeVisible();
    });

    test('login wall unlock reveals content and token fragment', async ({ page }) => {
      const section = page.locator('[data-landing-section="login-wall"]').first();
      await section.scrollIntoViewIfNeeded();
      await expect(section.locator('[data-wall-state="locked"]')).toBeVisible();
      // Retry the click — under load it can land before hydration attaches the handler.
      await expect(async () => {
        await section.locator('[data-action="unlock"]').click();
        await expect(section.locator('[data-wall-state="open"]')).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 20000 });
      await expect(section.locator('[data-token-fragment="present"]')).toBeVisible();
    });

    test('subscriptions timeline reveals all 14 months after play', async ({ page }) => {
      const section = page.locator('[data-landing-section="subscriptions-demo"]').first();
      await section.scrollIntoViewIfNeeded();
      // Retry the click — under load it can land before hydration attaches the handler.
      await expect(async () => {
        await section.locator('[data-action="play"]').click();
        await expect(section.locator('[data-action="pause"]')).toBeVisible({ timeout: 2000 });
      }).toPass({ timeout: 20000 });
      // Final month chip becomes data-revealed='true'
      await expect(
        section.locator('[data-month-idx="13"][data-revealed="true"]'),
      ).toBeVisible({ timeout: 15000 });
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
