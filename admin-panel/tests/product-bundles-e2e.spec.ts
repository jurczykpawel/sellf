/**
 * Capstone E2E: Product Bundles
 *
 * End-to-end coverage of the buyer-facing + admin surfaces for product bundles.
 * A bundle is a product (is_bundle=true) whose `bundle_items` reference component
 * products; buying the bundle grants user_product_access for the bundle AND every
 * component. This spec exercises the whole loop:
 *
 *   1. Admin creates a bundle in the wizard UI (two seeded components, price below
 *      the component sum) and publishes it (checklist passes). Asserts the live
 *      savings anchor shows.
 *   2. Access: a buyer "completes" a bundle purchase — driven deterministically via
 *      the real completion RPC (`process_stripe_payment_completion_with_bump`, the
 *      exact path the Stripe webhook calls) rather than live Stripe Elements, which
 *      is unmockable here (see checkout-payment-e2e.spec.ts notes). The buyer then
 *      visits the bundle /p/[slug] and sees "includes" links to each component, and
 *      each component /p/[slug] renders content (not redirected to /checkout).
 *   3. Bump on a bundle: an order_bump with the bundle as the main product renders
 *      on the bundle's checkout page.
 *
 * Why the purchase is seeded via RPC, not real Stripe: the sibling payment E2E
 * suites all simulate completed payments through the same RPC / grant functions
 * (payment-access-flow.spec.ts, bundle-completion.behavioral.test.ts) because
 * mocking Stripe Elements is unreliable. Using the real completion RPC keeps the
 * grant path (bundle + components) under test while staying deterministic.
 *
 * OTO note: the broader suite does not exercise OTO success_redirect_url in a
 * deterministic-without-Stripe way, so OTO redirect is intentionally NOT asserted
 * here (documented in the task report).
 *
 * @see admin-panel/src/app/api/public/products/[slug]/content/route.ts (bundleComponents)
 * @see admin-panel/src/app/[locale]/p/[slug]/components/ProductAccessView.tsx (includes section)
 * @see admin-panel/src/app/[locale]/checkout/[slug]/components/BundleContentsPreview.tsx
 * @see admin-panel/src/components/ProductFormModal/sections/BundleItemsSection.tsx
 * @see supabase/migrations/20260625000000_product_bundles.sql
 */

