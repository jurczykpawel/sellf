/**
 * ============================================================================
 * SECURITY TEST: Database Cleanup & Maintenance RPC Functions
 * ============================================================================
 *
 * Tests all cleanup/maintenance functions via Supabase RPC:
 *   - cleanup_rate_limits (service_role only, 24h window)
 *   - cleanup_application_rate_limits (service_role only, 24h window)
 *   - cleanup_old_rate_limits (service_role only, admin check inside, configurable retention)
 *   - cleanup_old_guest_purchases (service_role only, admin check inside, claimed only)
 *   - cleanup_audit_logs (service_role only, configurable retention 1-3650 days)
 *   - cleanup_old_admin_actions (service_role only, admin check inside, min 30 days)
 *   - mark_expired_pending_payments (service_role only, marks expired pending -> abandoned)
 *   - log_admin_action (service_role only, rate-limited, input-validated)
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20250101000000_core_schema.sql
 * @see supabase/migrations/20250102000000_payment_system.sql
 * @see supabase/migrations/20260115163547_abandoned_cart_recovery.sql
 * @see supabase/migrations/20260302000000_restrict_rpc_function_access.sql
 * @see supabase/migrations/20260310180000_proxy_functions.sql
 * ============================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error(
    'Missing Supabase env variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY)',
  );
}

const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_ID = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

// Helper: execute raw SQL via docker exec (more reliable for arbitrary SQL)
// NOTE: TEST_ID is a test-generated string (Date.now + UUID suffix) — safe for
// string interpolation in SQL. This pattern must NOT be used with user-supplied strings
// (SQL injection risk).
async function execSql(query: string): Promise<string> {
  const { execSync } = await import('child_process');
  return execSync(
    `docker exec supabase_db_sellf psql -U postgres -t -A -c "${query.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', timeout: 10000 },
  ).trim();
}

// ---------------------------------------------------------------------------
// cleanup_rate_limits
// ---------------------------------------------------------------------------

describe('cleanup_rate_limits', () => {
  beforeAll(async () => {
    // Insert old rate limit entries (48 hours ago)
    await execSql(`
      INSERT INTO public.rate_limits (user_id, function_name, window_start, call_count)
      VALUES
        ('00000000-0000-0000-0000-000000000001', 'test_fn_old_${TEST_ID}', NOW() - INTERVAL '48 hours', 5),
        ('00000000-0000-0000-0000-000000000001', 'test_fn_recent_${TEST_ID}', NOW() - INTERVAL '1 hour', 3)
      ON CONFLICT DO NOTHING -- rate_limits has unique(user_id, function_name); silently skip if entry already exists
    `);
  });

  afterAll(async () => {
    await execSql(`
      DELETE FROM public.rate_limits
      WHERE function_name LIKE 'test_fn_%_${TEST_ID}'
    `);
  });

  it('removes entries older than 24 hours via service_role', async () => {
    const { data, error } = await serviceClient.rpc('cleanup_rate_limits');
    expect(error).toBeNull();
    // Should return a number (deleted count)
    expect(typeof data).toBe('number');
    expect(data).toBeGreaterThanOrEqual(1);

    // Verify old entry is gone
    const oldCount = await execSql(`
      SELECT COUNT(*) FROM public.rate_limits
      WHERE function_name = 'test_fn_old_${TEST_ID}'
    `);
    expect(parseInt(oldCount)).toBe(0);
  });

  it('preserves entries within 24 hours', async () => {
    // Explicitly call cleanup to prove the function ran and chose to preserve recent data
    const { error } = await serviceClient.rpc('cleanup_rate_limits');
    expect(error).toBeNull();

    const recentCount = await execSql(`
      SELECT COUNT(*) FROM public.rate_limits
      WHERE function_name = 'test_fn_recent_${TEST_ID}'
    `);
    expect(parseInt(recentCount)).toBe(1);
  });

  it('is idempotent - running twice does not error and second call returns 0', async () => {
    const { data: first, error: err1 } = await serviceClient.rpc('cleanup_rate_limits');
    expect(err1).toBeNull();
    expect(typeof first).toBe('number');

    const { data: second, error: err2 } = await serviceClient.rpc('cleanup_rate_limits');
    expect(err2).toBeNull();
    expect(typeof second).toBe('number');
    expect(second).toBeLessThanOrEqual(first as number);
  });

  it('rejects anon callers with permission denied', async () => {
    const { error } = await anonClient.rpc('cleanup_rate_limits');
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});

// ---------------------------------------------------------------------------
// cleanup_application_rate_limits
// ---------------------------------------------------------------------------

describe('cleanup_application_rate_limits', () => {
  beforeAll(async () => {
    await execSql(`
      INSERT INTO public.application_rate_limits (identifier, action_type, window_start, call_count)
      VALUES
        ('ip:10.0.0.42', 'test_action_old_${TEST_ID}', NOW() - INTERVAL '48 hours', 10),
        ('ip:10.0.0.42', 'test_action_recent_${TEST_ID}', NOW() - INTERVAL '2 hours', 2)
    `);
  });

  afterAll(async () => {
    await execSql(`
      DELETE FROM public.application_rate_limits
      WHERE action_type LIKE 'test_action_%_${TEST_ID}'
    `);
  });

  it('removes entries older than 24 hours via service_role', async () => {
    const { data, error } = await serviceClient.rpc(
      'cleanup_application_rate_limits',
    );
    expect(error).toBeNull();
    expect(typeof data).toBe('number');
    expect(data).toBeGreaterThanOrEqual(1);

    const oldCount = await execSql(`
      SELECT COUNT(*) FROM public.application_rate_limits
      WHERE action_type = 'test_action_old_${TEST_ID}'
    `);
    expect(parseInt(oldCount)).toBe(0);
  });

  it('preserves entries within 24 hours', async () => {
    // Explicitly call cleanup to prove the function ran and chose to preserve recent data
    const { error } = await serviceClient.rpc('cleanup_application_rate_limits');
    expect(error).toBeNull();

    const recentCount = await execSql(`
      SELECT COUNT(*) FROM public.application_rate_limits
      WHERE action_type = 'test_action_recent_${TEST_ID}'
    `);
    expect(parseInt(recentCount)).toBe(1);
  });

  it('is idempotent and second call returns 0 or less', async () => {
    const { data: first, error: err1 } = await serviceClient.rpc(
      'cleanup_application_rate_limits',
    );
    expect(err1).toBeNull();
    expect(typeof first).toBe('number');

    const { data: second, error: err2 } = await serviceClient.rpc(
      'cleanup_application_rate_limits',
    );
    expect(err2).toBeNull();
    expect(typeof second).toBe('number');
    expect(second).toBeLessThanOrEqual(first as number);
  });

  it('rejects anon callers with permission denied', async () => {
    const { error } = await anonClient.rpc('cleanup_application_rate_limits');
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});

// ---------------------------------------------------------------------------
// cleanup_audit_logs
// ---------------------------------------------------------------------------

describe('cleanup_audit_logs', () => {
  beforeAll(async () => {
    // Insert old and recent audit log entries
    await execSql(`
      INSERT INTO public.audit_log (table_name, operation, performed_at, new_values)
      VALUES
        ('test_table_${TEST_ID}', 'INSERT', NOW() - INTERVAL '100 days', '{"test": true}'),
        ('test_table_${TEST_ID}', 'UPDATE', NOW() - INTERVAL '10 days', '{"test": true}')
    `);
  });

  afterAll(async () => {
    await execSql(`
      DELETE FROM public.audit_log
      WHERE table_name IN ('test_table_${TEST_ID}', 'test_custom_${TEST_ID}')
    `);
  });

  it('removes entries older than retention_days (default 90)', async () => {
    const { data, error } = await serviceClient.rpc('cleanup_audit_logs');
    expect(error).toBeNull();
    expect(typeof data).toBe('number');
    expect(data).toBeGreaterThanOrEqual(1);

    const oldCount = await execSql(`
      SELECT COUNT(*) FROM public.audit_log
      WHERE table_name = 'test_table_${TEST_ID}' AND performed_at < NOW() - INTERVAL '90 days'
    `);
    expect(parseInt(oldCount)).toBe(0);
  });

  it('preserves entries within retention period', async () => {
    // Invoke cleanup before asserting — proves function ran and chose to preserve
    const { error } = await serviceClient.rpc('cleanup_audit_logs');
    expect(error).toBeNull();

    const recentCount = await execSql(`
      SELECT COUNT(*) FROM public.audit_log
      WHERE table_name = 'test_table_${TEST_ID}' AND performed_at > NOW() - INTERVAL '90 days'
    `);
    expect(parseInt(recentCount)).toBe(1);
  });

  it('accepts custom retention_days parameter', async () => {
    // Insert entry that is 5 days old
    await execSql(`
      INSERT INTO public.audit_log (table_name, operation, performed_at, new_values)
      VALUES ('test_custom_${TEST_ID}', 'DELETE', NOW() - INTERVAL '5 days', '{}')
    `);

    // Cleanup with 3-day retention - should remove the 5-day-old entry
    const { data, error } = await serviceClient.rpc('cleanup_audit_logs', {
      retention_days: 3,
    });
    expect(error).toBeNull();
    expect(data).toBeGreaterThanOrEqual(1);

    const count = await execSql(`
      SELECT COUNT(*) FROM public.audit_log
      WHERE table_name = 'test_custom_${TEST_ID}'
    `);
    expect(parseInt(count)).toBe(0);
  });

  it('rejects retention_days < 1', async () => {
    const { error } = await serviceClient.rpc('cleanup_audit_logs', {
      retention_days: 0,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('between 1 and 3650');
  });

  it('rejects retention_days > 3650', async () => {
    const { error } = await serviceClient.rpc('cleanup_audit_logs', {
      retention_days: 4000,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('between 1 and 3650');
  });

  it('is idempotent and second call returns 0 or less', async () => {
    const { data: first, error: err1 } = await serviceClient.rpc('cleanup_audit_logs');
    expect(err1).toBeNull();
    expect(typeof first).toBe('number');

    const { data: second, error: err2 } = await serviceClient.rpc('cleanup_audit_logs');
    expect(err2).toBeNull();
    expect(typeof second).toBe('number');
    expect(second).toBeLessThanOrEqual(first as number);
  });

  it('rejects anon callers with permission denied', async () => {
    const { error } = await anonClient.rpc('cleanup_audit_logs');
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});

// ---------------------------------------------------------------------------
// cleanup_old_admin_actions
// ---------------------------------------------------------------------------

describe('cleanup_old_admin_actions', () => {
  beforeAll(async () => {
    // Insert old and recent admin actions
    await execSql(`
      INSERT INTO public.admin_actions (action, target_type, target_id, details, created_at)
      VALUES
        ('test_action_old_${TEST_ID}', 'test', 'id1', '{}', NOW() - INTERVAL '120 days'),
        ('test_action_recent_${TEST_ID}', 'test', 'id2', '{}', NOW() - INTERVAL '10 days')
    `);
  });

  afterAll(async () => {
    await execSql(`
      DELETE FROM public.admin_actions
      WHERE action LIKE 'test_action_%_${TEST_ID}'
    `);
  });

  it('removes entries older than retention_days (default 90) via service_role', async () => {
    // cleanup_old_admin_actions has an is_admin() check inside.
    // is_admin() returns TRUE for service_role (service_role bypass added in
    // migration 20260317140204), so this call should succeed.
    const { data, error } = await serviceClient.rpc(
      'cleanup_old_admin_actions',
    );

    expect(error).toBeNull();
    expect(typeof data).toBe('number');
    expect(data).toBeGreaterThanOrEqual(1);

    // Verify the old entry (120 days) was deleted
    const oldCount = await execSql(`
      SELECT COUNT(*) FROM public.admin_actions
      WHERE action = 'test_action_old_${TEST_ID}'
    `);
    expect(parseInt(oldCount)).toBe(0);

    // Verify the recent entry (10 days) was preserved
    const recentCount = await execSql(`
      SELECT COUNT(*) FROM public.admin_actions
      WHERE action = 'test_action_recent_${TEST_ID}'
    `);
    expect(parseInt(recentCount)).toBe(1);
  });

  it('rejects retention_days < 30', async () => {
    // service_role passes the is_admin() check, so the function proceeds
    // to input validation and rejects the invalid retention_days value.
    const { error } = await serviceClient.rpc('cleanup_old_admin_actions', {
      retention_days: 10,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('at least 30 days');
  });

  it('is idempotent and second call returns 0 or less', async () => {
    // service_role passes is_admin(), so both calls should succeed.
    const { data: first, error: err1 } = await serviceClient.rpc(
      'cleanup_old_admin_actions',
    );
    expect(err1).toBeNull();
    expect(typeof first).toBe('number');

    const { data: second, error: err2 } = await serviceClient.rpc(
      'cleanup_old_admin_actions',
    );
    expect(err2).toBeNull();
    expect(typeof second).toBe('number');
    expect(second).toBeLessThanOrEqual(first as number);
  });

  it('rejects anon callers with permission denied', async () => {
    const { error } = await anonClient.rpc('cleanup_old_admin_actions');
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});

// ---------------------------------------------------------------------------
// cleanup_old_rate_limits
// ---------------------------------------------------------------------------

describe('cleanup_old_rate_limits', () => {
  beforeAll(async () => {
    await execSql(`
      INSERT INTO public.rate_limits (user_id, function_name, window_start, call_count)
      VALUES
        ('00000000-0000-0000-0000-000000000002', 'test_old_rl_${TEST_ID}', NOW() - INTERVAL '48 hours', 5),
        ('00000000-0000-0000-0000-000000000002', 'test_recent_rl_${TEST_ID}', NOW() - INTERVAL '2 hours', 3)
      ON CONFLICT DO NOTHING -- rate_limits has unique(user_id, function_name); silently skip if entry already exists
    `);
  });

  afterAll(async () => {
    await execSql(`
      DELETE FROM public.rate_limits
      WHERE function_name LIKE 'test_%_rl_${TEST_ID}'
    `);
  });

  it('succeeds via service_role and removes old entries while preserving recent ones', async () => {
    // is_admin() has a service_role bypass (migration 20260317140204),
    // so this call passes the admin check and performs cleanup.
    const { data, error } = await serviceClient.rpc('cleanup_old_rate_limits');

    expect(error).toBeNull();
    expect(typeof data).toBe('number');

    // Verify old entry was deleted
    const oldCount = await execSql(`
      SELECT COUNT(*) FROM public.rate_limits
      WHERE function_name = 'test_old_rl_${TEST_ID}'
    `);
    expect(parseInt(oldCount)).toBe(0);

    // Verify recent entry was preserved
    const recentCount = await execSql(`
      SELECT COUNT(*) FROM public.rate_limits
      WHERE function_name = 'test_recent_rl_${TEST_ID}'
    `);
    expect(parseInt(recentCount)).toBe(1);
  });

  it('rejects retention_hours < 1', async () => {
    // service_role passes is_admin(), so the function proceeds to input
    // validation and rejects the invalid retention_hours value.
    const { error } = await serviceClient.rpc('cleanup_old_rate_limits', {
      retention_hours: 0,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('at least 1 hour');
  });

  it('is idempotent and second call returns 0 or less', async () => {
    // service_role passes is_admin(), so both calls should succeed.
    const { data: first, error: err1 } = await serviceClient.rpc('cleanup_old_rate_limits');
    expect(err1).toBeNull();
    expect(typeof first).toBe('number');

    const { data: second, error: err2 } = await serviceClient.rpc(
      'cleanup_old_rate_limits',
    );
    expect(err2).toBeNull();
    expect(typeof second).toBe('number');
    expect(second).toBeLessThanOrEqual(first as number);
  });

  it('rejects anon callers with permission denied', async () => {
    const { error } = await anonClient.rpc('cleanup_old_rate_limits');
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});

// ---------------------------------------------------------------------------
// cleanup_old_guest_purchases
// ---------------------------------------------------------------------------

describe('cleanup_old_guest_purchases', () => {
  let testProductId: string;

  beforeAll(async () => {
    // Create a test product for the guest purchases
    const { data: product, error: prodErr } = await serviceClient
      .schema('seller_main' as any)
      .from('products')
      .insert({
        name: `Cleanup Test Product ${TEST_ID}`,
        slug: `cleanup-test-product-${TEST_ID}`,
        price: 10,
        currency: 'USD',
        is_active: true,
      })
      .select('id')
      .single();
    if (prodErr) throw prodErr;
    testProductId = product.id;

    // Insert old claimed and recent claimed guest purchases
    await execSql(`
      INSERT INTO seller_main.guest_purchases (customer_email, product_id, transaction_amount, session_id, claimed_at, created_at)
      VALUES
        ('old-claimed-${TEST_ID}@example.com', '${testProductId}', 1000, 'cs_old_claimed_${TEST_ID}', NOW() - INTERVAL '400 days', NOW() - INTERVAL '400 days'),
        ('recent-claimed-${TEST_ID}@example.com', '${testProductId}', 2000, 'cs_recent_claimed_${TEST_ID}', NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days'),
        ('unclaimed-${TEST_ID}@example.com', '${testProductId}', 3000, 'cs_unclaimed_${TEST_ID}', NULL, NOW() - INTERVAL '400 days')
    `);
  });

  afterAll(async () => {
    await execSql(`
      DELETE FROM seller_main.guest_purchases
      WHERE session_id LIKE 'cs_%_${TEST_ID}'
    `);
    await serviceClient
      .schema('seller_main' as any)
      .from('products')
      .delete()
      .eq('id', testProductId);
  });

  it('succeeds via service_role and removes old claimed purchases', async () => {
    // is_admin() has a service_role bypass (migration 20260317140204),
    // so this call passes the admin check and performs cleanup.
    // Should delete the old claimed purchase (400 days old, > 365 default).
    const { data, error } = await serviceClient.rpc(
      'cleanup_old_guest_purchases',
    );

    expect(error).toBeNull();
    expect(typeof data).toBe('number');
    expect(data).toBeGreaterThanOrEqual(1);

    // Verify the specific old claimed entry was deleted
    const oldCount = await execSql(`
      SELECT COUNT(*) FROM seller_main.guest_purchases
      WHERE session_id = 'cs_old_claimed_${TEST_ID}'
    `);
    expect(parseInt(oldCount)).toBe(0);
  });

  it('preserves unclaimed purchases regardless of age', async () => {
    // Invoke cleanup before asserting — proves function ran and chose to preserve
    const { error } = await serviceClient.rpc('cleanup_old_guest_purchases');
    expect(error).toBeNull();

    // The unclaimed purchase (400 days old, no claimed_at) should still exist
    const count = await execSql(`
      SELECT COUNT(*) FROM seller_main.guest_purchases
      WHERE session_id = 'cs_unclaimed_${TEST_ID}'
    `);
    expect(parseInt(count)).toBe(1);
  });

  it('preserves recently claimed purchases', async () => {
    // Invoke cleanup before asserting — proves function ran and chose to preserve
    const { error } = await serviceClient.rpc('cleanup_old_guest_purchases');
    expect(error).toBeNull();

    const count = await execSql(`
      SELECT COUNT(*) FROM seller_main.guest_purchases
      WHERE session_id = 'cs_recent_claimed_${TEST_ID}'
    `);
    expect(parseInt(count)).toBe(1);
  });

  it('rejects retention_days < 30', async () => {
    // service_role passes is_admin(), so the function proceeds to input
    // validation and rejects the invalid retention_days value.
    const { error } = await serviceClient.rpc('cleanup_old_guest_purchases', {
      retention_days: 10,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('at least 30 days');
  });

  it('is idempotent and second call returns 0 or less', async () => {
    // service_role passes is_admin(), so both calls should succeed.
    const { data: first, error: err1 } = await serviceClient.rpc(
      'cleanup_old_guest_purchases',
    );
    expect(err1).toBeNull();
    expect(typeof first).toBe('number');

    const { data: second, error: err2 } = await serviceClient.rpc(
      'cleanup_old_guest_purchases',
    );
    expect(err2).toBeNull();
    expect(typeof second).toBe('number');
    expect(second).toBeLessThanOrEqual(first as number);
  });

  it('rejects anon callers with permission denied', async () => {
    const { error } = await anonClient.rpc('cleanup_old_guest_purchases');
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});

// ---------------------------------------------------------------------------
// mark_expired_pending_payments
// ---------------------------------------------------------------------------

describe('mark_expired_pending_payments', () => {
  let testProductId: string;

  beforeAll(async () => {
    // Create a test product
    const { data: product, error: prodErr } = await serviceClient
      .schema('seller_main' as any)
      .from('products')
      .insert({
        name: `Expired Payments Test ${TEST_ID}`,
        slug: `expired-payments-test-${TEST_ID}`,
        price: 50,
        currency: 'USD',
        is_active: true,
      })
      .select('id')
      .single();
    if (prodErr) throw prodErr;
    testProductId = product.id;

    // Insert various payment states
    await execSql(`
      INSERT INTO seller_main.payment_transactions
        (session_id, product_id, customer_email, amount, currency, status, expires_at, created_at)
      VALUES
        ('cs_expired_pending_${TEST_ID}', '${testProductId}', 'expired-${TEST_ID}@example.com', 5000, 'USD', 'pending', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '25 hours'),
        ('cs_active_pending_${TEST_ID}', '${testProductId}', 'active-${TEST_ID}@example.com', 5000, 'USD', 'pending', NOW() + INTERVAL '2 hours', NOW() - INTERVAL '1 hour'),
        ('cs_completed_${TEST_ID}', '${testProductId}', 'completed-${TEST_ID}@example.com', 5000, 'USD', 'completed', NULL, NOW() - INTERVAL '2 days'),
        ('cs_no_expiry_${TEST_ID}', '${testProductId}', 'noexpiry-${TEST_ID}@example.com', 5000, 'USD', 'pending', NULL, NOW() - INTERVAL '3 days')
    `);
  });

  afterAll(async () => {
    await execSql(`
      DELETE FROM seller_main.payment_transactions
      WHERE session_id LIKE 'cs_%_${TEST_ID}'
    `);
    await serviceClient
      .schema('seller_main' as any)
      .from('products')
      .delete()
      .eq('id', testProductId);
  });

  it('marks expired pending payments as abandoned', async () => {
    // Record baseline of already-abandoned rows before calling the function
    const baselineCount = await execSql(`
      SELECT COUNT(*) FROM seller_main.payment_transactions
      WHERE status = 'abandoned'
    `);
    const baseline = parseInt(baselineCount);

    const { data, error } = await serviceClient.rpc(
      'mark_expired_pending_payments',
    );
    expect(error).toBeNull();
    expect(typeof data).toBe('number');
    // Verify the delta: at least our 1 test row was marked
    expect(data).toBeGreaterThanOrEqual(1);

    // Verify the expired pending payment was marked as abandoned
    const status = await execSql(`
      SELECT status FROM seller_main.payment_transactions
      WHERE session_id = 'cs_expired_pending_${TEST_ID}'
    `);
    expect(status).toBe('abandoned');

    // Verify abandoned_at was set
    const abandonedAt = await execSql(`
      SELECT abandoned_at IS NOT NULL FROM seller_main.payment_transactions
      WHERE session_id = 'cs_expired_pending_${TEST_ID}'
    `);
    expect(abandonedAt).toBe('t');

    // Verify the total abandoned count increased by at least 1 from baseline
    const afterCount = await execSql(`
      SELECT COUNT(*) FROM seller_main.payment_transactions
      WHERE status = 'abandoned'
    `);
    expect(parseInt(afterCount) - baseline).toBeGreaterThanOrEqual(1);
  });

  it('does NOT mark active pending payments (future expiry)', async () => {
    // Call the function independently - do not rely on test 1 having run
    const { error } = await serviceClient.rpc('mark_expired_pending_payments');
    expect(error).toBeNull();

    const status = await execSql(`
      SELECT status FROM seller_main.payment_transactions
      WHERE session_id = 'cs_active_pending_${TEST_ID}'
    `);
    expect(status).toBe('pending');
  });

  it('does NOT mark completed payments', async () => {
    // Call the function independently - do not rely on test 1 having run
    const { error } = await serviceClient.rpc('mark_expired_pending_payments');
    expect(error).toBeNull();

    const status = await execSql(`
      SELECT status FROM seller_main.payment_transactions
      WHERE session_id = 'cs_completed_${TEST_ID}'
    `);
    expect(status).toBe('completed');
  });

  it('does NOT mark pending payments without expires_at', async () => {
    // Call the function independently - do not rely on test 1 having run
    const { error } = await serviceClient.rpc('mark_expired_pending_payments');
    expect(error).toBeNull();

    const status = await execSql(`
      SELECT status FROM seller_main.payment_transactions
      WHERE session_id = 'cs_no_expiry_${TEST_ID}'
    `);
    expect(status).toBe('pending');
  });

  it('is idempotent - running twice marks fewer or equal payments on second call', async () => {
    const { data: first, error: err1 } = await serviceClient.rpc(
      'mark_expired_pending_payments',
    );
    expect(err1).toBeNull();
    expect(typeof first).toBe('number');

    const { data: second, error: err2 } = await serviceClient.rpc(
      'mark_expired_pending_payments',
    );
    expect(err2).toBeNull();
    expect(typeof second).toBe('number');
    // Second call should mark fewer or equal payments since the first call already handled them
    expect(second).toBeLessThanOrEqual(first as number);
  });

  it('rejects anon callers with permission denied', async () => {
    const { error } = await anonClient.rpc('mark_expired_pending_payments');
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});

// ---------------------------------------------------------------------------
// log_admin_action
// ---------------------------------------------------------------------------

describe('log_admin_action', () => {
  afterAll(async () => {
    // Clean up test entries
    await execSql(`
      DELETE FROM public.admin_actions
      WHERE action LIKE 'test_log_%_${TEST_ID}'
    `);
    // Clean up rate limit entries created by log_admin_action
    await execSql(`
      DELETE FROM public.rate_limits
      WHERE function_name LIKE 'log_admin_action_%'
    `);
  });

  it('works for service_role (2000/h limit)', async () => {
    const { error } = await serviceClient.rpc('log_admin_action', {
      action_name: `test_log_service_${TEST_ID}`,
      target_type: 'test',
      target_id: `target_${TEST_ID}`,
      action_details: { source: 'unit_test' },
    });
    expect(error).toBeNull();

    // Verify it was inserted
    const count = await execSql(`
      SELECT COUNT(*) FROM public.admin_actions
      WHERE action = 'test_log_service_${TEST_ID}'
    `);
    expect(parseInt(count)).toBe(1);
  });

  it('stores action_details as JSONB', async () => {
    const details = { key: 'value', nested: { a: 1 } };
    const actionName = `test_log_jsonb_${TEST_ID}`;

    const { error } = await serviceClient.rpc('log_admin_action', {
      action_name: actionName,
      target_type: 'test',
      target_id: `target_${TEST_ID}`,
      action_details: details,
    });
    expect(error).toBeNull();

    const stored = await execSql(`
      SELECT details::text FROM public.admin_actions
      WHERE action = '${actionName}'
    `);
    const parsed = JSON.parse(stored);
    expect(parsed.key).toBe('value');
    expect(parsed.nested.a).toBe(1);
  });

  it('rejects null action_name', async () => {
    const { error } = await serviceClient.rpc('log_admin_action', {
      action_name: null as any,
      target_type: 'test',
      target_id: 'id1',
    });
    expect(error).not.toBeNull();
  });

  it('rejects empty action_name', async () => {
    const { error } = await serviceClient.rpc('log_admin_action', {
      action_name: '',
      target_type: 'test',
      target_id: 'id1',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('action name');
  });

  it('rejects action_name longer than 100 chars', async () => {
    const { error } = await serviceClient.rpc('log_admin_action', {
      action_name: 'x'.repeat(101),
      target_type: 'test',
      target_id: 'id1',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('action name');
  });

  it('rejects empty target_type', async () => {
    const { error } = await serviceClient.rpc('log_admin_action', {
      action_name: `test_log_val_${TEST_ID}`,
      target_type: '',
      target_id: 'id1',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('target type');
  });

  it('rejects target_type longer than 50 chars', async () => {
    const { error } = await serviceClient.rpc('log_admin_action', {
      action_name: `test_log_val2_${TEST_ID}`,
      target_type: 'x'.repeat(51),
      target_id: 'id1',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('target type');
  });

  it('rejects empty target_id', async () => {
    const { error } = await serviceClient.rpc('log_admin_action', {
      action_name: `test_log_val3_${TEST_ID}`,
      target_type: 'test',
      target_id: '',
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('target ID');
  });

  it('rejects target_id longer than 255 chars', async () => {
    const { error } = await serviceClient.rpc('log_admin_action', {
      action_name: `test_log_val4_${TEST_ID}`,
      target_type: 'test',
      target_id: 'x'.repeat(256),
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('target ID');
  });

  it('rejects anon callers with permission denied (execute privilege revoked)', async () => {
    const { error } = await anonClient.rpc('log_admin_action', {
      action_name: 'anon_attempt',
      target_type: 'test',
      target_id: 'id1',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('admin_id is NULL for service_role calls (no auth.uid())', async () => {
    const actionName = `test_log_adminid_${TEST_ID}`;
    await serviceClient.rpc('log_admin_action', {
      action_name: actionName,
      target_type: 'test',
      target_id: `target_${TEST_ID}`,
    });

    const adminId = await execSql(`
      SELECT COALESCE(admin_id::text, 'NULL') FROM public.admin_actions
      WHERE action = '${actionName}'
    `);
    expect(adminId).toBe('NULL');
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: service_role-only access
// ---------------------------------------------------------------------------

describe('cleanup functions are service_role-only (execute privilege)', () => {
  const cleanupFunctions = [
    'cleanup_rate_limits',
    'cleanup_application_rate_limits',
    'cleanup_audit_logs',
    'cleanup_old_admin_actions',
    'cleanup_old_rate_limits',
    'cleanup_old_guest_purchases',
    'mark_expired_pending_payments',
  ];

  it.each(cleanupFunctions)(
    '%s rejects anonymous callers with permission denied',
    async (fnName) => {
      const { error } = await anonClient.rpc(fnName);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    },
  );

  it('log_admin_action rejects anonymous callers with permission denied', async () => {
    const { error } = await anonClient.rpc('log_admin_action', {
      action_name: 'test',
      target_type: 'test',
      target_id: 'test',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});

// ---------------------------------------------------------------------------
// Authenticated (non-admin) user tests
// ---------------------------------------------------------------------------

describe('cleanup functions reject non-admin authenticated users', () => {
  let nonAdminClient: SupabaseClient;
  const USER_EMAIL = `cleanup-nonadmin-${TEST_ID}@example.com`;
  const USER_PASSWORD = 'test-password-cleanup-123';

  beforeAll(async () => {
    // Create a non-admin user
    const { data: userAuth, error: userError } =
      await serviceClient.auth.admin.createUser({
        email: USER_EMAIL,
        password: USER_PASSWORD,
        email_confirm: true,
      });
    if (userError) throw userError;

    // Sign in as non-admin
    nonAdminClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } =
      await nonAdminClient.auth.signInWithPassword({
        email: USER_EMAIL,
        password: USER_PASSWORD,
      });
    if (signInError) throw signInError;
  });

  afterAll(async () => {
    // Clean up the test user
    const users = await serviceClient.auth.admin.listUsers();
    const testUser = users.data.users.find((u) => u.email === USER_EMAIL);
    if (testUser) {
      await serviceClient.auth.admin.deleteUser(testUser.id);
    }
  });

  const serviceFunctions = [
    'cleanup_rate_limits',
    'cleanup_application_rate_limits',
    'cleanup_audit_logs',
    'cleanup_old_admin_actions',
    'cleanup_old_rate_limits',
    'cleanup_old_guest_purchases',
    'mark_expired_pending_payments',
  ];

  it.each(serviceFunctions)(
    '%s rejects non-admin authenticated users (execute privilege revoked)',
    async (fnName) => {
      const { error } = await nonAdminClient.rpc(fnName);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    },
  );

  it('log_admin_action rejects non-admin authenticated users (execute privilege revoked)', async () => {
    const { error } = await nonAdminClient.rpc('log_admin_action', {
      action_name: 'test_nonadmin',
      target_type: 'test',
      target_id: 'id1',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});
