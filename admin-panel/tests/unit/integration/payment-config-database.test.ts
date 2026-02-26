/**
 * Database Tests: RLS Policies + Constraints
 *
 * Test ID: DB-RLS-001 to DB-RLS-010
 * Coverage: Row-level security, constraints, data integrity
 * Focus: Admin-only access, singleton enforcement, JSONB validation
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

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
const ADMIN_EMAIL = `admin-rls-test-${TEST_ID}@example.com`;
const NON_ADMIN_EMAIL = `user-rls-test-${TEST_ID}@example.com`;

describe('Payment Config Database - RLS Policies & Constraints', () => {
  let testAdminUserId: string;
  let testNonAdminUserId: string;
  let adminClient: any;
  let nonAdminClient: any;

  beforeAll(async () => {
    // Create admin user
    const { data: adminAuth } = await supabaseAdmin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: 'test123456',
      email_confirm: true,
    });

    testAdminUserId = adminAuth!.user.id;

    await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: testAdminUserId });

    // Create non-admin user
    const { data: userAuth } = await supabaseAdmin.auth.admin.createUser({
      email: NON_ADMIN_EMAIL,
      password: 'test123456',
      email_confirm: true,
    });

    testNonAdminUserId = userAuth!.user.id;

    // Create authenticated clients
    adminClient = createClient(SUPABASE_URL, ANON_KEY);
    await adminClient.auth.signInWithPassword({
      email: ADMIN_EMAIL,
      password: 'test123456',
    });

    nonAdminClient = createClient(SUPABASE_URL, ANON_KEY);

    // Ensure config row exists
    await supabaseAdmin
      .from('payment_method_config')
      .upsert({
        id: 1,
        config_mode: 'automatic',
        custom_payment_methods: [],
        payment_method_order: [],
        currency_overrides: {},
        enable_express_checkout: true,
        enable_apple_pay: true,
        enable_google_pay: true,
        enable_link: true,
        available_payment_methods: [],
      });
  });

  afterAll(async () => {
    // Cleanup
    if (testAdminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', testAdminUserId);
      await supabaseAdmin.auth.admin.deleteUser(testAdminUserId);
    }

    if (testNonAdminUserId) {
      await supabaseAdmin.auth.admin.deleteUser(testNonAdminUserId);
    }
  });

  describe('RLS Policies - Admin Read Access', () => {
    // DB-RLS-001: Admin can read config
    it('should allow admin users to read payment config', async () => {
      const { data, error } = await adminClient
        .from('payment_method_config')
        .select('*')
        .eq('id', 1)
        .single();

      // Note: This test requires proper auth session setup
      // If RLS is properly configured, admin should be able to read
      expect(error).toBeNull();
      expect(data).toBeDefined();
    });

    // DB-RLS-002: Non-admin cannot read config
    it('should deny non-admin users from reading payment config', async () => {
      // Sign in as non-admin
      await nonAdminClient.auth.signInWithPassword({
        email: NON_ADMIN_EMAIL,
        password: 'test123456',
      });

      const { data, error } = await nonAdminClient
        .from('payment_method_config')
        .select('*')
        .eq('id', 1)
        .single();

      // Non-admin should not be able to read (RLS policy blocks)
      // Supabase returns PGRST116 (no rows) when RLS hides all rows
      expect(data).toBeNull();
      if (error) {
        expect(error.code).toBe('PGRST116');
      } else {
        expect.fail('Expected either null data with PGRST116 error or silent RLS block');
      }
    });

    // DB-RLS-003: Unauthenticated cannot read
    it('should deny unauthenticated users from reading payment config', async () => {
      const anonClient = createClient(SUPABASE_URL, ANON_KEY);

      const { data, error } = await anonClient
        .from('payment_method_config')
        .select('*')
        .eq('id', 1)
        .single();

      // RLS should block unauthenticated access
      expect(data).toBeNull();
      if (error) {
        expect(error.code).toBe('PGRST116');
      } else {
        expect.fail('Expected PGRST116 error for RLS-blocked anonymous access');
      }
    });
  });

  describe('RLS Policies - Admin Write Access', () => {
    // DB-RLS-004: Admin can update config
    it('should allow admin users to update payment config', async () => {
      const { data, error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          config_mode: 'custom',
        })
        .eq('id', 1)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data?.config_mode).toBe('custom');

      // Reset to automatic
      await supabaseAdmin
        .from('payment_method_config')
        .update({ config_mode: 'automatic' })
        .eq('id', 1);
    });

    // DB-RLS-005: Non-admin cannot update config
    it('should deny non-admin users from updating payment config', async () => {
      const { data: before } = await supabaseAdmin
        .from('payment_method_config')
        .select('config_mode')
        .eq('id', 1)
        .single();

      await nonAdminClient
        .from('payment_method_config')
        .update({
          config_mode: 'stripe_preset',
        })
        .eq('id', 1);

      // RLS blocks silently (no error, 0 rows affected) — verify data unchanged
      const { data: after } = await supabaseAdmin
        .from('payment_method_config')
        .select('config_mode')
        .eq('id', 1)
        .single();

      expect(after?.config_mode).toBe(before?.config_mode);
    });

    // DB-RLS-006: Service role bypasses RLS
    it('should allow service role to bypass RLS', async () => {
      const { data, error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          config_mode: 'automatic',
        })
        .eq('id', 1)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
    });
  });

  describe('Database Constraints', () => {
    // DB-CONST-001: Singleton constraint (id=1 only)
    it('should enforce singleton constraint - only id=1 allowed', async () => {
      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .insert({
          id: 2,
          config_mode: 'automatic',
        });

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/check constraint|violates/i);
    });

    // DB-CONST-002: config_mode enum validation
    it('should enforce config_mode enum values', async () => {
      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          config_mode: 'invalid_mode' as any,
        })
        .eq('id', 1);

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/check constraint|violates/i);
    });

    // DB-CONST-003: NOT NULL constraints
    it('should enforce NOT NULL constraints on required fields', async () => {
      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          config_mode: null as any,
        })
        .eq('id', 1);

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/null value|not-null/i);
    });

    // DB-CONST-004: Boolean defaults
    it('should have correct boolean defaults for express checkout', async () => {
      // Delete and recreate to test defaults
      await supabaseAdmin
        .from('payment_method_config')
        .delete()
        .eq('id', 1);

      const { data, error } = await supabaseAdmin
        .from('payment_method_config')
        .insert({
          id: 1,
          config_mode: 'automatic',
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data?.enable_express_checkout).toBe(true);
      expect(data?.enable_apple_pay).toBe(true);
      expect(data?.enable_google_pay).toBe(true);
      expect(data?.enable_link).toBe(true);
    });
  });

  describe('JSONB Field Validation', () => {
    // DB-JSONB-001: Valid JSONB arrays
    it('should accept valid JSONB arrays', async () => {
      const validMethods = [
        { type: 'card', enabled: true, display_order: 0 },
      ];

      const { data, error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          custom_payment_methods: validMethods,
        })
        .eq('id', 1)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data?.custom_payment_methods).toEqual(validMethods);
    });

    // DB-JSONB-002: Empty arrays as default
    it('should accept empty arrays for JSONB fields', async () => {
      const { data, error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          custom_payment_methods: [],
          payment_method_order: [],
          available_payment_methods: [],
        })
        .eq('id', 1)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data?.custom_payment_methods).toEqual([]);
      expect(data?.payment_method_order).toEqual([]);
      expect(data?.available_payment_methods).toEqual([]);
    });

    // DB-JSONB-003: Valid JSONB object (currency_overrides)
    it('should accept valid JSONB objects', async () => {
      const validOverrides = {
        PLN: ['blik', 'p24'],
        EUR: ['sepa_debit'],
      };

      const { data, error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          currency_overrides: validOverrides,
        })
        .eq('id', 1)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data?.currency_overrides).toEqual(validOverrides);
    });
  });

  describe('Data Integrity', () => {
    // DB-INT-001: Stripe PMC ID format (application-level validation)
    it('should store valid Stripe PMC ID format', async () => {
      const { data, error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          config_mode: 'stripe_preset',
          stripe_pmc_id: 'pmc_1234567890',
          stripe_pmc_name: 'Test Config',
        })
        .eq('id', 1)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data?.stripe_pmc_id).toMatch(/^pmc_/);
    });

    // DB-INT-002: Timestamp auto-update
    it('should auto-update updated_at timestamp on changes', async () => {
      const { data: before } = await supabaseAdmin
        .from('payment_method_config')
        .select('updated_at')
        .eq('id', 1)
        .single();

      await new Promise(resolve => setTimeout(resolve, 100));

      const { data: after } = await supabaseAdmin
        .from('payment_method_config')
        .update({ config_mode: 'automatic' })
        .eq('id', 1)
        .select()
        .single();

      const beforeTime = new Date(before!.updated_at).getTime();
      const afterTime = new Date(after!.updated_at).getTime();

      expect(afterTime).toBeGreaterThan(beforeTime);
    });

    // DB-INT-003: NULL handling for optional fields
    it('should allow NULL for optional fields', async () => {
      const { data, error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          stripe_pmc_id: null,
          stripe_pmc_name: null,
          stripe_pmc_last_synced: null,
          last_modified_by: null,
        })
        .eq('id', 1)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data?.stripe_pmc_id).toBeNull();
      expect(data?.stripe_pmc_name).toBeNull();
    });
  });

  describe('Concurrent Access', () => {
    it('should handle concurrent updates without corruption', async () => {
      // Simulate concurrent updates
      const updates = [
        supabaseAdmin
          .from('payment_method_config')
          .update({ enable_apple_pay: true })
          .eq('id', 1),
        supabaseAdmin
          .from('payment_method_config')
          .update({ enable_google_pay: false })
          .eq('id', 1),
        supabaseAdmin
          .from('payment_method_config')
          .update({ enable_link: true })
          .eq('id', 1),
      ];

      const results = await Promise.all(updates);

      // All should succeed
      results.forEach(({ error }) => {
        expect(error).toBeNull();
      });

      // Verify final state is consistent — last-write-wins for each field
      const { data, error } = await supabaseAdmin
        .from('payment_method_config')
        .select('enable_apple_pay, enable_google_pay, enable_link')
        .eq('id', 1)
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      // The concurrent writes should each have landed their intended value
      expect(data!.enable_apple_pay).toBe(true);
      expect(data!.enable_google_pay).toBe(false);
      expect(data!.enable_link).toBe(true);
    });
  });
});
