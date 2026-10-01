// tests/payments-search.spec.ts
// Verifies the payments dashboard search reaches beyond the first loaded
// page — it must hit the server, not just filter whatever page happened to
// already be in the browser.

import { test, expect } from '@playwright/test';
import { supabaseAdmin, createTestAdmin, loginAsAdmin } from './helpers/admin-auth';

test.describe.configure({ mode: 'serial' });

test.describe('Payments dashboard search', () => {
  let productId: string;
  const transactionIds: string[] = [];
  let cleanupAdmin: () => Promise<void>;
  let adminEmail: string;
  let adminPassword: string;
  let needleEmail: string;

  test.beforeAll(async () => {
    const r = Math.random().toString(36).substring(7);

    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Payments Search Product ${r}`,
        slug: `payments-search-product-${r}`,
        description: 'Product for payments dashboard search E2E',
        price: 1000,
        currency: 'USD',
        is_active: true,
      })
      .select('id')
      .single();
    if (productError) throw productError;
    productId = product.id;

    // The admin dashboard loads the transactions list one page at a time
    // (PAYMENTS_PAGE_LIMIT = 100). 104 recent filler rows push a single,
    // deliberately OLDER "needle" transaction onto page 2 — proving search
    // must go to the server instead of only filtering the loaded page.
    const now = Date.now();
    const fillerRows = Array.from({ length: 104 }, (_, i) => ({
      customer_email: `filler-${r}-${i}@example.com`,
      amount: 1000,
      currency: 'USD',
      status: 'completed',
      stripe_payment_intent_id: `pi_fill_${r}_${i}`,
      product_id: productId,
      session_id: `cs_fill_${r}_${i}`,
      created_at: new Date(now - i * 1000).toISOString(),
    }));

    needleEmail = `needle-${r}@example.com`;
    const needleRow = {
      customer_email: needleEmail,
      amount: 1000,
      currency: 'USD',
      status: 'completed',
      stripe_payment_intent_id: `pi_needle_${r}`,
      product_id: productId,
      session_id: `cs_needle_${r}`,
      // Well before every filler row so it sorts onto page 2+ (desc by created_at).
      created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    };

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('payment_transactions')
      .insert([...fillerRows, needleRow])
      .select('id');
    if (insertError) throw insertError;
    transactionIds.push(...inserted!.map((row) => row.id));

    const admin = await createTestAdmin('payments-search-admin');
    adminEmail = admin.email;
    adminPassword = admin.password;
    cleanupAdmin = admin.cleanup;
  });

  test.afterAll(async () => {
    if (transactionIds.length) {
      await supabaseAdmin.from('payment_transactions').delete().in('id', transactionIds);
    }
    if (productId) {
      await supabaseAdmin.from('products').delete().eq('id', productId);
    }
    if (cleanupAdmin) {
      await cleanupAdmin();
    }
  });

  test('finds a payment that is not on the first loaded page', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    await page.goto('/dashboard/payments');
    await expect(page).toHaveURL(/\/dashboard\/payments/, { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Application error');

    // Page loaded with its normal (unfiltered) first page of results.
    const searchInput = page.locator('#payment-search-filter');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Scoped to the transactions table body — the "Active filters" chip
    // above the table also echoes the search term once it is applied, which
    // would otherwise collide with this same text and violate Playwright's
    // strict mode (two matching elements).
    const resultsBody = page.locator('tbody');

    // Not present on the first (unfiltered) page — it is the oldest of 105 rows.
    await expect(resultsBody.getByText(needleEmail, { exact: false })).not.toBeVisible();

    await searchInput.fill(needleEmail);

    // Debounced (400ms) server-side search must find it without clicking "Load more".
    await expect(resultsBody.getByText(needleEmail, { exact: false })).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Payments dashboard date range filter', () => {
  let productId: string;
  const transactionIds: string[] = [];
  let cleanupAdmin: () => Promise<void>;
  let adminEmail: string;
  let adminPassword: string;
  let recentEmail: string;
  let oldEmail: string;

  test.beforeAll(async () => {
    const r = Math.random().toString(36).substring(7);

    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Payments Date Range Product ${r}`,
        slug: `payments-date-range-product-${r}`,
        description: 'Product for payments dashboard date range E2E',
        price: 1000,
        currency: 'USD',
        is_active: true,
      })
      .select('id')
      .single();
    if (productError) throw productError;
    productId = product.id;

    recentEmail = `recent-${r}@example.com`;
    oldEmail = `old-${r}@example.com`;
    const now = Date.now();
    const rows = [
      {
        customer_email: recentEmail,
        amount: 1000,
        currency: 'USD',
        status: 'completed',
        stripe_payment_intent_id: `pi_recent_${r}`,
        product_id: productId,
        session_id: `cs_recent_${r}`,
        // Well within the "last 7 days" window.
        created_at: new Date(now - 60 * 1000).toISOString(),
      },
      {
        customer_email: oldEmail,
        amount: 1000,
        currency: 'USD',
        status: 'completed',
        stripe_payment_intent_id: `pi_old_${r}`,
        product_id: productId,
        session_id: `cs_old_${r}`,
        // Outside the "last 7 days" window, but the default date range is
        // "all" — this row must still be findable via search until the
        // range is narrowed.
        created_at: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('payment_transactions')
      .insert(rows)
      .select('id');
    if (insertError) throw insertError;
    transactionIds.push(...inserted!.map((row) => row.id));

    const admin = await createTestAdmin('payments-date-range-admin');
    adminEmail = admin.email;
    adminPassword = admin.password;
    cleanupAdmin = admin.cleanup;
  });

  test.afterAll(async () => {
    if (transactionIds.length) {
      await supabaseAdmin.from('payment_transactions').delete().in('id', transactionIds);
    }
    if (productId) {
      await supabaseAdmin.from('products').delete().eq('id', productId);
    }
    if (cleanupAdmin) {
      await cleanupAdmin();
    }
  });

  test('defaults to showing an older payment via search, then "last 7 days" hides it', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    await page.goto('/dashboard/payments');
    await expect(page).toHaveURL(/\/dashboard\/payments/, { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Application error');

    // Narrow to each seeded row via search so date-range behavior is observed
    // without depending on unrelated data from other tests. Scoped to the
    // transactions table body — the "Active filters" chip above the table
    // also echoes the search term, which would otherwise collide with this
    // same text and violate Playwright's strict mode (two matching elements).
    const searchInput = page.locator('#payment-search-filter');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    const resultsBody = page.locator('tbody');

    // Default range is "all" (untouched here) — the 20-day-old payment must
    // still be findable via search, exactly as it was before the date-range
    // filter was wired to the server. A narrower default would silently hide
    // it and defeat search for anything older than the default window.
    await searchInput.fill(oldEmail);
    await expect(resultsBody.getByText(oldEmail, { exact: false })).toBeVisible({ timeout: 10000 });
    await searchInput.fill('');
    await searchInput.fill(recentEmail);
    await expect(resultsBody.getByText(recentEmail, { exact: false })).toBeVisible({ timeout: 10000 });
    await searchInput.fill('');

    // Switch to "last 7 days": the 20-day-old payment must disappear, the
    // recent one must remain.
    await page.locator('#payment-date-range-filter').selectOption('7');

    await searchInput.fill(oldEmail);
    await expect(resultsBody.getByText(oldEmail, { exact: false })).not.toBeVisible({ timeout: 10000 });
    await searchInput.fill('');
    await searchInput.fill(recentEmail);
    await expect(resultsBody.getByText(recentEmail, { exact: false })).toBeVisible({ timeout: 10000 });
  });
});
