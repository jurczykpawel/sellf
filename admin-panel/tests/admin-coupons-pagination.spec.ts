// tests/admin-coupons-pagination.spec.ts
// The admin coupons page used to load every coupon in one shot (api.listAll,
// sequential requests, 5000-item ceiling). A busy shop's coupon table can
// grow without bound — the OTO system auto-generates a coupon per qualifying
// purchase — so this verifies the page instead loads one bounded page at a
// time, "Load more" fetches the next page, and search reaches beyond the
// first loaded page by hitting the server rather than filtering whatever
// happened to already be in the browser.
//
// The local Supabase instance this suite runs against is shared with other
// concurrently-running test suites (and other agents' worktrees), so the
// coupons table can contain an arbitrary number of unrelated rows at any
// moment. Every assertion here scopes to this test's own seeded rows via the
// `search` filter (a shared random marker embedded in every seeded code)
// instead of relying on the *unfiltered* table's total row count, which is
// not deterministic in this environment.

import { test, expect } from '@playwright/test';
import { supabaseAdmin, createTestAdmin, loginAsAdmin } from './helpers/admin-auth';

test.describe.configure({ mode: 'serial' });

test.describe('Admin coupons page pagination', () => {
  const couponIds: string[] = [];
  let cleanupAdmin: () => Promise<void>;
  let adminEmail: string;
  let adminPassword: string;
  let marker: string;
  let needleCode: string;

  test.beforeAll(async () => {
    marker = `PG${Date.now()}${Math.random().toString(36).substring(7)}`.toUpperCase();

    // The coupons page loads one page at a time (COUPONS_PAGE_LIMIT = 100).
    // 104 recent filler rows push a single, deliberately OLDER "needle"
    // coupon onto page 2 — proving both "Load more" and search must reach
    // the server instead of only ever showing the first loaded page. Every
    // code carries `marker` so this test can scope the list to just these
    // 105 rows via `search`, regardless of anything else in the shared DB.
    const now = Date.now();
    const fillerRows = Array.from({ length: 104 }, (_, i) => ({
      code: `${marker}-FILLER-${i}`,
      discount_type: 'percentage',
      discount_value: 10,
      is_active: true,
      created_at: new Date(now - i * 1000).toISOString(),
    }));

    needleCode = `${marker}-NEEDLE`;
    const needleRow = {
      code: needleCode,
      discount_type: 'percentage',
      discount_value: 15,
      is_active: true,
      // Well before every filler row so it sorts onto page 2+ (desc by created_at).
      created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    };

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('coupons')
      .insert([...fillerRows, needleRow])
      .select('id');
    if (insertError) throw insertError;
    couponIds.push(...inserted!.map((row) => row.id));

    const admin = await createTestAdmin('coupons-pagination-admin');
    adminEmail = admin.email;
    adminPassword = admin.password;
    cleanupAdmin = admin.cleanup;
  });

  test.afterAll(async () => {
    if (couponIds.length) {
      await supabaseAdmin.from('coupons').delete().in('id', couponIds);
    }
    if (cleanupAdmin) {
      await cleanupAdmin();
    }
  });

  test('renders the first page quickly, "Load more" reveals the rest', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    // Requests for the *main* (search-scoped) list — excludes the separate
    // `status=expired` housekeeping fetch (for "Delete expired", which must
    // see every expired coupon regardless of the main list's paging; how many
    // requests that takes depends on how many expired coupons already exist
    // in this shared test database, which isn't what this test covers).
    const scopedListRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (
        req.method() === 'GET' &&
        /\/api\/v1\/coupons(\?|$)/.test(url) &&
        !url.includes('status=expired') &&
        url.includes(`search=${marker}`)
      ) {
        scopedListRequests.push(url);
      }
    });

    await page.goto('/dashboard/coupons');
    await expect(page).toHaveURL(/\/dashboard\/coupons/, { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Application error');

    const searchInput = page.getByPlaceholder(/Search by code or name|Szukaj po kodzie lub nazwie/i);
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill(marker);

    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10000 });

    // Scoped to exactly this test's 105 seeded rows — the first page caps at
    // 100, not all 105, proving the list is paged rather than dumped whole.
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(100, { timeout: 10000 });

    // One server round trip for the scoped list. React's dev-mode StrictMode
    // double-invokes effects, so up to 2 identical requests are tolerated —
    // the meaningful signal is that it stays flat, unlike the old `listAll`
    // approach (default page size 20), which would have needed 6+ requests
    // (12+ under StrictMode) just to load all 105 rows up front.
    expect(scopedListRequests.length).toBeLessThanOrEqual(2);
    const requestsBeforeLoadMore = scopedListRequests.length;

    // The 105th (oldest) coupon is not on the first page yet.
    const loadMoreButton = page.getByRole('button', { name: /Load more|Załaduj więcej/i });
    await expect(loadMoreButton).toBeVisible({ timeout: 10000 });
    await expect(table.getByText(needleCode, { exact: true })).not.toBeVisible();

    await loadMoreButton.click();

    await expect(rows).toHaveCount(105, { timeout: 10000 });
    await expect(table.getByText(needleCode, { exact: true })).toBeVisible();

    // "Load more" made a new request instead of only re-filtering the loaded page.
    expect(scopedListRequests.length).toBeGreaterThan(requestsBeforeLoadMore);
  });

  test('finds a coupon that is not on the first loaded page via search', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);

    await page.goto('/dashboard/coupons');
    await expect(page).toHaveURL(/\/dashboard\/coupons/, { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Application error');

    const searchInput = page.getByPlaceholder(/Search by code or name|Szukaj po kodzie lub nazwie/i);
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10000 });

    // Searching the shared marker first shows all 105 scoped rows, confirming
    // the needle is not merely absent because it was never created.
    await searchInput.fill(marker);
    await expect(table.getByText(needleCode, { exact: true })).not.toBeVisible();

    // Narrowing straight to the needle's own (globally unique) code must find
    // it without ever clicking "Load more" — proving search reaches the
    // server instead of only filtering whatever page is already loaded.
    await searchInput.fill(needleCode);
    await expect(table.getByText(needleCode, { exact: true })).toBeVisible({ timeout: 10000 });
  });
});
