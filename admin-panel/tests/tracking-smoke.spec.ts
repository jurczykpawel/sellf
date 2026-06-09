/**
 * Browser smoke for the 2026-06 tracking fixes:
 *
 *  - GTM: gtm.js must load from googletagmanager.com, NEVER from the
 *    server-side container URL (gtm_server_container_url) which is a
 *    transport-only endpoint and returns HTTP 400 for gtm.js.
 *  - Umami: loads with auto-tracking OFF (data-auto-track="false") and fires
 *    page views MANUALLY, skipping the admin panel (/dashboard) so it can't
 *    count admin self-traffic via the persistent SPA runtime.
 *  - cookieconsent: rendered inside an isolated #sf-cc-root (the `root` option)
 *    so its DOM stays out of React's App-Router <body> reconciliation, which
 *    previously threw `NotFoundError: removeChild`.
 *
 * Third-party scripts are stubbed via page.route so the test makes no real
 * network calls and can observe exactly what the app requests / invokes.
 */
import { test, expect, Page } from '@playwright/test';
import { supabaseAdmin, createTestAdmin, setAuthSession } from './helpers/admin-auth';
import { clearConsent } from './helpers/consent';

// Shared singleton integrations_config row (id=1) — run serially.
test.describe.configure({ mode: 'serial' });

const GTM_ID = 'GTM-SMOKE01';
const UMAMI_ID = '3a14bbb3-0000-4000-8000-0000000000aa'; // valid UUID shape
const UMAMI_SRC = 'https://umami-smoke.example/script.js';
const SGTM_URL = 'https://sgtm-smoke.example'; // transport-only; must never serve gtm.js

async function setConfig(overrides: Record<string, unknown>) {
  await supabaseAdmin.from('integrations_config').upsert({
    id: 1,
    gtm_container_id: GTM_ID,
    gtm_server_container_url: SGTM_URL,
    umami_website_id: UMAMI_ID,
    umami_script_url: UMAMI_SRC,
    facebook_pixel_id: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  });
}

async function resetConfig() {
  await supabaseAdmin
    .from('integrations_config')
    .update({
      gtm_container_id: null,
      gtm_server_container_url: null,
      umami_website_id: null,
      umami_script_url: null,
      facebook_pixel_id: null,
      cookie_consent_enabled: true,
    })
    .eq('id', 1);
}

/**
 * Intercept the third-party scripts. Records which host served gtm.js and
 * installs a tiny Umami stub that records every track() call by pathname.
 */
async function stubThirdParty(page: Page) {
  const gtmHosts: string[] = [];
  await page.route('**/gtm.js*', (route) => {
    gtmHosts.push(new URL(route.request().url()).host);
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
  await page.route(`${UMAMI_SRC}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body:
        'window.__umamiTracks=window.__umamiTracks||[];' +
        'window.umami={track:function(){window.__umamiTracks.push(location.pathname);}};',
    }),
  );
  return { gtmHosts };
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test.describe('tracking smoke — Umami + GTM loaders (consent off)', () => {
  test.beforeAll(() => setConfig({ cookie_consent_enabled: false }));
  test.afterAll(() => resetConfig());

  test('gtm.js loads from googletagmanager.com, never from the sGTM transport URL', async ({ page }) => {
    const { gtmHosts } = await stubThirdParty(page);
    await page.goto('/pl');

    await expect.poll(() => gtmHosts.length, { timeout: 15000 }).toBeGreaterThan(0);
    expect(gtmHosts).toContain('www.googletagmanager.com');
    expect(gtmHosts.some((h) => h.includes('sgtm-smoke.example'))).toBe(false);
  });

  test('Umami loads with auto-track OFF and fires a manual page view on public pages', async ({ page }) => {
    await stubThirdParty(page);
    await page.goto('/pl');

    const umami = page.locator('script#umami-script');
    await expect(umami).toHaveAttribute('data-auto-track', 'false');
    await expect(umami).toHaveAttribute('src', UMAMI_SRC);

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __umamiTracks?: string[] }).__umamiTracks ?? []), {
        timeout: 15000,
      })
      .toContain('/pl');
  });
});

test.describe('tracking smoke — admin panel excluded (consent off)', () => {
  let admin: Awaited<ReturnType<typeof createTestAdmin>>;

  test.beforeAll(async () => {
    await setConfig({ cookie_consent_enabled: false });
    admin = await createTestAdmin('smoke-track');
  });
  test.afterAll(async () => {
    await admin.cleanup();
    await resetConfig();
  });

  test('the admin dashboard loads no Umami script and records no page view', async ({ page }) => {
    await stubThirdParty(page);
    await setAuthSession(page, admin.email, admin.password);
    await page.goto('/pl/dashboard');
    await page.waitForSelector('nav, [role="navigation"], aside', { timeout: 20000 });

    await expect(page.locator('script#umami-script')).toHaveCount(0);
    const tracks = await page.evaluate(
      () => (window as unknown as { __umamiTracks?: string[] }).__umamiTracks ?? [],
    );
    expect(tracks.some((p) => p.includes('/dashboard'))).toBe(false);
  });
});

test.describe('tracking smoke — cookieconsent DOM isolation (consent on)', () => {
  test.beforeAll(() => setConfig({ cookie_consent_enabled: true, consent_logging_enabled: false }));
  test.afterAll(() => resetConfig());

  test('consent UI renders inside #sf-cc-root with no removeChild/insertBefore errors', async ({ page }) => {
    const errors = collectErrors(page);
    await stubThirdParty(page);
    await clearConsent(page); // fresh visitor → banner renders
    await page.goto('/pl');

    // The consent UI must live inside our isolated root, not directly under
    // <body>. `#cc-main` is a zero-size positioning wrapper (its visible child
    // is `.cm`), so assert it is ATTACHED, not visible.
    await page.waitForSelector('#sf-cc-root #cc-main', { state: 'attached', timeout: 20000 });
    const parentId = await page.evaluate(
      () => document.querySelector('#cc-main')?.parentElement?.id ?? null,
    );
    expect(parentId).toBe('sf-cc-root');

    // Re-mount to exercise React reconciliation around the library's nodes.
    await page.reload();
    await page.waitForSelector('#sf-cc-root #cc-main', { state: 'attached', timeout: 20000 });

    expect(errors.filter((e) => /NotFoundError|removeChild|insertBefore/i.test(e))).toEqual([]);
  });
});
