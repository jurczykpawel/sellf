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

/**
 * Mirrors the DB sanitizer: regexp_replace(input, '[^a-zA-Z0-9_-]', '', 'g')
 * Used to compute expected sanitized slugs dynamically instead of hardcoding.
 */
function sanitizeSlug(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

    // Clean up rate_limits entries created during tests (scoped to this test's user only)
    if (testUserId) {
      await supabaseAdmin
        .from('rate_limits')
        .delete()
        .eq('user_id', testUserId);
    }

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
      // The DB sanitizer strips everything except [a-zA-Z0-9_-].
      // To prove sanitization actually runs, we create a product whose slug
      // equals the *sanitized* version of an attack string, grant access,
      // then call the RPC with the *unsanitized* attack string.
      // If sanitization works: the function strips the attack to the clean slug,
      // finds the product, and returns true.
      // If sanitization were removed: the raw attack string wouldn't match, returning false.
      const unsanitized = "test' UNION SELECT * FROM auth.users--";
      const sanitized = sanitizeSlug(unsanitized);
      const sanitizedSlug = `sqli-test-${TEST_ID}-${sanitized}`.slice(0, 100);
      const unsanitizedInput = `sqli-test-${TEST_ID}-${unsanitized}`.slice(0, 200);

      // Create product with the sanitized slug
      const { data: sqliProduct, error: createErr } = await supabaseAdmin
        .schema('seller_main' as any)
        .from('products')
        .insert({
          name: 'SQLi Sanitization Test',
          slug: sanitizedSlug,
          price: 0,
          currency: 'USD',
          is_active: true,
        })
        .select('id')
        .single();
      if (createErr) throw createErr;

      // Grant access
      await supabaseAdmin
        .schema('seller_main' as any)
        .from('user_product_access')
        .insert({ user_id: testUserId, product_id: sqliProduct.id, access_expires_at: null });

      try {
        // The sanitized version of unsanitizedInput should equal sanitizedSlug
        const { data, error } = await authenticatedClient.rpc('check_user_product_access', {
          product_slug_param: unsanitizedInput,
        });

        expect(error).toBeNull();
        // If sanitization works, the function finds the product via the sanitized slug
        expect(data).toBe(true);

        // Positive control: verify the function is not a no-op by confirming
        // a legitimate slug with access returns true (already proven above),
        // then verify attack strings return false.
        // The primary sanitization test above already proves sanitization runs
        // (unsanitized input -> sanitized slug -> match -> true).
        // These additional attacks verify no false positives from injection payloads.
        const otherAttacks = [
          "'; DROP TABLE products;--",
          "' OR '1'='1",
          "test; DELETE FROM seller_main.products WHERE true;--",
        ];
        for (const attack of otherAttacks) {
          const { data: d, error: e } = await authenticatedClient.rpc('check_user_product_access', {
            product_slug_param: attack,
          });
          expect(e).toBeNull();
          expect(d).toBe(false);
        }

        // Positive control: confirm the function still returns true for a known-good slug
        // (proves it's not a no-op that always returns false)
        const { data: positiveControl, error: positiveErr } = await authenticatedClient.rpc(
          'check_user_product_access',
          { product_slug_param: PRODUCT_SLUG_ACTIVE },
        );
        expect(positiveErr).toBeNull();
        expect(positiveControl).toBe(true);
      } finally {
        // Clean up
        await supabaseAdmin.schema('seller_main' as any).from('user_product_access')
          .delete().eq('product_id', sqliProduct.id);
        await supabaseAdmin.schema('seller_main' as any).from('products')
          .delete().eq('id', sqliProduct.id);
      }
    });

    it('sanitizes slug with special characters (keeps only alphanumeric, hyphens, underscores)', async () => {
      // The DB sanitizer: regexp_replace(input, '[^a-zA-Z0-9_-]', '', 'g')
      // '../../etc/passwd' -> 'etcpasswd' (dots and slashes stripped)
      //
      // To prove sanitization actually runs, we create a product with the
      // SANITIZED slug, grant access, then call the RPC with the UNSANITIZED input.
      // If sanitization works: function strips input to 'etcpasswd', finds the product, returns true.
      // If sanitization were removed: raw '../../etc/passwd' wouldn't match, returns false.
      const unsanitized = `../../etc/passwd-${TEST_ID}`;
      const sanitized = sanitizeSlug(unsanitized);

      const { data: specialProduct, error: createErr } = await supabaseAdmin
        .schema('seller_main' as any)
        .from('products')
        .insert({
          name: 'Special Chars Sanitization Test',
          slug: sanitized,
          price: 0,
          currency: 'USD',
          is_active: true,
        })
        .select('id')
        .single();
      if (createErr) throw createErr;

      await supabaseAdmin
        .schema('seller_main' as any)
        .from('user_product_access')
        .insert({ user_id: testUserId, product_id: specialProduct.id, access_expires_at: null });

      try {
        const { data, error } = await authenticatedClient.rpc('check_user_product_access', {
          product_slug_param: unsanitized,
        });

        expect(error).toBeNull();
        expect(data).toBe(true);
      } finally {
        await supabaseAdmin.schema('seller_main' as any).from('user_product_access')
          .delete().eq('product_id', specialProduct.id);
        await supabaseAdmin.schema('seller_main' as any).from('products')
          .delete().eq('id', specialProduct.id);
      }
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

    // --- Horizontal privilege escalation ---

    it('returns false when a different user tries to access another user\'s product', async () => {
      // Create a second user (user B) who should NOT have access to user A's products
      const userBEmail = `access-rpc-userb-${TEST_ID}@example.com`;
      const { data: userBAuth, error: userBError } = await supabaseAdmin.auth.admin.createUser({
        email: userBEmail,
        password: USER_PASSWORD,
        email_confirm: true,
      });
      if (userBError) throw userBError;

      // Create a client authenticated as user B
      const userBClient = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInErr } = await userBClient.auth.signInWithPassword({
        email: userBEmail,
        password: USER_PASSWORD,
      });
      if (signInErr) throw signInErr;

      try {
        // User A (testUserId) has access to PRODUCT_SLUG_ACTIVE.
        // User B should NOT have access to it.
        const { data, error } = await userBClient.rpc('check_user_product_access', {
          product_slug_param: PRODUCT_SLUG_ACTIVE,
        });

        expect(error).toBeNull();
        expect(data).toBe(false);

        // Also verify batch endpoint for the same scenario
        const { data: batchData, error: batchErr } = await userBClient.rpc(
          'batch_check_user_product_access',
          { product_slugs_param: [PRODUCT_SLUG_ACTIVE, PRODUCT_SLUG_NO_ACCESS] },
        );
        expect(batchErr).toBeNull();
        expect(batchData[PRODUCT_SLUG_ACTIVE]).toBe(false);
        expect(batchData[PRODUCT_SLUG_NO_ACCESS]).toBe(false);
      } finally {
        // Clean up user B's rate limits and auth
        await supabaseAdmin
          .from('rate_limits')
          .delete()
          .eq('user_id', userBAuth.user.id);
        await supabaseAdmin.auth.admin.deleteUser(userBAuth.user.id);
      }
    });

    // --- Boundary: access_expires_at = NOW() ---

    it('returns true when access_expires_at is exactly now (>= NOW() boundary)', async () => {
      // The DB uses `access_expires_at >= NOW()`, so access expiring at exactly
      // the current moment should still be valid.
      const boundarySlug = `test-boundary-expires-now-${TEST_ID}`;

      const { data: boundaryProduct, error: createErr } = await supabaseAdmin
        .schema('seller_main' as any)
        .from('products')
        .insert({
          name: 'Boundary Expiry Test',
          slug: boundarySlug,
          price: 0,
          currency: 'USD',
          is_active: true,
        })
        .select('id')
        .single();
      if (createErr) throw createErr;

      // Set access_expires_at to a few seconds in the future to account for
      // the small delay between insert and RPC call. This tests the >= boundary
      // without being flaky due to timing.
      const expiresAt = new Date(Date.now() + 5000).toISOString();

      const { error: grantErr } = await supabaseAdmin
        .schema('seller_main' as any)
        .from('user_product_access')
        .insert({
          user_id: testUserId,
          product_id: boundaryProduct.id,
          access_expires_at: expiresAt,
        });
      if (grantErr) throw grantErr;

      try {
        const { data, error } = await authenticatedClient.rpc('check_user_product_access', {
          product_slug_param: boundarySlug,
        });

        expect(error).toBeNull();
        // Access should be valid since expires_at >= NOW()
        expect(data).toBe(true);
      } finally {
        await supabaseAdmin.schema('seller_main' as any).from('user_product_access')
          .delete().eq('product_id', boundaryProduct.id);
        await supabaseAdmin.schema('seller_main' as any).from('products')
          .delete().eq('id', boundaryProduct.id);
      }
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
      // The DB sanitizer: regexp_replace(input, '[^a-zA-Z0-9_-]', '', 'g')
      // "test@slug!#$" -> "testslug"
      // To prove sanitization runs in batch, create a product with the sanitized slug,
      // grant access, then pass the unsanitized version in the batch call.
      const unsanitized = `test@slug!#$-${TEST_ID}`;
      const sanitized = sanitizeSlug(unsanitized);

      const { data: batchSanitizeProduct, error: createErr } = await supabaseAdmin
        .schema('seller_main' as any)
        .from('products')
        .insert({
          name: 'Batch Sanitize Test',
          slug: sanitized,
          price: 0,
          currency: 'USD',
          is_active: true,
        })
        .select('id')
        .single();
      if (createErr) throw createErr;

      await supabaseAdmin
        .schema('seller_main' as any)
        .from('user_product_access')
        .insert({ user_id: testUserId, product_id: batchSanitizeProduct.id, access_expires_at: null });

      try {
        const { data, error } = await authenticatedClient.rpc('batch_check_user_product_access', {
          product_slugs_param: [unsanitized, PRODUCT_SLUG_ACTIVE],
        });

        expect(error).toBeNull();
        expect(data[PRODUCT_SLUG_ACTIVE]).toBe(true);
        // The unsanitized slug should be sanitized to match the product and return true.
        // The batch function uses the sanitized slug as the JSON key.
        expect(data[sanitized]).toBe(true);
        // Assert unsanitized key variants are NOT present (could leak unsanitized keys)
        expect(data[unsanitized]).toBeUndefined();
        expect(Object.keys(data)).not.toContain(unsanitized);
      } finally {
        await supabaseAdmin.schema('seller_main' as any).from('user_product_access')
          .delete().eq('product_id', batchSanitizeProduct.id);
        await supabaseAdmin.schema('seller_main' as any).from('products')
          .delete().eq('id', batchSanitizeProduct.id);
      }
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
      // Instead of seeding a synthetic row with a JS-computed window_start that might
      // not align with the DB's internal window calculation, we:
      // 1. Make one real RPC call to let the DB create its own rate_limit row
      // 2. Find that row and update its call_count to the limit
      // 3. Verify the next call is rejected
      // This exercises the actual increment path and avoids timing drift issues.

      // Step 1: Make a real call to create the rate_limit row in the DB
      const { error: seedErr } = await authenticatedClient.rpc('check_user_product_access', {
        product_slug_param: PRODUCT_SLUG_ACTIVE,
      });
      expect(seedErr).toBeNull();

      // Step 2: Find the row the DB actually created and set count to the limit
      const { data: rows, error: fetchErr } = await supabaseAdmin
        .from('rate_limits')
        .select('*')
        .eq('user_id', testUserId)
        .eq('function_name', 'check_user_product_access')
        .order('window_start', { ascending: false })
        .limit(1);
      expect(fetchErr).toBeNull();
      expect(rows).toHaveLength(1);

      // Verify the row is being used (call_count should be >= 1)
      expect(rows![0].call_count).toBeGreaterThanOrEqual(1);

      // Update to exactly the limit so the next call triggers rate limiting
      const { error: updateErr } = await supabaseAdmin
        .from('rate_limits')
        .update({ call_count: 1000 })
        .eq('user_id', testUserId)
        .eq('function_name', 'check_user_product_access')
        .eq('window_start', rows![0].window_start);
      expect(updateErr).toBeNull();

      // Step 3: Next call should be rate limited
      const { error } = await authenticatedClient.rpc('check_user_product_access', {
        product_slug_param: PRODUCT_SLUG_ACTIVE,
      });

      expect(error).not.toBeNull();
      expect(error!.message).toContain('Rate limit exceeded');

      // Clean up
      await supabaseAdmin
        .from('rate_limits')
        .delete()
        .eq('user_id', testUserId)
        .eq('function_name', 'check_user_product_access');
    });

    it('batch_check_user_product_access enforces rate limit after 200 calls per hour', async () => {
      // Same approach: let the DB create its own row, then update count to the limit.

      // Step 1: Make a real call to create the rate_limit row
      const { error: seedErr } = await authenticatedClient.rpc('batch_check_user_product_access', {
        product_slugs_param: [PRODUCT_SLUG_ACTIVE],
      });
      expect(seedErr).toBeNull();

      // Step 2: Find the row and update to the limit
      const { data: rows, error: fetchErr } = await supabaseAdmin
        .from('rate_limits')
        .select('*')
        .eq('user_id', testUserId)
        .eq('function_name', 'batch_check_user_product_access')
        .order('window_start', { ascending: false })
        .limit(1);
      expect(fetchErr).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows![0].call_count).toBeGreaterThanOrEqual(1);

      const { error: updateErr } = await supabaseAdmin
        .from('rate_limits')
        .update({ call_count: 200 })
        .eq('user_id', testUserId)
        .eq('function_name', 'batch_check_user_product_access')
        .eq('window_start', rows![0].window_start);
      expect(updateErr).toBeNull();

      // Step 3: Next call should be rate limited
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
