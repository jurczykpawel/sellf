import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

/**
 * Real-buyer-facing check for the generated legal document flow.
 *
 * Before this fix, `/terms`/`/privacy` redirected straight to the storage
 * object's own URL. Supabase Storage serves `text/html` as `text/plain`, so
 * a real buyer clicking "Terms" would see raw markup (`<h2>`, `<li>`, …) as
 * literal text — every test in tests/legal-documents-settings.spec.ts mocks
 * the redirect target away, so none of them caught this. This spec uploads a
 * REAL legal-engine document fixture to Storage and drives the actual page,
 * the same way a buyer would.
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 * @see src/app/[locale]/legal/[type]/page.tsx
 */

const FIXTURE_DIR = join(__dirname, 'fixtures/legal');
const BUCKET = 'legal';

test.describe('Generated legal document rendering', () => {
  let shopConfigId: string;
  let originalTermsUrl: string | null;

  test.beforeAll(async () => {
    const { data: shopConfig } = await supabaseAdmin
      .from('shop_config')
      .select('id, terms_of_service_url')
      .single();
    if (!shopConfig) throw new Error('shop_config row not found');
    shopConfigId = shopConfig.id;
    originalTermsUrl = shopConfig.terms_of_service_url;

    const html = readFileSync(join(FIXTURE_DIR, 'terms.pl.html'), 'utf8');
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(`${shopConfigId}/terms.html`, new Blob([html], { type: 'text/html' }), {
        contentType: 'text/html',
        upsert: true,
      });
    if (uploadError) throw uploadError;

    await supabaseAdmin
      .from('shop_config')
      .update({ terms_of_service_url: '/legal/terms' })
      .eq('id', shopConfigId);
  });

  test.afterAll(async () => {
    await supabaseAdmin
      .from('shop_config')
      .update({ terms_of_service_url: originalTermsUrl })
      .eq('id', shopConfigId);
    await supabaseAdmin.storage.from(BUCKET).remove([`${shopConfigId}/terms.html`]);
  });

  test('/terms shows a real heading and no raw markup as visible text', async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto('/terms');
    await page.waitForLoadState('domcontentloaded');

    await expect(
      page.getByRole('heading', { name: 'Regulamin sklepu internetowego', level: 1 }),
    ).toBeVisible();

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('<h2>');
    expect(bodyText).not.toContain('&lt;h2&gt;');
    expect(bodyText).not.toContain('<li>');
    expect(bodyText).not.toContain('<strong>');

    // A real section heading from the document rendered as an actual <h2>.
    await expect(page.getByRole('heading', { name: '§ 1. Słownik pojęć', level: 2 })).toBeVisible();
  });

  test('free-product checkout "Regulamin" link opens the readable document, not raw markup', async ({ page }) => {
    await acceptAllCookies(page);
    const response = await page.request.get('/terms', { maxRedirects: 0 });
    // /terms redirects (307) to the relative /legal/terms page path.
    expect(response.status()).toBe(307);
    expect(response.headers()['location']).toBe('/legal/terms');
  });
});

test.describe('/polityka-prywatnosci legacy redirect', () => {
  test('redirects to /privacy', async ({ page }) => {
    const response = await page.request.get('/polityka-prywatnosci', { maxRedirects: 0 });
    expect([307, 308]).toContain(response.status());
    expect(response.headers()['location']).toBe('/privacy');
  });
});
