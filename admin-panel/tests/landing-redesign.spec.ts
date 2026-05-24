import { test, expect } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';

const ABOUT_PATHS = ['/en/about', '/pl/about'] as const;

const SECTIONS = [
  'hero',
  'social-proof',
  'fee-comparison',
  'conversion-stack',
  'login-wall',
  'subscriptions-demo',
  'features',
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

    test('conversion stack walks product → bump → coupon → pay → OTO → done', async ({ page }) => {
      const section = page.locator('[data-landing-section="conversion-stack"]').first();
      await section.scrollIntoViewIfNeeded();

      // Stage: product → click Buy
      await section.locator('[data-action="buy-now"]').click();
      await expect(section.locator('[data-stage-screen="checkout"]')).toBeVisible();

      // checkout → next
      await section.locator('[data-action="checkout-next"]').click();

      // bump → tick it + verify cart updates
      await section.locator('[data-action="toggle-bump"]').check();
      await expect(section.locator('[data-cart-line="bump"]')).toBeVisible();
      await section.locator('[data-action="bump-next"]').click();

      // coupon → apply sample
      await section.locator('[data-action="coupon-apply"]').or(section.locator('button:has-text("FRIENDS50")')).first().click();
      await expect(section.locator('[data-cart-line="coupon"]')).toBeVisible();
      await section.locator('[data-action="coupon-next"]').click();

      // pay → success → OTO modal
      await section.locator('[data-action="pay-now"]').click();
      await expect(section.locator('[data-oto-state="open"]')).toBeVisible({ timeout: 2500 });

      // OTO decline → done
      await section.locator('[data-action="oto-decline"]').click();
      // either downsell or done
      await section
        .locator('[data-action="downsell-decline"]')
        .or(section.locator('[data-action="replay"]'))
        .first()
        .click();
    });

    test('login wall unlock reveals content and token fragment', async ({ page }) => {
      const section = page.locator('[data-landing-section="login-wall"]').first();
      await section.scrollIntoViewIfNeeded();
      await expect(section.locator('[data-wall-state="locked"]')).toBeVisible();
      await section.locator('[data-action="unlock"]').click();
      await expect(section.locator('[data-wall-state="open"]')).toBeVisible();
      await expect(section.locator('[data-token-fragment="present"]')).toBeVisible();
    });

    test('subscriptions timeline reveals all 14 months after play', async ({ page }) => {
      const section = page.locator('[data-landing-section="subscriptions-demo"]').first();
      await section.scrollIntoViewIfNeeded();
      await section.locator('[data-action="play"]').click();
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
