/**
 * ============================================================================
 * SECURITY TEST: Access Control RPC Functions
 * ============================================================================
 *
 * Tests the database functions `check_user_product_access` and
 * `batch_check_user_product_access` via Supabase RPC calls.
 *
 * Covers: valid access, no access, expired access, input validation,
 * unauthenticated callers, rate limiting, batch limits, SQL injection.
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20250101000000_core_schema.sql
 * @see supabase/migrations/20260310180000_proxy_functions.sql
 * ============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_ID = Date.now();
const USER_EMAIL = `access-rpc-test-${TEST_ID}@example.com`;
const USER_PASSWORD = 'test-password-123';

// Test product slugs
const PRODUCT_SLUG_ACTIVE = `test-product-active-${TEST_ID}`;
const PRODUCT_SLUG_NO_ACCESS = `test-product-no-access-${TEST_ID}`;
const PRODUCT_SLUG_EXPIRED = `test-product-expired-${TEST_ID}`;

describe('Access Control RPC Functions', () => {
  let testUserId: string;
  let authenticatedClient: SupabaseClient;
  let anonClient: SupabaseClient;

  let productActiveId: string;
  let productNoAccessId: string;
  let productExpiredId: string;

  beforeAll(async () => {
    // Create test user
    const { data: userAuth, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: USER_EMAIL,
      password: USER_PASSWORD,
      email_confirm: true,
    });
    if (userError) throw userError;
    testUserId = userAuth.user.id;

    // Create test products using service role (bypasses RLS)
    const { data: activeProduct, error: activeErr } = await supabaseAdmin
      .schema('seller_main' as any)
      .from('products')
      .insert({
        name: 'Active Product',
        slug: PRODUCT_SLUG_ACTIVE,
        price: 10,
        currency: 'USD',
        is_active: true,
      })
      .select('id')
      .single();
    if (activeErr) throw activeErr;
    productActiveId = activeProduct.id;

    const { data: noAccessProduct, error: noAccessErr } = await supabaseAdmin
      .schema('seller_main' as any)
      .from('products')
      .insert({
        name: 'No Access Product',
        slug: PRODUCT_SLUG_NO_ACCESS,
        price: 20,
        currency: 'USD',
        is_active: true,
      })
      .select('id')
      .single();
    if (noAccessErr) throw noAccessErr;
    productNoAccessId = noAccessProduct.id;

    const { data: expiredProduct, error: expiredErr } = await supabaseAdmin
      .schema('seller_main' as any)
      .from('products')
      .insert({
        name: 'Expired Product',
        slug: PRODUCT_SLUG_EXPIRED,
        price: 30,
        currency: 'USD',
        is_active: true,
      })
      .select('id')
      .single();
    if (expiredErr) throw expiredErr;
    productExpiredId = expiredProduct.id;

    // Grant access to active product (permanent)
    const { error: grantActiveErr } = await supabaseAdmin
      .schema('seller_main' as any)
      .from('user_product_access')
      .insert({
        user_id: testUserId,
        product_id: productActiveId,
        access_expires_at: null,
      });
    if (grantActiveErr) throw grantActiveErr;

    // Grant expired access to expired product
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // yesterday
    const { error: grantExpiredErr } = await supabaseAdmin
      .schema('seller_main' as any)
      .from('user_product_access')
      .insert({
        user_id: testUserId,
        product_id: productExpiredId,
        access_granted_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 2 days ago
        access_expires_at: pastDate,
      });
    if (grantExpiredErr) throw grantExpiredErr;

    // Create authenticated client (sign in as test user)
    authenticatedClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await authenticatedClient.auth.signInWithPassword({
      email: USER_EMAIL,
      password: USER_PASSWORD,
    });
    if (signInErr) throw signInErr;

    // Create anonymous client (no sign in)
    anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  afterAll(async () => {
    // Clean up in reverse dependency order
    if (testUserId) {
      await supabaseAdmin
        .schema('seller_main' as any)
        .from('user_product_access')
        .delete()
        .eq('user_id', testUserId);
    }

    const productIds = [productActiveId, productNoAccessId, productExpiredId].filter(Boolean);
    if (productIds.length > 0) {
      await supabaseAdmin
        .schema('seller_main' as any)
        .from('products')
        .delete()
        .in('id', productIds);
    }

    // Clean up rate_limits entries created during tests
    await supabaseAdmin
      .from('rate_limits')
      .delete()
      .like('function_name', '%check_user_product_access%');

    if (testUserId) {
      await supabaseAdmin.auth.admin.deleteUser(testUserId);
    }
  });

  // ==========================================================================
  // check_user_product_access - Single product access check
  // ==========================================================================

  describe('check_user_product_access', () => {
    it('returns true when user has active access to a product', async () => {
      const { data, error } = await authenticatedClient.rpc('check_user_product_access', {
        product_slug_param: PRODUCT_SLUG_ACTIVE,
      });

      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('returns false when user does NOT have access to a product', async () => {
      const { data, error } = await authenticatedClient.rpc('check_user_product_access', {
        product_slug_param: PRODUCT_SLUG_NO_ACCESS,
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('returns false when access has expired', async () => {
      const { data, error } = await authenticatedClient.rpc('check_user_product_access', {
        product_slug_param: PRODUCT_SLUG_EXPIRED,
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('returns false for a non-existent product slug', async () => {
      const { data, error } = await authenticatedClient.rpc('check_user_product_access', {
        product_slug_param: 'non-existent-product-slug-xyz',
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    // --- Input validation ---

    it('returns false for null slug', async () => {
      const { data, error } = await authenticatedClient.rpc('check_user_product_access', {
        product_slug_param: null as any,
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('returns false for empty string slug', async () => {
      const { data, error } = await authenticatedClient.rpc('check_user_product_access', {
        product_slug_param: '',
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('returns false for slug exceeding 100 characters', async () => {
      const longSlug = 'a'.repeat(101);
      const { data, error } = await authenticatedClient.rpc('check_user_product_access', {
        product_slug_param: longSlug,
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    it('sanitizes slug with SQL injection attempt (returns false, no error)', async () => {
      const attacks = [
        "'; DROP TABLE products;--",
        "' OR '1'='1",
        "test' UNION SELECT * FROM auth.users--",
        "test; DELETE FROM seller_main.products WHERE true;--",
      ];

      for (const attack of attacks) {
        const { data, error } = await authenticatedClient.rpc('check_user_product_access', {
          product_slug_param: attack,
        });

        // The function sanitizes the slug (removes non-alphanumeric chars)
        // so it either returns false or a sanitized match. No SQL injection occurs.
        expect(error).toBeNull();
        expect(data).toBe(false);
      }
    });

    it('sanitizes slug with special characters (keeps only alphanumeric, hyphens, underscores)', async () => {
      // Slug with special chars that get stripped
      const { data, error } = await authenticatedClient.rpc('check_user_product_access', {
        product_slug_param: '../../etc/passwd',
      });

      expect(error).toBeNull();
      expect(data).toBe(false);
    });

    // --- Unauthenticated user ---

    it('returns false for unauthenticated user (anon client)', async () => {
      const { data, error } = await anonClient.rpc('check_user_product_access', {
        product_slug_param: PRODUCT_SLUG_ACTIVE,
      });

      // Function returns false when auth.uid() is null
      expect(error).toBeNull();
      expect(data).toBe(false);
    });
  });

  // ==========================================================================
  // batch_check_user_product_access - Multiple product access check
  // ==========================================================================

  describe('batch_check_user_product_access', () => {
    it('returns correct access map for mix of accessible and inaccessible products', async () => {
      const { data, error } = await authenticatedClient.rpc('batch_check_user_product_access', {
        product_slugs_param: [PRODUCT_SLUG_ACTIVE, PRODUCT_SLUG_NO_ACCESS, PRODUCT_SLUG_EXPIRED],
      });

      expect(error).toBeNull();
      expect(data).toEqual({
        [PRODUCT_SLUG_ACTIVE]: true,
        [PRODUCT_SLUG_NO_ACCESS]: false,
        [PRODUCT_SLUG_EXPIRED]: false,
      });
    });

    it('returns empty object for null input', async () => {
      const { data, error } = await authenticatedClient.rpc('batch_check_user_product_access', {
        product_slugs_param: null as any,
      });

      expect(error).toBeNull();
      expect(data).toEqual({});
    });

    it('returns empty object for empty array', async () => {
      const { data, error } = await authenticatedClient.rpc('batch_check_user_product_access', {
        product_slugs_param: [],
      });

      expect(error).toBeNull();
      expect(data).toEqual({});
    });

    it('throws error when more than 20 slugs are provided', async () => {
      const tooManySlugs = Array.from({ length: 21 }, (_, i) => `slug-${i}`);

      const { error } = await authenticatedClient.rpc('batch_check_user_product_access', {
        product_slugs_param: tooManySlugs,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain('Too many product slugs');
    });

    it('accepts exactly 20 slugs (boundary)', async () => {
      const twentySlugs = Array.from({ length: 20 }, (_, i) => `boundary-slug-${i}`);

      const { data, error } = await authenticatedClient.rpc('batch_check_user_product_access', {
        product_slugs_param: twentySlugs,
      });

      expect(error).toBeNull();
      // All non-existent slugs should return false
      for (const slug of twentySlugs) {
        expect(data[slug]).toBe(false);
      }
    });

    it('skips null and empty slugs in the array', async () => {
      const { data, error } = await authenticatedClient.rpc('batch_check_user_product_access', {
        product_slugs_param: [null as any, '', PRODUCT_SLUG_ACTIVE],
      });

      expect(error).toBeNull();
      // Only the valid slug should appear in the result
      expect(data[PRODUCT_SLUG_ACTIVE]).toBe(true);
      // Null and empty should not produce keys
      expect(Object.keys(data)).not.toContain('');
      expect(Object.keys(data)).not.toContain('null');
    });

    it('skips slugs exceeding 100 characters', async () => {
      const longSlug = 'a'.repeat(101);
      const { data, error } = await authenticatedClient.rpc('batch_check_user_product_access', {
        product_slugs_param: [longSlug, PRODUCT_SLUG_ACTIVE],
      });

      expect(error).toBeNull();
      expect(data[PRODUCT_SLUG_ACTIVE]).toBe(true);
      // Long slug should not appear in results (skipped by validation)
      expect(Object.keys(data)).not.toContain(longSlug);
    });

    it('sanitizes slugs with special characters in batch', async () => {
      const { data, error } = await authenticatedClient.rpc('batch_check_user_product_access', {
        product_slugs_param: ["'; DROP TABLE products;--", PRODUCT_SLUG_ACTIVE],
      });

      expect(error).toBeNull();
      expect(data[PRODUCT_SLUG_ACTIVE]).toBe(true);
      // The SQL injection slug gets sanitized (special chars stripped)
      // The sanitized version (DROPTABLEproducts) should return false
    });

    it('returns empty object for unauthenticated user (anon client)', async () => {
      const { data, error } = await anonClient.rpc('batch_check_user_product_access', {
        product_slugs_param: [PRODUCT_SLUG_ACTIVE],
      });

      // Function returns empty {} when auth.uid() is null
      expect(error).toBeNull();
      expect(data).toEqual({});
    });

    it('handles duplicate slugs in the array', async () => {
      const { data, error } = await authenticatedClient.rpc('batch_check_user_product_access', {
        product_slugs_param: [PRODUCT_SLUG_ACTIVE, PRODUCT_SLUG_ACTIVE],
      });

      expect(error).toBeNull();
      // Duplicates should not cause errors; last write wins in JSONB
      expect(data[PRODUCT_SLUG_ACTIVE]).toBe(true);
    });
  });

  // ==========================================================================
  // Rate limiting
  // ==========================================================================

  describe('Rate limiting', () => {
    it('check_user_product_access enforces rate limit after 1000 calls per hour', async () => {
      // We cannot realistically make 1000 calls in a test, so we verify
      // the rate limit mechanism exists by inserting artificial rate_limit records
      // that simulate exhaustion, then checking the function rejects.

      // Insert a rate_limit record that simulates 1000 calls within the current window
      const windowStart = new Date();
      windowStart.setMinutes(0, 0, 0); // Start of current hour

      // Use the user's identifier format as used by check_rate_limit
      // The function uses auth.uid() internally via check_rate_limit
      await supabaseAdmin
        .from('rate_limits')
        .upsert({
          user_id: testUserId,
          function_name: 'check_user_product_access',
          window_start: windowStart.toISOString(),
          call_count: 1000,
        }, {
          onConflict: 'user_id,function_name,window_start',
        });

      const { error } = await authenticatedClient.rpc('check_user_product_access', {
        product_slug_param: PRODUCT_SLUG_ACTIVE,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain('Rate limit exceeded');

      // Clean up the artificial rate limit
      await supabaseAdmin
        .from('rate_limits')
        .delete()
        .eq('user_id', testUserId)
        .eq('function_name', 'check_user_product_access');
    });

    it('batch_check_user_product_access enforces rate limit after 200 calls per hour', async () => {
      const windowStart = new Date();
      windowStart.setMinutes(0, 0, 0);

      await supabaseAdmin
        .from('rate_limits')
        .upsert({
          user_id: testUserId,
          function_name: 'batch_check_user_product_access',
          window_start: windowStart.toISOString(),
          call_count: 200,
        }, {
          onConflict: 'user_id,function_name,window_start',
        });

      const { error } = await authenticatedClient.rpc('batch_check_user_product_access', {
        product_slugs_param: [PRODUCT_SLUG_ACTIVE],
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain('Rate limit exceeded');

      // Clean up
      await supabaseAdmin
        .from('rate_limits')
        .delete()
        .eq('user_id', testUserId)
        .eq('function_name', 'batch_check_user_product_access');
    });
  });
});
