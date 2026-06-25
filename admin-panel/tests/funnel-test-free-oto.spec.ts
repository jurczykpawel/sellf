/**
 * E2E Tests: Funnel Test Preview — Free product with OTO
 *
 * The "Test Funnel" preview must work for FREE products too, not only paid
 * ones. A free product can have an OTO configured; an admin previewing the
 * funnel needs to see the funnel-test banner + a simulation button and, on
 * completing it, be carried into the OTO target checkout — without granting
 * real access to their own account.
 *
 * Regression: previously the free checkout (FreeProductForm) ignored
 * ?funnel_test=1 entirely and just rendered the normal "claim free product"
 * form, so the free→OTO funnel could not be previewed.
 *
 * @see admin-panel/src/app/[locale]/checkout/[slug]/components/FreeProductForm.tsx
 * @see admin-panel/src/app/[locale]/checkout/[slug]/components/ProductPurchaseView.tsx
 */

import { test, expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin, setAuthSession } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

test.describe('Funnel Test Preview: Free product + OTO', () => {
  test.describe.configure({ mode: 'serial', retries: 1 });
  test.setTimeout(60_000);

  let adminEmail: string;
  let adminPassword: string;
  let adminCleanup: () => Promise<void>;

  let freeMainSlug: string;
  let otoTargetSlug: string;
  let freeMainId: string;
  let otoTargetId: string;
  let otoOfferId: string;

  test.beforeAll(async () => {
    const admin = await createTestAdmin('funnel-free');
    adminEmail = admin.email;
    adminPassword = admin.password;
    adminCleanup = admin.cleanup;

    const ts = Date.now();

    // Free main product (price 0, not PWYW → renders FreeProductForm)
    freeMainSlug = `funnel-free-main-${ts}`;
    const { data: freeMain } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Funnel Free — Main',
        slug: freeMainSlug,
        price: 0,
        currency: 'PLN',
        description: 'Free product that has an OTO configured',
        is_active: true,
      })
      .select()
      .single();
    freeMainId = freeMain!.id;

    // Paid OTO target
    otoTargetSlug = `funnel-free-oto-target-${ts}`;
    const { data: otoTarget } = await supabaseAdmin
      .from('products')
      .insert({
        name: 'Funnel Free — OTO Target',
        slug: otoTargetSlug,
        price: 99,
        currency: 'PLN',
        description: 'Upsell offered after claiming the free product',
        is_active: true,
        vat_rate: 23,
        price_includes_vat: true,
      })
      .select()
      .single();
    otoTargetId = otoTarget!.id;

    const { data: otoOffer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: freeMainId,
        oto_product_id: otoTargetId,
        discount_type: 'percentage',
        discount_value: 30,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();
    otoOfferId = otoOffer!.id;
  });

  test.afterAll(async () => {
    if (otoOfferId) {
      await supabaseAdmin.from('oto_offers').delete().eq('id', otoOfferId);
    }
    for (const slug of [freeMainSlug, otoTargetSlug]) {
      if (slug) await supabaseAdmin.from('products').delete().eq('slug', slug);
    }
    await adminCleanup();
  });

  test('shows funnel test banner + simulation button on a free product', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto(`/checkout/${freeMainSlug}?funnel_test=1`, { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText('TEST LEJKA')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Podgląd checkoutu jako administrator/i)).toBeVisible();

    // Simulation button uses the free-specific label (not "Zapłać")
    await expect(page.getByRole('button', { name: /Odbierz.*symulacja/i })).toBeVisible();

    // The real free-claim controls must NOT drive the test preview
    await expect(page.getByRole('button', { name: /Wyślij magic link|Send magic link/i })).toHaveCount(0);
  });

  test('completing the simulation redirects into the OTO target checkout', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto(`/checkout/${freeMainSlug}?funnel_test=1`, { timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');

    const completeButton = page.getByRole('button', { name: /Odbierz.*symulacja/i });
    await expect(completeButton).toBeVisible({ timeout: 15000 });
    await completeButton.click();

    const goToProductBtn = page.getByRole('button', { name: /Przejdź do Produktu/i });
    await expect(goToProductBtn).toBeVisible({ timeout: 5000 });

    const urlPromise = page.waitForURL(new RegExp(`/checkout/${otoTargetSlug}`), { timeout: 15000, waitUntil: 'commit' });
    await goToProductBtn.click();
    await urlPromise;

    expect(page.url()).toContain(`/checkout/${otoTargetSlug}`);
    expect(page.url()).toContain('funnel_test=1');

    // No real access should have been granted to the admin's account
    const { data: access } = await supabaseAdmin
      .from('user_product_access')
      .select('id')
      .eq('product_id', freeMainId);
    expect(access ?? []).toHaveLength(0);
  });

  test('non-admin with funnel_test=1 sees the normal free claim form', async ({ page }) => {
    const nonAdminEmail = `non-admin-free-${Date.now()}@example.com`;
    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: nonAdminEmail,
      password: 'password123',
      email_confirm: true,
    });
    if (error) throw error;

    try {
      await acceptAllCookies(page);
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await setAuthSession(page, nonAdminEmail, 'password123');

      await page.goto(`/checkout/${freeMainSlug}?funnel_test=1`, { timeout: 60000 });
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('text="TEST LEJKA"')).toHaveCount(0, { timeout: 5000 });
      await expect(page.getByRole('button', { name: /Odbierz.*symulacja/i })).toHaveCount(0);
    } finally {
      await supabaseAdmin.auth.admin.deleteUser(user!.id);
    }
  });
});
