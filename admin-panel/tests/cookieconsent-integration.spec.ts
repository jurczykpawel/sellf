import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies, setConsentPreferences, clearConsent } from './helpers/consent';

/**
 * Smoke tests for cookieconsent (orestbida) wiring.
 *
 * Verifies that:
 *  - The banner renders when cookie_consent_enabled = true and no cookie is set.
 *  - The "accept all" path sets the consent cookie and unblocks managed scripts.
 *  - Reject path keeps managed scripts in `type="text/plain"` form.
 *  - acceptAllCookies/setConsentPreferences helpers produce a cookie shape that
 *    the in-app helpers (hasGTMConsent/hasFacebookConsent) recognise.
 *
 * Klaro is no longer on the page — these tests fail loudly if any Klaro
 * artefact survives the migration.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('cookieconsent integration', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    // Enable consent banner + ensure a tracking integration is configured so the
    // TrackingProvider has work to do. GTM ID format = GTM-XXXXXXX (uppercase A-Z0-9, 1-10 chars).
    await supabaseAdmin
      .from('integrations_config')
      .upsert({
        id: 1,
        cookie_consent_enabled: true,
        consent_logging_enabled: true,
        gtm_container_id: 'GTM-TEST123',
        facebook_pixel_id: '1234567890123',
        umami_website_id: '550e8400-e29b-41d4-a716-446655440000',
        updated_at: new Date().toISOString(),
      });
  });

  test.afterAll(async () => {
    // Restore default-ish state
    await supabaseAdmin
      .from('integrations_config')
      .update({
        gtm_container_id: null,
        gtm_server_container_url: null,
        facebook_pixel_id: null,
        umami_website_id: null,
        cookie_consent_enabled: true,
        consent_logging_enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
  });

  test('banner renders when no consent cookie is present', async ({ page }) => {
    await clearConsent(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // cookieconsent v3 toggles html.show--consent when the consent modal is on screen.
    await expect(page.locator('html.show--consent')).toBeAttached({ timeout: 10_000 });
    await expect(page.locator('#cc-main .cm')).toBeVisible({ timeout: 5_000 });
  });

  test('Klaro CDN is NOT loaded anywhere', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const klaroScripts = await page.locator('script[src*="kiprotect"], script[src*="klaro"]').count();
    expect(klaroScripts).toBe(0);

    const klaroGlobals = await page.evaluate(() =>
      Boolean((window as unknown as { klaro?: unknown }).klaro)
    );
    expect(klaroGlobals).toBe(false);
  });

  test('accept-all executes managed scripts (window.dataLayer + window.fbq)', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500); // let cookieconsent replace text/plain tags

    const probe = await page.evaluate(() => {
      const w = window as unknown as { dataLayer?: unknown[]; fbq?: unknown };
      return {
        hasDataLayer: Array.isArray(w.dataLayer),
        hasFbq: typeof w.fbq === 'function',
      };
    });
    expect(probe.hasDataLayer).toBe(true);
    expect(probe.hasFbq).toBe(true);
  });

  test('reject-all keeps managed scripts as text/plain', async ({ page }) => {
    await setConsentPreferences(page, { gtm: false, pixel: false, umami: false });
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const blocked = await page.locator('script[type="text/plain"][data-category]').count();
    expect(blocked).toBeGreaterThanOrEqual(1);
  });

  // ----- GDPR compliance posture -----

  test('compliance: no tracking globals exist before the user clicks accept', async ({ page }) => {
    // Fresh visitor — no consent cookie.
    await clearConsent(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200); // give the banner time to mount

    const probe = await page.evaluate(() => {
      const w = window as unknown as { dataLayer?: unknown[]; fbq?: unknown };
      return {
        // gtag('consent','default', ...) seeds dataLayer for Consent Mode V2,
        // but no analytics events / fbq function should exist yet.
        dataLayerLen: Array.isArray(w.dataLayer) ? w.dataLayer.length : -1,
        hasFbq: typeof w.fbq === 'function',
      };
    });
    // dataLayer may exist with consent defaults (denied) — that's allowed.
    // What must NOT happen: fbq function loaded (means pixel ran).
    expect(probe.hasFbq).toBe(false);
  });

  test('compliance: banner copy names the providers and storage durations', async ({ page }) => {
    await clearConsent(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);

    const banner = page.locator('#cc-main .cm');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    const text = (await banner.textContent()) ?? '';

    // Specific phrases that distinguish "informed consent" from generic copy.
    expect(text.toLowerCase()).toContain('analytics'); // or 'analityk' for pl
    // At least one provider name surfaced.
    expect(/(google|meta|umami|pixel)/i.test(text)).toBe(true);
    // Storage duration mentioned (months, days, miesi, dni).
    expect(/(month|day|miesi|dni)/i.test(text)).toBe(true);
  });

  test('compliance: banner renders in PL on /pl path', async ({ page }) => {
    await clearConsent(page);
    await page.goto('/pl');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('html.show--consent')).toBeAttached({ timeout: 10_000 });
    const text = (await page.locator('#cc-main .cm').textContent()) ?? '';
    expect(text).toMatch(/Używamy ciasteczek|niezbędne|Akceptuj/);
  });

  test('compliance: cookie preferences link in the marketing footer re-opens preferences', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto('/about');
    await page.waitForLoadState('networkidle');

    const link = page.locator('a[data-cc="show-preferencesModal"], button[data-cc="show-preferencesModal"]').first();
    await expect(link).toBeVisible({ timeout: 5_000 });

    // cookieconsent binds the show-preferencesModal handler during CookieConsent.run().
    // Wait until the run() effect resolved by polling for the global handle.
    await page.waitForFunction(
      () => Boolean((window as unknown as { CookieConsent?: unknown }).CookieConsent),
      null,
      { timeout: 5_000 },
    ).catch(() => { /* the lib may not expose a global; the click below is the real check */ });

    await link.click();
    await expect(page.locator('html.show--preferences')).toBeAttached({ timeout: 5_000 });
  });
});