import { test, expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

test.describe('Product Bundles E2E', () => {
  test.describe.configure({ mode: 'serial', retries: 1 });
  test.setTimeout(90_000);

  const ts = Date.now();

  let adminEmail: string;
  let adminPassword: string;
  let adminCleanup: () => Promise<void>;

  // Component products (seeded). USD to match the wizard's default currency so the
  // admin-creates-bundle test computes a coherent savings anchor.
  const componentAName = `Bundle Component A ${ts}`;
  const componentBName = `Bundle Component B ${ts}`;
  const componentASlug = `bundle-comp-a-${ts}`;
  const componentBSlug = `bundle-comp-b-${ts}`;
  let componentAId: string;
  let componentBId: string;

  // Pre-built bundle (seeded directly) used by the Access + Bump tests.
  const bundleName = `Test Bundle ${ts}`;
  const bundleSlug = `test-bundle-${ts}`;
  let bundleId: string;

  // Bump product for the bundle-checkout bump test.
  const bumpProductName = `Bundle Bump Product ${ts}`;
  const bumpProductSlug = `bundle-bump-${ts}`;
  let bumpProductId: string;
  let orderBumpId: string;

  // Bundle created via the admin UI (cleaned up by slug match in afterAll).
  const uiBundleName = `UI Bundle ${ts}`;
  let uiBundleSlug: string | undefined;

  // Buyer who "owns" the seeded bundle.
  let buyerEmail: string;
  let buyerPassword: string;
  let buyerId: string;

  test.beforeAll(async () => {
    const admin = await createTestAdmin('bundles-e2e');
    adminEmail = admin.email;
    adminPassword = admin.password;
    adminCleanup = admin.cleanup;

    // --- Two component products (real digital content so access view renders) ---
    const componentContent = (label: string) => ({
      content_items: [
        { id: 'item-1', type: 'download_link', label, url: 'https://example.com/file.pdf', is_active: true },
      ],
    });

    const { data: compA, error: eA } = await supabaseAdmin
      .from('products')
      .insert({
        name: componentAName,
        slug: componentASlug,
        price: 80,
        currency: 'USD',
        description: 'First bundle component',
        icon: '📘',
        is_active: true,
        content_delivery_type: 'content',
        content_config: componentContent('Component A file'),
      })
      .select('id')
      .single();
    if (eA) throw new Error(`Failed to seed component A: ${eA.message}`);
    componentAId = compA!.id;

    const { data: compB, error: eB } = await supabaseAdmin
      .from('products')
      .insert({
        name: componentBName,
        slug: componentBSlug,
        price: 60,
        currency: 'USD',
        description: 'Second bundle component',
        icon: '📗',
        is_active: true,
        content_delivery_type: 'content',
        content_config: componentContent('Component B file'),
      })
      .select('id')
      .single();
    if (eB) throw new Error(`Failed to seed component B: ${eB.message}`);
    componentBId = compB!.id;

    // --- Pre-built bundle (price < component sum 140) + its bundle_items ---
    const { data: bundle, error: eBundle } = await supabaseAdmin
      .from('products')
      .insert({
        name: bundleName,
        slug: bundleSlug,
        price: 99,
        currency: 'USD',
        description: 'A pre-built test bundle',
        icon: '🎁',
        is_active: true,
        is_bundle: true,
        content_delivery_type: 'content',
        content_config: { content_items: [] },
      })
      .select('id')
      .single();
    if (eBundle) throw new Error(`Failed to seed bundle: ${eBundle.message}`);
    bundleId = bundle!.id;

    const { error: eItems } = await supabaseAdmin.from('bundle_items').insert([
      { bundle_product_id: bundleId, component_product_id: componentAId, display_order: 0 },
      { bundle_product_id: bundleId, component_product_id: componentBId, display_order: 1 },
    ]);
    if (eItems) throw new Error(`Failed to seed bundle_items: ${eItems.message}`);

    // --- Bump product + order_bump for the bundle checkout ---
    const { data: bumpProduct, error: eBump } = await supabaseAdmin
      .from('products')
      .insert({
        name: bumpProductName,
        slug: bumpProductSlug,
        price: 40,
        currency: 'USD',
        description: 'Add-on for the bundle',
        icon: '➕',
        is_active: true,
      })
      .select('id')
      .single();
    if (eBump) throw new Error(`Failed to seed bump product: ${eBump.message}`);
    bumpProductId = bumpProduct!.id;

    const { data: orderBump, error: eOrderBump } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        main_product_id: bundleId,
        bump_product_id: bumpProductId,
        bump_title: `Bundle Bump Offer ${ts}`,
        bump_price: 25,
        is_active: true,
        display_order: 1,
      })
      .select('id')
      .single();
    if (eOrderBump) throw new Error(`Failed to seed order_bump: ${eOrderBump.message}`);
    orderBumpId = orderBump!.id;

    // --- Buyer account ---
    buyerEmail = `bundle-buyer-${ts}@example.com`;
    buyerPassword = 'password123';
    const { data: buyer, error: eBuyer } = await supabaseAdmin.auth.admin.createUser({
      email: buyerEmail,
      password: buyerPassword,
      email_confirm: true,
    });
    if (eBuyer || !buyer?.user) throw eBuyer ?? new Error('Failed to create buyer');
    buyerId = buyer.user.id;

    // --- Simulate a completed bundle purchase deterministically (no live Stripe) ---
    // Drives the SAME RPC the Stripe webhook calls; it grants the bundle + every
    // component via grant_product_and_bundle_components. Session id must match the
    // RPC contract ^(cs_|pi_)[a-zA-Z0-9_]+$ — strip uuid hyphens.
    // Reset the per-function rate-limit buckets first (shared global anti-spoof
    // buckets can trip during a full suite run; mirrors bundle-completion.behavioral.test.ts).
    await supabaseAdmin.from('rate_limits').delete().like('function_name', '%process_stripe_payment_completion');
    const sessionId = `cs_${crypto.randomUUID().replace(/-/g, '')}`;
    const { data: completion, error: eCompletion } = await supabaseAdmin.rpc(
      'process_stripe_payment_completion_with_bump',
      {
        session_id_param: sessionId,
        product_id_param: bundleId,
        customer_email_param: buyerEmail,
        amount_total: 9900,
        currency_param: 'usd',
        stripe_payment_intent_id: `pi_${crypto.randomUUID().replace(/-/g, '')}`,
        user_id_param: buyerId,
        bump_product_ids_param: null,
        coupon_id_param: null,
        amount_subtotal_param: 9900,
      },
    );
    if (eCompletion) throw new Error(`Completion RPC failed: ${eCompletion.message}`);
    expect((completion as { success?: boolean }).success).toBe(true);

    // Sanity: the buyer must own the bundle + both components before the UI tests run.
    const { data: access } = await supabaseAdmin
      .from('user_product_access')
      .select('product_id')
      .eq('user_id', buyerId);
    const owned = new Set((access ?? []).map((r) => r.product_id));
    expect(owned.has(bundleId)).toBe(true);
    expect(owned.has(componentAId)).toBe(true);
    expect(owned.has(componentBId)).toBe(true);
  });

  test.afterAll(async () => {
    // Order matters: bump → order_bumps → bundle_items (FK RESTRICT on component) →
    // access/transactions/line-items → products → users.
    if (orderBumpId) await supabaseAdmin.from('order_bumps').delete().eq('id', orderBumpId);
    await supabaseAdmin.from('order_bumps').delete().eq('main_product_id', bundleId);

    const productIds = [bundleId, componentAId, componentBId, bumpProductId].filter(Boolean);

    // Delete bundle_items BEFORE products (component_product_id FK is RESTRICT).
    if (bundleId) await supabaseAdmin.from('bundle_items').delete().eq('bundle_product_id', bundleId);
    // UI-created bundle items too (resolve by slug → id).
    if (uiBundleSlug) {
      const { data: uiBundle } = await supabaseAdmin.from('products').select('id').eq('slug', uiBundleSlug).maybeSingle();
      if (uiBundle?.id) {
        await supabaseAdmin.from('order_bumps').delete().eq('main_product_id', uiBundle.id);
        await supabaseAdmin.from('bundle_items').delete().eq('bundle_product_id', uiBundle.id);
      }
    }

    if (buyerId) {
      await supabaseAdmin.from('payment_line_items').delete().in('product_id', productIds);
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', buyerId);
      await supabaseAdmin.from('payment_transactions').delete().in('product_id', productIds);
    }

    for (const id of productIds) {
      await supabaseAdmin.from('products').delete().eq('id', id);
    }
    if (uiBundleSlug) await supabaseAdmin.from('products').delete().eq('slug', uiBundleSlug);

    if (buyerId) await supabaseAdmin.auth.admin.deleteUser(buyerId).catch(() => {});
    await adminCleanup();
  });

  // =========================================================================
  // 1. Admin creates a bundle in the wizard UI
  // =========================================================================

  test('admin creates and publishes a bundle (savings anchor shows)', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/pl/dashboard/products', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await expect(page.locator('table')).toBeVisible({ timeout: 15000 });

    // Open the wizard via the "Nowy zestaw" (New bundle) entry point.
    await page.locator('button[title="Nowy zestaw"]').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Utwórz nowy produkt')).toBeVisible({ timeout: 10000 });

    // --- Step 1: essentials. Name + price (below the 140 component sum). ---
    await dialog.locator('input#name').fill(uiBundleName);
    // Slug auto-generates from name; capture it for content/cleanup.
    await expect(dialog.locator('input#slug')).not.toHaveValue('', { timeout: 5000 });
    uiBundleSlug = await dialog.locator('input#slug').inputValue();
    await dialog.locator('input#price').fill('99');

    // Advance to step 2 (where the bundle component picker lives). Scope to the
    // dialog — a pagination control on the products page also has a "Dalej" button.
    await dialog.getByRole('button', { name: 'Dalej' }).click();
    await expect(dialog.locator('input#bundle-search')).toBeVisible({ timeout: 10000 });

    // --- Step 2: add both seeded components via the picker. ---
    const addComponent = async (name: string) => {
      await dialog.locator('input#bundle-search').fill(name);
      await dialog.getByRole('button', { name: new RegExp(name) }).first().click();
    };
    await addComponent(componentAName);
    await addComponent(componentBName);

    // Both components appear in the "Wybrane składniki (2)" selected list.
    await expect(dialog.getByText('Wybrane składniki (2)')).toBeVisible({ timeout: 5000 });

    // Live savings anchor: bundle 99 < 140 components → "oszczędzasz ... (...%)".
    await expect(dialog.getByText(/oszczędzasz/i)).toBeVisible({ timeout: 5000 });

    // The publish checklist's bundle-components item must be satisfied.
    await expect(
      dialog.locator('[data-checklist-key="bundle-components"]'),
    ).toHaveAttribute('data-checklist-ok', 'true', { timeout: 5000 });

    // --- Publish (checklist passes → ⚡ Publikuj enabled). ---
    const publishButton = dialog.getByRole('button', { name: /Publikuj/ });
    await expect(publishButton).toBeEnabled({ timeout: 5000 });
    await publishButton.click();

    // Success toast confirms creation.
    await expect(page.getByText(/został pomyślnie utworzony/i)).toBeVisible({ timeout: 15000 });

    // Persisted as a bundle with two components.
    await expect.poll(async () => {
      const { data } = await supabaseAdmin
        .from('products')
        .select('id, is_bundle')
        .eq('slug', uiBundleSlug!)
        .maybeSingle();
      return data?.is_bundle ?? false;
    }, { timeout: 10000 }).toBe(true);

    const { data: uiBundle } = await supabaseAdmin
      .from('products')
      .select('id')
      .eq('slug', uiBundleSlug!)
      .single();
    const { data: items } = await supabaseAdmin
      .from('bundle_items')
      .select('component_product_id')
      .eq('bundle_product_id', uiBundle!.id);
    const componentIds = new Set((items ?? []).map((i) => i.component_product_id));
    expect(componentIds.has(componentAId)).toBe(true);
    expect(componentIds.has(componentBId)).toBe(true);
  });

  // =========================================================================
  // 2. Access — buyer owns the bundle + both components
  // =========================================================================

  test('buyer sees bundle includes-links to each component on the bundle page', async ({ page }) => {
    await loginAsAdmin(page, buyerEmail, buyerPassword); // reuses session helper (not admin-specific)
    await page.goto(`/pl/p/${bundleSlug}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Stays on the bundle product page (access granted, not redirected to checkout).
    await expect(page).toHaveURL(new RegExp(`/p/${bundleSlug}`), { timeout: 15000 });
    expect(page.url()).not.toContain('/checkout/');

    // The "This bundle includes:" section renders with a link per component.
    const includes = page.locator('[data-testid="bundle-includes"]');
    await expect(includes).toBeVisible({ timeout: 15000 });
    await expect(includes.getByText(componentAName)).toBeVisible();
    await expect(includes.getByText(componentBName)).toBeVisible();

    // Each component link points at its own product page.
    await expect(includes.locator(`a[href="/pl/p/${componentASlug}"]`)).toBeVisible();
    await expect(includes.locator(`a[href="/pl/p/${componentBSlug}"]`)).toBeVisible();
  });

  test('content API returns bundleComponents for the bundle and [] for a component', async ({ page }) => {
    // Drives the public content route directly (the client-fetch path) using the
    // buyer's authenticated session, exercising the route's bundle branch.
    await loginAsAdmin(page, buyerEmail, buyerPassword);

    // Bundle → bundleComponents lists both components (name/icon/slug).
    const bundleRes = await page.request.get(`/api/public/products/${bundleSlug}/content`);
    expect(bundleRes.ok()).toBe(true);
    const bundleJson = await bundleRes.json();
    expect(Array.isArray(bundleJson.bundleComponents)).toBe(true);
    const slugs = (bundleJson.bundleComponents as Array<{ slug: string }>).map((c) => c.slug);
    expect(slugs).toContain(componentASlug);
    expect(slugs).toContain(componentBSlug);

    // Component (non-bundle) → bundleComponents is [].
    const componentRes = await page.request.get(`/api/public/products/${componentASlug}/content`);
    expect(componentRes.ok()).toBe(true);
    const componentJson = await componentRes.json();
    expect(componentJson.bundleComponents).toEqual([]);
  });

  test('buyer can open component A (content renders, not redirected to checkout)', async ({ page }) => {
    await loginAsAdmin(page, buyerEmail, buyerPassword);
    await page.goto(`/pl/p/${componentASlug}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await expect(page).toHaveURL(new RegExp(`/p/${componentASlug}`), { timeout: 15000 });
    expect(page.url()).not.toContain('/checkout/');

    // Component is NOT a bundle → no "includes" section, but content renders.
    await expect(page.getByRole('heading', { name: componentAName })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="bundle-includes"]')).toHaveCount(0);
  });

  test('buyer can open component B (content renders, not redirected to checkout)', async ({ page }) => {
    await loginAsAdmin(page, buyerEmail, buyerPassword);
    await page.goto(`/pl/p/${componentBSlug}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await expect(page).toHaveURL(new RegExp(`/p/${componentBSlug}`), { timeout: 15000 });
    expect(page.url()).not.toContain('/checkout/');

    await expect(page.getByRole('heading', { name: componentBName })).toBeVisible({ timeout: 15000 });
  });

  // =========================================================================
  // 3. Order bump on a bundle checkout
  // =========================================================================

  test('order bump renders on the bundle checkout page', async ({ page }) => {
    await page.goto(`/pl/checkout/${bundleSlug}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await acceptAllCookies(page);

    // Checkout form present.
    await page.waitForSelector('input#fullName', { timeout: 15000 });

    // The bundle's contents preview renders ("This bundle includes:").
    await expect(page.locator('[data-testid="bundle-contents-preview"]')).toBeVisible({ timeout: 15000 });

    // The configured order bump renders with its title.
    await expect(page.getByText(`Bundle Bump Offer ${ts}`)).toBeVisible({ timeout: 15000 });
  });
});
