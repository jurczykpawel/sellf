/**
 * E2E Tests: Platform Admin — Marketplace Management
 *
 * Tests platform admin's ability to:
 * - Provision new sellers
 * - Assign seller owners
 * - View data across sellers
 * - Deprovision sellers
 *
 * REQUIRES: Supabase running + db reset + dev server running
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { setAuthSession, supabaseAdmin } from './helpers/admin-auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

// ===== SETUP =====

let adminEmail: string;
let adminPassword: string;
let adminUserId: string;
let testSellerId: string | null = null;
const TEST_SELLER_SLUG = `plat-test-${Date.now()}`;

test.beforeAll(async () => {
  const rnd = Math.random().toString(36).substring(7);
  adminPassword = 'password123';
  adminEmail = `platform-mkt-${Date.now()}-${rnd}@example.com`;

  const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  if (error) throw error;
  adminUserId = user!.id;
  await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });
});

test.afterAll(async () => {
  // Deprovision test seller if created
  if (testSellerId) {
    await supabaseAdmin.rpc('deprovision_seller_schema', {
      p_seller_id: testSellerId,
      p_hard_delete: true,
    }).catch(() => {});
  }

  // Cleanup admin user
  await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
  await supabaseAdmin.auth.admin.deleteUser(adminUserId).catch(() => {});
});

// ===== TESTS =====

test.describe('Platform Admin: Seller Provisioning', () => {
  test('admin can provision a new seller via RPC', async () => {
    const { data: sellerId, error } = await supabaseAdmin.rpc('provision_seller_schema', {
      p_slug: TEST_SELLER_SLUG,
      p_display_name: 'Platform Test Store',
    });

    expect(error).toBeNull();
    expect(sellerId).toBeTruthy();
    testSellerId = sellerId as string;
  });

  test('provisioned seller appears in sellers table', async () => {
    const dbSlug = TEST_SELLER_SLUG.replace(/-/g, '_');
    const { data, error } = await supabaseAdmin
      .from('sellers')
      .select('id, slug, schema_name, display_name, status')
      .eq('slug', dbSlug)
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.display_name).toBe('Platform Test Store');
    expect(data!.status).toBe('active');
    expect(data!.schema_name).toBe(`seller_${dbSlug}`);
  });

  test('provisioned schema has all tables from seller_main', async () => {
    const dbSlug = TEST_SELLER_SLUG.replace(/-/g, '_');
    const schemaName = `seller_${dbSlug}`;

    const refCount = execSync(
      `docker exec supabase_db_sellf psql -U postgres -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'seller_main' AND table_type = 'BASE TABLE';"`,
    ).toString().trim();

    const tableCount = execSync(
      `docker exec supabase_db_sellf psql -U postgres -tA -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = '${schemaName}' AND table_type = 'BASE TABLE';"`,
    ).toString().trim();

    expect(tableCount).toBe(refCount);
  });
});

test.describe('Platform Admin: Seller Owner Assignment', () => {
  let sellerOwnerUserId: string;

  test.beforeAll(async () => {
    const rnd = Math.random().toString(36).substring(7);
    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: `seller-owner-${Date.now()}-${rnd}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    if (error) throw error;
    sellerOwnerUserId = user!.id;
  });

  test.afterAll(async () => {
    await supabaseAdmin.auth.admin.deleteUser(sellerOwnerUserId).catch(() => {});
  });

  test('admin can assign a user as seller owner', async () => {
    const dbSlug = TEST_SELLER_SLUG.replace(/-/g, '_');

    const { error } = await supabaseAdmin
      .from('sellers')
      .update({ user_id: sellerOwnerUserId })
      .eq('slug', dbSlug);

    expect(error).toBeNull();

    // Verify
    const { data: seller } = await supabaseAdmin
      .from('sellers')
      .select('user_id')
      .eq('slug', dbSlug)
      .single();

    expect(seller!.user_id).toBe(sellerOwnerUserId);
  });

  test('get_seller_for_user returns the assigned seller', async () => {
    const { data, error } = await supabaseAdmin
      .rpc('get_seller_for_user', { p_user_id: sellerOwnerUserId });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].display_name).toBe('Platform Test Store');
  });
});

test.describe('Platform Admin: Cross-Seller Visibility', () => {
  test('admin sees all sellers on /admin/sellers page', async ({ page }) => {
    await setAuthSession(page, adminEmail, adminPassword);
    await page.goto('/en/admin/sellers', { waitUntil: 'domcontentloaded' });

    // Should see seed sellers + test seller
    await page.waitForSelector('table tbody tr', { timeout: 15000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('Kowalski Digital');
    expect(bodyText).toContain('Creative Studio');
  });

  test('admin V1 API returns seller_main products (not seller products)', async ({ page }) => {
    await setAuthSession(page, adminEmail, adminPassword);

    const response = await page.request.get('/api/v1/products');
    expect(response.status()).toBe(200);

    const body = await response.json();
    // Platform admin sees seller_main products
    // Should NOT see Kowalski/Creative products (those are in separate schemas)
    const names = body.data.map((p: { name: string }) => p.name);
    expect(names).not.toContain('Kurs E-commerce od Zera');
  });
});

test.describe('Platform Admin: Seller Deprovisioning', () => {
  test('admin can soft-deprovision a seller', async () => {
    if (!testSellerId) return;

    const { data, error } = await supabaseAdmin.rpc('deprovision_seller_schema', {
      p_seller_id: testSellerId,
      p_hard_delete: false,
    });

    expect(error).toBeNull();
    expect(data).toBe(true);

    // Verify status changed
    const { data: seller } = await supabaseAdmin
      .from('sellers')
      .select('status')
      .eq('id', testSellerId)
      .single();

    expect(seller!.status).toBe('deprovisioned');
  });

  test('admin can hard-delete a deprovisioned seller', async () => {
    if (!testSellerId) return;

    const { data, error } = await supabaseAdmin.rpc('deprovision_seller_schema', {
      p_seller_id: testSellerId,
      p_hard_delete: true,
    });

    expect(error).toBeNull();
    expect(data).toBe(true);

    // Verify seller record is gone
    const { data: seller } = await supabaseAdmin
      .from('sellers')
      .select('id')
      .eq('id', testSellerId)
      .single();

    expect(seller).toBeNull();

    // Verify schema is dropped
    const dbSlug = TEST_SELLER_SLUG.replace(/-/g, '_');
    const exists = execSync(
      `docker exec supabase_db_sellf psql -U postgres -tA -c "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'seller_${dbSlug}');"`,
    ).toString().trim();

    expect(exists).toBe('f');

    // Clear so afterAll doesn't try again
    testSellerId = null;
  });
});
