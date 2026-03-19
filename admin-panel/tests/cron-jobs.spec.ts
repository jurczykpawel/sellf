/**
 * E2E Tests: Universal Cron Endpoint (/api/cron)
 *
 * Tests the job registry, security gate, and each job:
 *   - access-expired: dispatches access.expired webhooks for newly expired access; marks expiry_notified_at
 *   - cleanup-webhook-logs: deletes webhook_logs older than retention period
 *
 * @see admin-panel/src/app/api/cron/route.ts
 * @see supabase/migrations/20260304000001_add_expiry_notified_at.sql
 */

import { test, expect } from '@playwright/test';
import { supabaseAdmin } from './helpers/admin-auth';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3777';
const CRON_SECRET = process.env.CRON_SECRET || 'dev-cron-secret-change-in-production';

function cronUrl(job: string) {
  return `${BASE_URL}/api/cron?job=${job}`;
}

function authHeader(secret = CRON_SECRET) {
  return { Authorization: `Bearer ${secret}` };
}

test.describe('Cron endpoint: security', () => {
  test('returns 401 with no credentials', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/cron?job=access-expired`);
    expect(res.status()).toBe(401);
  });

  test('returns 401 with wrong bearer token', async ({ request }) => {
    const res = await request.get(cronUrl('access-expired'), {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    expect(res.status()).toBe(401);
  });

  test('returns 401 with wrong URL secret (fallback)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/cron?job=access-expired&secret=wrong-secret`);
    expect(res.status()).toBe(401);
  });

  test('returns 400 with valid secret but missing job', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/cron`, { headers: authHeader() });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.available).toEqual(expect.arrayContaining(['access-expired', 'cleanup-webhook-logs']));
  });

  test('returns 400 for unknown job name', async ({ request }) => {
    const res = await request.get(cronUrl('nonexistent-job'), { headers: authHeader() });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Unknown job');
  });
});

test.describe('Cron job: access-expired', () => {
  test.describe.configure({ mode: 'serial' });

  let testUserId: string;
  let testProductId: string;
  let testAccessId: string;
  let testEndpointId: string;

  test.beforeAll(async () => {
    // Create a test user
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: `cron-test-${Date.now()}@example.com`,
      password: 'password123',
      email_confirm: true,
    });
    if (userError) throw userError;
    testUserId = userData.user.id;

    // Create a test product
    const { data: productData, error: productError } = await supabaseAdmin
      .from('products')
      .insert({ name: 'Cron Test Product', slug: `cron-test-${Date.now()}`, price: 0 })
      .select('id')
      .single();
    if (productError) throw productError;
    testProductId = productData.id;

    // Create a webhook endpoint subscribed to access.expired
    // URL intentionally unreachable — dispatch will fail, but webhook_logs entry is always written
    const { data: epData, error: epError } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({
        url: 'http://localhost:19999/cron-test-hook',
        events: ['access.expired'],
        secret: 'test-secret',
        is_active: true,
      })
      .select('id')
      .single();
    if (epError) throw epError;
    testEndpointId = epData.id;
  });

  test.afterAll(async () => {
    if (testEndpointId) await supabaseAdmin.from('webhook_endpoints').delete().eq('id', testEndpointId);
    if (testUserId) await supabaseAdmin.auth.admin.deleteUser(testUserId);
    if (testProductId) await supabaseAdmin.from('products').delete().eq('id', testProductId);
  });

  test('processes 0 rows when nothing is expired', async ({ request }) => {
    const res = await request.get(cronUrl('access-expired'), { headers: authHeader() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.job).toBe('access-expired');
    // processed may be 0 or positive (other tests), but it must not error
    expect(body.errors).toBe(0);
  });

  test('fires webhook and sets expiry_notified_at for expired access', async ({ request }) => {
    // Insert access record: granted 2h ago, expired 1h ago, not yet notified
    // access_expires_at must be > access_granted_at (DB constraint)
    const grantedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const expiredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: accessData, error: insertError } = await supabaseAdmin
      .from('user_product_access')
      .insert({
        user_id: testUserId,
        product_id: testProductId,
        access_granted_at: grantedAt,
        access_expires_at: expiredAt,
        expiry_notified_at: null,
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    testAccessId = accessData.id;

    // Run the cron job
    const res = await request.get(cronUrl('access-expired'), { headers: authHeader() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.job).toBe('access-expired');
    expect(body.processed).toBeGreaterThanOrEqual(1);
    expect(body.errors).toBe(0);

    // Verify expiry_notified_at was set
    const { data: updatedRow } = await supabaseAdmin
      .from('user_product_access')
      .select('expiry_notified_at')
      .eq('id', testAccessId)
      .single();

    expect(updatedRow?.expiry_notified_at).not.toBeNull();
  });

  test('dispatch attempt is recorded in webhook_logs', async () => {
    // The previous test ran the cron which called WebhookService.trigger('access.expired').
    // Even though the endpoint URL is unreachable, dispatchWebhook() always writes to
    // webhook_logs in its finally block. Verify the log entry exists.
    const { data: logs, error } = await supabaseAdmin
      .from('webhook_logs')
      .select('id, event_type, status, http_status')
      .eq('endpoint_id', testEndpointId)
      .eq('event_type', 'access.expired')
      .order('created_at', { ascending: false })
      .limit(1);

    expect(error).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs![0].event_type).toBe('access.expired');
    // Status is 'failed' because the endpoint URL is unreachable — that's expected
    expect(['failed', 'success']).toContain(logs![0].status);
  });

  test('does not re-process already-notified records', async ({ request }) => {
    // Ensure testAccessId is already notified from previous test
    const { data: row } = await supabaseAdmin
      .from('user_product_access')
      .select('expiry_notified_at')
      .eq('id', testAccessId)
      .single();
    expect(row?.expiry_notified_at).not.toBeNull();

    // Run job again
    const res = await request.get(cronUrl('access-expired'), { headers: authHeader() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Processed count should not increase (row already has expiry_notified_at set)
    // We can't assert exact 0 because other records may exist, but errors must be 0
    expect(body.errors).toBe(0);

    // The notified_at should not have changed
    const { data: rowAfter } = await supabaseAdmin
      .from('user_product_access')
      .select('expiry_notified_at')
      .eq('id', testAccessId)
      .single();
    expect(rowAfter?.expiry_notified_at).toBe(row?.expiry_notified_at);
  });
});

test.describe('Cron job: cleanup-webhook-logs', () => {
  let oldLogId: string;
  let newLogId: string;

  test.beforeAll(async () => {
    // Need an endpoint to attach logs to
    const { data: ep } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({ url: 'https://example.com/cron-test-hook', events: ['test.event'], secret: 'testsecret' })
      .select('id')
      .single();
    if (!ep) return;

    const endpointId = ep.id;

    // Insert an old log (40 days ago)
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const { data: oldLog } = await supabaseAdmin
      .from('webhook_logs')
      .insert({
        endpoint_id: endpointId,
        event_type: 'test.event',
        payload: { test: true },
        status: 'success',
        http_status: 200,
        response_body: 'ok',
        duration_ms: 50,
        created_at: oldDate,
      })
      .select('id')
      .single();
    oldLogId = oldLog?.id;

    // Insert a recent log (1 day ago)
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const { data: newLog } = await supabaseAdmin
      .from('webhook_logs')
      .insert({
        endpoint_id: endpointId,
        event_type: 'test.event',
        payload: { test: true },
        status: 'success',
        http_status: 200,
        response_body: 'ok',
        duration_ms: 50,
        created_at: recentDate,
      })
      .select('id')
      .single();
    newLogId = newLog?.id;

    // Cleanup endpoint after logs are inserted (logs will cascade? check FK)
    // Keep endpoint alive for test; delete in afterAll
    (test as any)._endpointId = endpointId;
  });

  test.afterAll(async () => {
    // Cleanup remaining records
    if (newLogId) await supabaseAdmin.from('webhook_logs').delete().eq('id', newLogId);
  });

  test('deletes old logs and keeps recent ones', async ({ request }) => {
    const res = await request.get(cronUrl('cleanup-webhook-logs'), { headers: authHeader() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.job).toBe('cleanup-webhook-logs');
    expect(body.processed).toBeGreaterThanOrEqual(1);
    expect(body.errors).toBe(0);
    expect(body.details).toContain('Deleted logs older than 30d');

    // Old log should be gone
    const { data: checkOld } = await supabaseAdmin
      .from('webhook_logs')
      .select('id')
      .eq('id', oldLogId)
      .maybeSingle();
    expect(checkOld).toBeNull();

    // Recent log should still exist
    if (newLogId) {
      const { data: checkNew } = await supabaseAdmin
        .from('webhook_logs')
        .select('id')
        .eq('id', newLogId)
        .maybeSingle();
      expect(checkNew?.id).toBe(newLogId);
    }
  });
});
