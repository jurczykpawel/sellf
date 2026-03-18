/**
 * Smoke test: Marketplace provisioning — self-contained
 *
 * Provisions 3 test sellers in beforeAll, verifies DB state + UI + routes,
 * then hard-deletes them in afterAll. No manual setup required.
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
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

    // ── Clean up stale smoke sellers from previous runs ─────────────────
    for (const seller of TEST_SELLERS) {
      const dbSlug = seller.slug.replace(/-/g, '_');
      const { data: existing } = await supabaseAdmin
        .from('sellers')
        .select('id')
        .eq('slug', dbSlug)
        .maybeSingle();
      if (existing) {
        await supabaseAdmin.rpc('deprovision_seller_schema', {
          p_seller_id: existing.id,
          p_hard_delete: true,
        });
      }
    }

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
    // Safety net — deprovision anything the deprovision test didn't clean up
    for (const id of provisionedIds) {
      await supabaseAdmin.rpc('deprovision_seller_schema', {
        p_seller_id: id,
        p_hard_delete: true,
      }).catch(() => {}); // ignore errors (already deleted or doesn't exist)
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
    // PostgREST doesn't expose dynamically-created schemas, so we query
    // information_schema directly via psql to verify clone_schema worked.
    const refCount = execSync(
      `docker exec supabase_db_sellf psql -U postgres -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'seller_main' AND table_type = 'BASE TABLE';"`,
    ).toString().trim();

    for (const dbSlug of DB_SLUGS) {
      const schemaName = `seller_${dbSlug}`;
      const tableCount = execSync(
        `docker exec supabase_db_sellf psql -U postgres -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = '${schemaName}' AND table_type = 'BASE TABLE';"`,
      ).toString().trim();

      expect(tableCount, `${schemaName} should have ${refCount} tables (same as seller_main)`).toBe(refCount);
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
      await page.goto(`/en/s/${seller.slug}`, { waitUntil: 'networkidle' });

      await expect(page.locator('body')).not.toHaveText(/this page could not be found/i, { timeout: 5000 });

      const url = page.url();
      expect(url).not.toContain('not-found');

      const bodyText = await page.locator('body').innerText();
      const hasSellerContent =
        bodyText.toLowerCase().includes('shop') ||
        bodyText.toLowerCase().includes('product') ||
        bodyText.toLowerCase().includes('sklep') ||
        TEST_SELLERS.some(s => bodyText.includes(s.displayName));
      expect(hasSellerContent, `Expected seller content at /s/${seller.slug}`).toBe(true);
    });
  }

  // ===== DEPROVISION VERIFICATION =====
  // Must run last — validates that hard-delete removes schemas, seller rows,
  // and leaves no orphaned data (RODO compliance).

  test('hard-delete deprovision removes schemas and seller records completely', async () => {
    for (const id of provisionedIds) {
      const { error } = await supabaseAdmin.rpc('deprovision_seller_schema', {
        p_seller_id: id,
        p_hard_delete: true,
      });
      expect(error, `deprovision_seller_schema(${id}) should succeed`).toBeNull();
    }

    // Verify seller rows are gone
    const { data: remaining } = await supabaseAdmin
      .from('sellers')
      .select('slug')
      .in('slug', DB_SLUGS);

    expect(remaining, 'No test seller records should remain after hard-delete').toEqual([]);

    // Verify schemas are dropped from PostgreSQL
    for (const dbSlug of DB_SLUGS) {
      const schemaName = `seller_${dbSlug}`;
      const exists = execSync(
        `docker exec supabase_db_sellf psql -U postgres -tA -c "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = '${schemaName}');"`,
      ).toString().trim();

      expect(exists, `Schema ${schemaName} should not exist after hard-delete`).toBe('f');
    }

    // Clear IDs so afterAll safety net doesn't try to delete again
    provisionedIds = [];
  });
});
