/**
 * SECURITY TEST: Mass Assignment in Coupon PATCH
 *
 * Vulnerability: The PATCH endpoint spreads all body properties,
 * allowing attackers to reset current_usage_count or modify other sensitive fields.
 */

import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function loginAsAdmin(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
    const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
    const supabase = createBrowserClient(supabaseUrl, anonKey);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, { email, password, supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY });

  await page.waitForTimeout(500);
}

test.describe('Mass Assignment - Coupon PATCH', () => {
  test.describe.configure({ mode: 'serial' });

  let adminUserId: string;
  let adminEmail: string;
  let testCouponId: string;
  const password = 'TestPassword123!';
  const initialUsageCount = 5;

  test.beforeAll(async () => {
    const suffix = Date.now().toString();
    adminEmail = `mass-assign-admin-${suffix}@example.com`;

    // Create admin user
    const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    });
    if (adminError) throw adminError;
    adminUserId = adminData.user!.id;

    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create test coupon with usage count
    const { data: coupon, error: couponError } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: `MASS-TEST-${suffix}`,
        name: 'Mass Assignment Test Coupon',
        discount_type: 'percentage',
        discount_value: 10,
        is_active: true,
        current_usage_count: initialUsageCount,
        usage_limit_global: 100,
      })
      .select()
      .single();

    if (couponError) throw couponError;
    testCouponId = coupon.id;

    console.log(`Created test coupon: ${testCouponId} with usage count: ${initialUsageCount}`);
  });

  test.afterAll(async () => {
    if (testCouponId) {
      await supabaseAdmin.from('coupons').delete().eq('id', testCouponId);
    }
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test('SECURITY: Should NOT allow resetting current_usage_count via PATCH', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, password);

    console.log(`\nMass Assignment Test (current_usage_count):`);
    console.log(`  Initial usage count: ${initialUsageCount}`);
    console.log(`  Attempting to reset to: 0`);

    // Attempt to reset usage count
    const response = await page.evaluate(async ({ couponId }) => {
      const res = await fetch(`/api/v1/coupons/${couponId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Name',
          current_usage_count: 0, // Malicious field - should be ignored
        }),
      });
      return { status: res.status, body: await res.json() };
    }, { couponId: testCouponId });

    console.log(`  Response status: ${response.status}`);

    // Check the actual value in the database
    const { data: coupon } = await supabaseAdmin
      .from('coupons')
      .select('current_usage_count, name')
      .eq('id', testCouponId)
      .single();

    console.log(`  Name after update: ${coupon?.name}`);
    console.log(`  Usage count after update: ${coupon?.current_usage_count}`);

    // Name should be updated (allowed field)
    expect(coupon?.name).toBe('Updated Name');

    // Usage count should NOT be reset (forbidden field)
    expect(coupon?.current_usage_count, 'VULNERABILITY: current_usage_count was reset to 0 via mass assignment').not.toBe(0);
    expect(coupon?.current_usage_count).toBe(initialUsageCount);
  });

  test('SECURITY: Should NOT allow modifying id field', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, password);

    console.log(`\nMass Assignment Test (id):`);

    const fakeId = '00000000-0000-0000-0000-000000000000';

    const response = await page.evaluate(async ({ couponId, fakeId }) => {
      const res = await fetch(`/api/v1/coupons/${couponId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: fakeId, // Malicious field - should be ignored
          name: 'ID Test',
        }),
      });
      return { status: res.status, body: await res.json() };
    }, { couponId: testCouponId, fakeId });

    // The coupon should still exist with original id
    const { data: coupon } = await supabaseAdmin
      .from('coupons')
      .select('id')
      .eq('id', testCouponId)
      .single();

    expect(coupon).not.toBeNull();
    expect(coupon?.id).toBe(testCouponId);
  });

  test('Should allow updating valid fields', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, password);

    console.log(`\nValid field update test:`);

    const response = await page.evaluate(async ({ couponId }) => {
      const res = await fetch(`/api/v1/coupons/${couponId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discount_value: 15,
          is_active: false,
        }),
      });
      return { status: res.status, body: await res.json() };
    }, { couponId: testCouponId });

    console.log(`  Response status: ${response.status}`);

    // Valid fields should be updated
    expect(response.status).toBe(200);
    expect(response.body.data.discount_value).toBe(15);
    expect(response.body.data.is_active).toBe(false);
  });
});
