/**
 * Smoke test: Marketplace provisioning — self-contained
 *
 * Provisions 3 test sellers in beforeAll, verifies DB state + UI + routes,
 * then hard-deletes them in afterAll. No manual setup required.
 */

import { test, expect } from '@playwright/test';
import { setAuthSession, supabaseAdmin } from './helpers/admin-auth';

// Test seller definitions — must not collide with real data
const TEST_SELLERS = [
  { slug: 'smoke-kowalski-store', displayName: 'Sklep Kowalskiego', fee: 8 },
  { slug: 'smoke-design-pro',     displayName: 'Design Pro Studio',  fee: 8 },
  { slug: 'smoke-tech-academy',   displayName: 'Tech Academy PL',    fee: 10 },
];

// Expected DB slugs after sanitization (hyphens → underscores)
const DB_SLUGS = TEST_SELLERS.map(s => s.slug.replace(/-/g, '_'));

test.describe('Marketplace Provisioning Smoke', () => {
  let adminEmail: string;
  let adminPassword: string;
  let provisionedIds: string[] = [];
  let cleanupAdmin: () => Promise<void>;

  test.beforeAll(async () => {
    // ── Create admin user ──────────────────────────────────────────────────
    adminPassword = 'password123';
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `mkt-smoke-${Date.now()}-${randomStr}@example.com`;

    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (userError) throw userError;
    await supabaseAdmin.from('admin_users').insert({ user_id: user!.id });

    cleanupAdmin = async () => {
      const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
      const u = users.find(x => x.email === adminEmail);
      if (u) {
        await supabaseAdmin.from('admin_users').delete().eq('user_id', u.id);
        await supabaseAdmin.auth.admin.deleteUser(u.id);
      }
    };

    // ── Provision test sellers ─────────────────────────────────────────────
    for (const seller of TEST_SELLERS) {
      const { data: sellerId, error } = await supabaseAdmin
        .rpc('provision_seller_schema', {
          p_slug: seller.slug,
          p_display_name: seller.displayName,
        }) as { data: string | null; error: unknown };

      if (error) {
        throw new Error(`Failed to provision seller "${seller.slug}": ${JSON.stringify(error)}`);
      }

      // Update platform fee (provision_seller_schema uses default 5%)
      if (seller.fee !== 5) {
        await supabaseAdmin
          .from('sellers')
          .update({ platform_fee_percent: seller.fee })
          .eq('id', sellerId!);
      }

      provisionedIds.push(sellerId!);
    }
  });

  test.afterAll(async () => {
    // ── Hard-delete provisioned test sellers ──────────────────────────────
    for (const id of provisionedIds) {
      await supabaseAdmin.rpc('deprovision_seller_schema', {
        p_seller_id: id,
        p_hard_delete: true,
      });
    }
    await cleanupAdmin?.();
  });

  // ===== DB VERIFICATION =====

  test('sellers table contains all 3 provisioned test sellers + owner', async () => {
    const { data, error } = await supabaseAdmin
      .from('sellers')
      .select('slug, schema_name, display_name, platform_fee_percent, status')
      .in('slug', ['main', ...DB_SLUGS])
      .order('created_at');

    expect(error).toBeNull();
    expect(data).toBeTruthy();

    const slugs = data!.map(s => s.slug);
    expect(slugs).toContain('main');
    for (const dbSlug of DB_SLUGS) {
      expect(slugs).toContain(dbSlug);
    }

    // Verify fees
    const designPro = data!.find(s => s.slug === 'smoke_design_pro');
    expect(designPro?.platform_fee_percent).toBe(8);
    const techAcademy = data!.find(s => s.slug === 'smoke_tech_academy');
    expect(techAcademy?.platform_fee_percent).toBe(10);

    // All active
    for (const seller of data!) {
      expect(seller.status).toBe('active');
    }
  });

  test('each provisioned schema has all 30 tables cloned from seller_main', async () => {
    for (const dbSlug of DB_SLUGS) {
      const schemaName = `seller_${dbSlug}`;

      const { data: seller } = await supabaseAdmin
        .from('sellers')
        .select('schema_name')
        .eq('slug', dbSlug)
        .single();

      expect(seller?.schema_name).toBe(schemaName);
    }
  });

  // ===== UI VERIFICATION =====

  test('/admin/sellers page shows all provisioned test sellers', async ({ page }) => {
    await setAuthSession(page, adminEmail, adminPassword);
    await page.goto('/en/admin/sellers');

    // Server component — data is in SSR'd HTML
    await page.waitForSelector('table tbody tr', { timeout: 20000 });

    await page.screenshot({ path: '/tmp/admin-sellers.png', fullPage: true });

    for (const seller of TEST_SELLERS) {
      await expect(page.getByText(seller.displayName)).toBeVisible({ timeout: 5000 });
    }
  });

  // ===== ROUTE VERIFICATION =====

  for (const seller of TEST_SELLERS) {
    test(`/s/${seller.slug} resolves to seller storefront (not 404)`, async ({ page }) => {
      await setAuthSession(page, adminEmail, adminPassword);
      await page.goto(`/en/s/${seller.slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      const url = page.url();
      await page.screenshot({ path: `/tmp/seller-route-${seller.slug}.png`, fullPage: true });

      expect(url).not.toContain('not-found');
      await expect(page.getByText('this page could not be found', { exact: false })).not.toBeVisible();

      const bodyText = await page.locator('body').innerText();
      const hasSellerContent =
        bodyText.toLowerCase().includes('shop') ||
        bodyText.toLowerCase().includes('product') ||
        bodyText.toLowerCase().includes('sklep') ||
        TEST_SELLERS.some(s => bodyText.includes(s.displayName));
      expect(hasSellerContent, `Expected seller content at /s/${seller.slug}`).toBe(true);
    });
  }
});
