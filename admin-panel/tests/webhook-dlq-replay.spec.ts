import { test, expect } from '@playwright/test';
import { supabaseAdmin, createTestAdmin, loginAsAdmin } from './helpers/admin-auth';

test.describe('Webhook DLQ replay (UI + API)', () => {
  test.describe.configure({ mode: 'serial' });

  let endpointId: string;
  let logId: string;
  let cleanupAdmin: (() => Promise<void>) | null = null;
  let adminEmail: string;
  let adminPassword: string;

  test.beforeAll(async () => {
    const random = Math.random().toString(36).slice(2, 8);

    const { data: endpoint, error } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({
        url: `https://example.com/dlq-ui-${random}`,
        events: ['purchase.completed'],
        is_active: true,
        secret: `whsec_test_${random}`,
        description: 'DLQ UI test',
      })
      .select('id')
      .single();
    if (error) throw error;
    endpointId = endpoint!.id;

    const { data: log, error: logErr } = await supabaseAdmin
      .from('webhook_logs')
      .insert({
        endpoint_id: endpointId,
        event_type: 'purchase.completed',
        payload: { event: 'purchase.completed', timestamp: new Date().toISOString(), data: { test: 'dlq' } },
        status: 'permanently_failed',
        attempt_count: 5,
        max_attempts: 5,
        failed_permanently_at: new Date().toISOString(),
        http_status: 503,
        response_body: 'Service Unavailable',
        error_message: 'HTTP 503',
        duration_ms: 22,
      })
      .select('id')
      .single();
    if (logErr) throw logErr;
    logId = log!.id;

    const admin = await createTestAdmin('dlq-replay');
    adminEmail = admin.email;
    adminPassword = admin.password;
    cleanupAdmin = admin.cleanup;
  });

  test.afterAll(async () => {
    if (logId) await supabaseAdmin.from('webhook_logs').delete().eq('id', logId);
    if (endpointId) await supabaseAdmin.from('webhook_endpoints').delete().eq('id', endpointId);
    if (cleanupAdmin) await cleanupAdmin();
  });

  test('DLQ page lists permanently_failed delivery and Replay resets state', async ({ page }) => {
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/pl/dashboard/webhooks/deliveries');

    await expect(page.getByRole('heading', { name: /Dostawy webhooków|Webhook deliveries/i })).toBeVisible({
      timeout: 10000,
    });

    // Default filter is permanently_failed; the row should appear.
    const row = page.locator('tr', { hasText: 'purchase.completed' }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.locator('text=DLQ').first()).toBeVisible();

    await row.getByRole('button', { name: /Powtórz|Replay/i }).click();

    // After replay, the row leaves the permanently_failed filter view.
    await expect(page.locator('tr', { hasText: 'purchase.completed' })).toHaveCount(0, { timeout: 10000 });

    const { data: updated } = await supabaseAdmin
      .from('webhook_logs')
      .select('status, attempt_count, failed_permanently_at, next_retry_at')
      .eq('id', logId)
      .single();
    expect(updated!.status).toBe('pending_retry');
    expect(updated!.attempt_count).toBe(0);
    expect(updated!.failed_permanently_at).toBeNull();
    expect(updated!.next_retry_at).not.toBeNull();
  });
});
