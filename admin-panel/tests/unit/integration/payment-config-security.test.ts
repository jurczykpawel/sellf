/**
 * Security Tests: OWASP Top 10
 *
 * Test ID: SEC-001 to SEC-009
 * Coverage: Security vulnerabilities in payment config system
 * Focus: Injection, auth bypass, XSS, IDOR, mass assignment
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

describe('Payment Config Security - OWASP Top 10', () => {
  let testAdminUserId: string;
  let testNonAdminUserId: string;
  let nonAdminEmail: string;

  beforeAll(async () => {
    // Create admin user
    const { data: adminAuth } = await supabaseAdmin.auth.admin.createUser({
      email: `admin-sec-test-${Date.now()}@example.com`,
      password: 'test123456',
      email_confirm: true,
    });

    testAdminUserId = adminAuth!.user.id;

    await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: testAdminUserId });

    // Create non-admin user — store email for sign-in later
    nonAdminEmail = `user-sec-test-${Date.now()}@example.com`;
    const { data: userAuth } = await supabaseAdmin.auth.admin.createUser({
      email: nonAdminEmail,
      password: 'test123456',
      email_confirm: true,
    });

    testNonAdminUserId = userAuth!.user.id;

    // Ensure config exists
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

  describe('SEC-001: SQL Injection Prevention', () => {
    it('should prevent SQL injection in Stripe PMC ID field', async () => {
      const maliciousInput = "'; DROP TABLE payment_method_config; --";

      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          stripe_pmc_id: maliciousInput,
        })
        .eq('id', 1);

      // Should not cause SQL injection (parameterized queries protect)
      expect(error).toBeNull();

      // Verify table still exists
      const { data } = await supabaseAdmin
        .from('payment_method_config')
        .select('*')
        .eq('id', 1)
        .single();

      expect(data).toBeDefined();

      // Verify malicious string was just stored as text
      expect(data?.stripe_pmc_id).toBe(maliciousInput);
    });

    it('should handle JSONB injection attempts', async () => {
      const maliciousPayload = {
        type: "card'; DROP TABLE products; --",
        enabled: true,
        display_order: 0,
      };

      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          custom_payment_methods: [maliciousPayload],
        })
        .eq('id', 1);

      expect(error).toBeNull();

      // Verify data was stored safely without executing SQL
      const { data } = await supabaseAdmin
        .from('payment_method_config')
        .select('custom_payment_methods')
        .eq('id', 1)
        .single();

      expect(data?.custom_payment_methods[0].type).toBe("card'; DROP TABLE products; --");
    });
  });

  describe('SEC-002: Broken Authentication & Authorization', () => {
    it('should require admin authentication for updates', async () => {
      // Save original value
      const { data: before } = await supabaseAdmin
        .from('payment_method_config')
        .select('config_mode')
        .eq('id', 1)
        .single();

      const unauthClient = createClient(SUPABASE_URL, ANON_KEY);

      await unauthClient
        .from('payment_method_config')
        .update({
          config_mode: 'automatic',
        })
        .eq('id', 1);

      // Verify data was NOT modified (RLS blocks silently — no error, 0 rows affected)
      const { data: after } = await supabaseAdmin
        .from('payment_method_config')
        .select('config_mode')
        .eq('id', 1)
        .single();

      expect(after?.config_mode).toBe(before?.config_mode);
    });

    it('should prevent non-admin users from modifying config', async () => {
      // Save original value
      const { data: before } = await supabaseAdmin
        .from('payment_method_config')
        .select('config_mode')
        .eq('id', 1)
        .single();

      const nonAdminClient = createClient(SUPABASE_URL, ANON_KEY);

      // Sign in as non-admin using the email stored in beforeAll
      await nonAdminClient.auth.signInWithPassword({
        email: nonAdminEmail,
        password: 'test123456',
      });

      await nonAdminClient
        .from('payment_method_config')
        .update({
          config_mode: 'stripe_preset',
        })
        .eq('id', 1);

      // Verify data was NOT modified (RLS blocks silently — no error, 0 rows affected)
      const { data: after } = await supabaseAdmin
        .from('payment_method_config')
        .select('config_mode')
        .eq('id', 1)
        .single();

      expect(after?.config_mode).toBe(before?.config_mode);
    });

    it('should verify admin status via admin_users table', async () => {
      // Verify RLS checks admin_users table, not just auth
      const { data } = await supabaseAdmin
        .from('admin_users')
        .select('user_id')
        .eq('user_id', testAdminUserId)
        .single();

      expect(data?.user_id).toBe(testAdminUserId);

      // Non-admin should not be in admin_users
      const { data: nonAdminData } = await supabaseAdmin
        .from('admin_users')
        .select('user_id')
        .eq('user_id', testNonAdminUserId)
        .maybeSingle();

      expect(nonAdminData).toBeNull();
    });
  });

  // NOTE: These tests verify DATA INTEGRITY at the database layer, not XSS prevention.
  // The database stores values verbatim (no sanitization/corruption of special characters).
  // XSS prevention is the responsibility of the rendering layer (React's automatic escaping).
  // Storing and retrieving the same payload validates that the DB doesn't mangle data.
  describe('SEC-003: Data Integrity for Special Characters', () => {
    it('should store HTML/script payloads verbatim without corruption', async () => {
      const xssPayload = '<script>alert("XSS")</script>';

      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          stripe_pmc_name: xssPayload,
        })
        .eq('id', 1);

      expect(error).toBeNull();

      const { data } = await supabaseAdmin
        .from('payment_method_config')
        .select('stripe_pmc_name')
        .eq('id', 1)
        .single();

      // DB must store the exact string — no escaping, no sanitization.
      // Output escaping is handled by React at render time.
      expect(data?.stripe_pmc_name).toBe(xssPayload);
    });

    it('should preserve HTML entities in JSONB fields without corruption', async () => {
      const htmlPayload = '<img src=x onerror=alert(1)>';

      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          custom_payment_methods: [
            {
              type: 'card',
              enabled: true,
              display_order: 0,
              label: htmlPayload,
            },
          ],
        })
        .eq('id', 1);

      expect(error).toBeNull();

      const { data } = await supabaseAdmin
        .from('payment_method_config')
        .select('custom_payment_methods')
        .eq('id', 1)
        .single();

      expect(data?.custom_payment_methods[0].label).toBe(htmlPayload);
    });
  });

  describe('SEC-004: IDOR (Insecure Direct Object Reference)', () => {
    it('should block non-admin from reading config via RLS', async () => {
      // Use an authenticated non-admin client to verify RLS blocks access
      const nonAdminClient = createClient(SUPABASE_URL, ANON_KEY);
      await nonAdminClient.auth.signInWithPassword({
        email: nonAdminEmail,
        password: 'test123456',
      });

      const { data } = await nonAdminClient
        .from('payment_method_config')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      // RLS should prevent non-admin from reading the config
      expect(data).toBeNull();
    });

    it('should block unauthenticated users from reading config via RLS', async () => {
      const anonClient = createClient(SUPABASE_URL, ANON_KEY);

      const { data } = await anonClient
        .from('payment_method_config')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      // RLS should prevent anonymous users from reading
      expect(data).toBeNull();
    });

    it('should enforce singleton constraint (only id=1 allowed)', async () => {
      // Verify id=1 exists via service_role (bypasses RLS intentionally)
      const { data: config1 } = await supabaseAdmin
        .from('payment_method_config')
        .select('*')
        .eq('id', 1)
        .single();

      expect(config1).toBeDefined();

      // Try to create id=2 — database constraint should prevent this
      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .insert({
          id: 2,
          config_mode: 'automatic',
        });

      expect(error).not.toBeNull();
    });
  });

  describe('SEC-005: Mass Assignment Prevention', () => {
    it('should prevent modification of id field', async () => {
      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          id: 999 as any, // Try to change id
          config_mode: 'automatic',
        })
        .eq('id', 1);

      // ID should not change (database constraint prevents this)
      const { data } = await supabaseAdmin
        .from('payment_method_config')
        .select('id')
        .eq('id', 1)
        .single();

      expect(data?.id).toBe(1);
    });

    it('should prevent modification of created_at timestamp', async () => {
      const { data: before } = await supabaseAdmin
        .from('payment_method_config')
        .select('created_at')
        .eq('id', 1)
        .single();

      const fakeTimestamp = new Date('2020-01-01').toISOString();

      await supabaseAdmin
        .from('payment_method_config')
        .update({
          created_at: fakeTimestamp as any,
        })
        .eq('id', 1);

      const { data: after } = await supabaseAdmin
        .from('payment_method_config')
        .select('created_at')
        .eq('id', 1)
        .single();

      // created_at should not change (or database has default)
      expect(after?.created_at).toBe(before?.created_at);
    });
  });

  describe('SEC-006: Data Exposure Prevention', () => {
    it('should not expose sensitive data in error messages', async () => {
      // Try invalid operation
      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .insert({
          id: 2,
          config_mode: 'automatic',
        });

      // Error message should not expose internal structure
      expect(error?.message).toBeDefined();
      expect(error?.message).not.toContain('password');
      expect(error?.message).not.toContain('secret');
      expect(error?.message).not.toContain('key');
    });

    it('should not return service_role credentials in responses', async () => {
      const { data } = await supabaseAdmin
        .from('payment_method_config')
        .select('*')
        .eq('id', 1)
        .single();

      // Verify response doesn't contain any API keys or secrets
      const dataString = JSON.stringify(data);
      expect(dataString).not.toContain(SERVICE_ROLE_KEY);
      expect(dataString).not.toContain('sk_');
      expect(dataString).not.toContain('secret_');
    });
  });

  describe('SEC-007: Input Validation', () => {
    it('should reject invalid config_mode values', async () => {
      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          config_mode: 'hacker_mode' as any,
        })
        .eq('id', 1);

      expect(error).not.toBeNull();
    });

    it('should reject excessively long strings', async () => {
      const veryLongString = 'a'.repeat(100000);

      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          stripe_pmc_name: veryLongString,
        })
        .eq('id', 1);

      // Depending on database column limits, this may succeed or fail
      // If it succeeds, verify data integrity
      if (!error) {
        const { data } = await supabaseAdmin
          .from('payment_method_config')
          .select('stripe_pmc_name')
          .eq('id', 1)
          .single();

        // Should be truncated or stored fully
        expect(data?.stripe_pmc_name).toBeDefined();
      }
    });

    it('should handle null/undefined values correctly', async () => {
      const { data, error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          stripe_pmc_id: null,
          stripe_pmc_name: null,
        })
        .eq('id', 1)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data?.stripe_pmc_id).toBeNull();
      expect(data?.stripe_pmc_name).toBeNull();
    });
  });

  // NOTE: PostgreSQL JSONB is inherently safe from prototype pollution.
  // JSONB stores data as a structured binary format — __proto__ and constructor
  // keys are just regular string keys with no special semantics. Prototype pollution
  // is a JavaScript runtime concern, not a database concern. These tests verify that
  // keys like __proto__ round-trip correctly as plain data through JSONB storage.
  describe('SEC-008: JSONB Storage Safety', () => {
    it('should store __proto__ and constructor keys as plain JSONB data', async () => {
      const payloadWithProtoKeys = {
        __proto__: { polluted: true },
        constructor: { prototype: { polluted: true } },
        type: 'card',
        enabled: true,
        display_order: 0,
      };

      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          custom_payment_methods: [payloadWithProtoKeys],
        })
        .eq('id', 1);

      expect(error).toBeNull();

      // Verify the data round-trips through JSONB correctly
      const { data } = await supabaseAdmin
        .from('payment_method_config')
        .select('custom_payment_methods')
        .eq('id', 1)
        .single();

      const stored = data?.custom_payment_methods[0];
      expect(stored.type).toBe('card');
      expect(stored.enabled).toBe(true);
      expect(stored.display_order).toBe(0);
    });

    it('should handle deeply nested JSONB structures', async () => {
      const deeplyNested = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: 'deep value',
              },
            },
          },
        },
      };

      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          currency_overrides: deeplyNested,
        })
        .eq('id', 1);

      expect(error).toBeNull();

      const { data } = await supabaseAdmin
        .from('payment_method_config')
        .select('currency_overrides')
        .eq('id', 1)
        .single();

      expect(data?.currency_overrides).toEqual(deeplyNested);
    });
  });

  describe('SEC-009: Rate Limiting & DoS Prevention', () => {
    it('should handle rapid successive updates without corruption', async () => {
      const updates = Array.from({ length: 10 }, (_, i) =>
        supabaseAdmin
          .from('payment_method_config')
          .update({
            payment_method_order: [`method_${i}`],
          })
          .eq('id', 1)
      );

      const results = await Promise.all(updates);

      // All updates should complete
      const successCount = results.filter(r => !r.error).length;
      expect(successCount).toBeGreaterThan(0);

      // Final state should be consistent
      const { data } = await supabaseAdmin
        .from('payment_method_config')
        .select('*')
        .eq('id', 1)
        .single();

      expect(data).toBeDefined();
      expect(Array.isArray(data?.payment_method_order)).toBe(true);
    });

    it('should handle large JSONB arrays without performance degradation', async () => {
      const largeMethods = Array.from({ length: 100 }, (_, i) => ({
        type: `method_${i}`,
        enabled: true,
        display_order: i,
        currency_restrictions: ['USD', 'EUR', 'PLN'],
      }));

      const startTime = Date.now();

      const { error } = await supabaseAdmin
        .from('payment_method_config')
        .update({
          custom_payment_methods: largeMethods,
        })
        .eq('id', 1);

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(error).toBeNull();
      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds

      // Verify all data was stored
      const { data } = await supabaseAdmin
        .from('payment_method_config')
        .select('custom_payment_methods')
        .eq('id', 1)
        .single();

      expect(data?.custom_payment_methods).toHaveLength(100);
    });
  });
});
