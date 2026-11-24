import { lookup } from 'node:dns/promises';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { supabaseAdmin, createTestAdmin, loginAsAdmin } from './helpers/admin-auth';
import { webhookReceiver } from './helpers/webhook-receiver';
import { webhookTunnel } from './helpers/webhook-tunnel';

async function scopeDeliveryList(page: Page, endpointId: string) {
  await page.route(url => url.pathname === '/api/v1/webhooks/logs' && url.searchParams.get('limit') === '50', route => {
    const url = new URL(route.request().url());
    url.searchParams.set('endpoint_id', endpointId);
    return route.continue({ url: url.toString() });
  });
}

test.describe('Webhook DLQ replay (UI + API)', () => {
  test.describe.configure({ mode: 'serial' });

  let endpointId: string;
  let endpointUrl: string;
  let logId: string;
  let cleanupAdmin: (() => Promise<void>) | null = null;
  let adminEmail: string;
  let adminPassword: string;

  test.beforeAll(async () => {
    const random = Math.random().toString(36).slice(2, 8);

    endpointUrl = `https://example.com/dlq-ui-${random}`;
    const { data: endpoint, error } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({
        url: endpointUrl,
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

  test('DLQ page lists permanently_failed delivery and Replay resets state @J71', async ({ page }) => {
    await scopeDeliveryList(page, endpointId);
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/pl/dashboard/webhooks/deliveries');

    await expect(page.getByRole('heading', { name: /Dostawy webhooków|Webhook deliveries/i })).toBeVisible({
      timeout: 10000,
    });

    const row = page.locator('tr', { hasText: endpointUrl });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.locator('text=DLQ').first()).toBeVisible();

    await row.getByRole('button', { name: /Powtórz|Replay/i }).click();

    // After replay, OUR row leaves the permanently_failed filter view.
    await expect(page.locator('tr', { hasText: endpointUrl })).toHaveCount(0, { timeout: 10000 });

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

test.describe('Webhook DLQ batch replay (select-all + toolbar)', () => {
  test.describe.configure({ mode: 'serial' });

  let endpointId: string;
  let endpointUrl: string;
  const batchLogIds: string[] = [];
  let cleanupAdmin: (() => Promise<void>) | null = null;
  let adminEmail: string;
  let adminPassword: string;

  test.beforeAll(async () => {
    const random = Math.random().toString(36).slice(2, 8);

    endpointUrl = `https://example.com/dlq-batch-${random}`;
    const { data: endpoint, error } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({
        url: endpointUrl,
        events: ['purchase.completed'],
        is_active: true,
        secret: `whsec_batch_${random}`,
        description: 'DLQ batch UI test',
      })
      .select('id')
      .single();
    if (error) throw error;
    endpointId = endpoint!.id;

    // Three DLQ rows so select-all + batch is meaningful.
    for (let i = 0; i < 3; i++) {
      const { data: log, error: logErr } = await supabaseAdmin
        .from('webhook_logs')
        .insert({
          endpoint_id: endpointId,
          event_type: 'purchase.completed',
          payload: { event: 'purchase.completed', data: { batch: i } },
          status: 'permanently_failed',
          attempt_count: 5,
          max_attempts: 5,
          failed_permanently_at: new Date().toISOString(),
          http_status: 503,
          duration_ms: 0,
        })
        .select('id')
        .single();
      if (logErr) throw logErr;
      batchLogIds.push(log!.id);
    }

    const admin = await createTestAdmin('dlq-batch');
    adminEmail = admin.email;
    adminPassword = admin.password;
    cleanupAdmin = admin.cleanup;
  });

  test.afterAll(async () => {
    if (batchLogIds.length > 0) {
      await supabaseAdmin.from('webhook_logs').delete().in('id', batchLogIds);
    }
    if (endpointId) await supabaseAdmin.from('webhook_endpoints').delete().eq('id', endpointId);
    if (cleanupAdmin) await cleanupAdmin();
  });

  test('select-all checkbox + "Replay selected" toolbar resets all DLQ rows in one click', async ({ page }) => {
    await scopeDeliveryList(page, endpointId);
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/pl/dashboard/webhooks/deliveries');

    await expect(page.locator('tr', { hasText: endpointUrl })).toHaveCount(3, {
      timeout: 10000,
    });

    // Click select-all header checkbox (aria-label set in WebhookLogsTable)
    const selectAll = page.getByRole('checkbox', { name: /Zaznacz wszystkie|Select all/i });
    await expect(selectAll).toBeVisible();
    await selectAll.check();

    const batchReplayBtn = page.getByRole('button', { name: /^(Powtórz|Replay) \(3\)$/i });
    await expect(batchReplayBtn).toBeVisible();
    await expect(batchReplayBtn).toBeEnabled();

    const batchForceRetryBtn = page.getByRole('button', { name: /Ponów teraz|Retry now/i });
    await expect(batchForceRetryBtn).toBeDisabled();
    const batchCancelBtn = page.getByRole('button', { name: /Anuluj|Cancel/i });
    await expect(batchCancelBtn).toBeDisabled();

    await batchReplayBtn.click();

    // Confirm modal appears (in-app modal, not native confirm())
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal).toContainText(/Wznowić ponawianie|Re-queue/i);
    await modal.getByRole('button', { name: /^Powtórz$|^Replay$/i }).click();

    // After batch replay, OUR DLQ rows no longer appear in the default filter view.
    await expect(page.locator('tr', { hasText: endpointUrl })).toHaveCount(0, {
      timeout: 15000,
    });

    // Verify DB: all 3 reset to pending_retry
    const { data: rows } = await supabaseAdmin
      .from('webhook_logs')
      .select('id, status, attempt_count, failed_permanently_at, next_retry_at')
      .in('id', batchLogIds);

    expect(rows!.length).toBe(3);
    for (const row of rows!) {
      expect(row.status).toBe('pending_retry');
      expect(row.attempt_count).toBe(0);
      expect(row.failed_permanently_at).toBeNull();
      expect(row.next_retry_at).not.toBeNull();
    }
  });
});

test.describe('Webhook DLQ batch — pending_retry → Force retry batch path', () => {
  test.describe.configure({ mode: 'serial' });

  let endpointId: string;
  let endpointUrl: string;
  const pendingIds: string[] = [];
  let cleanupAdmin: (() => Promise<void>) | null = null;
  let adminEmail: string;
  let adminPassword: string;

  test.beforeAll(async () => {
    const random = Math.random().toString(36).slice(2, 8);
    endpointUrl = `https://example.com/pending-batch-${random}`;
    const { data: endpoint } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({
        url: endpointUrl,
        events: ['purchase.completed'],
        is_active: true,
        secret: `whsec_pending_${random}`,
        description: 'pending batch UI test',
      })
      .select('id')
      .single();
    endpointId = endpoint!.id;

    // Future next_retry_at so the row is "scheduled but not due" — that's
    // the exact state where Force retry now is the only sensible batch action.
    for (let i = 0; i < 2; i++) {
      const { data: log } = await supabaseAdmin
        .from('webhook_logs')
        .insert({
          endpoint_id: endpointId,
          event_type: 'purchase.completed',
          payload: { event: 'purchase.completed', data: { p: i } },
          status: 'pending_retry',
          attempt_count: 2,
          max_attempts: 5,
          next_retry_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          http_status: 503,
          duration_ms: 0,
        })
        .select('id')
        .single();
      pendingIds.push(log!.id);
    }

    const admin = await createTestAdmin('pending-batch');
    adminEmail = admin.email;
    adminPassword = admin.password;
    cleanupAdmin = admin.cleanup;
  });

  test.afterAll(async () => {
    if (pendingIds.length > 0) {
      await supabaseAdmin.from('webhook_logs').delete().in('id', pendingIds);
    }
    if (endpointId) await supabaseAdmin.from('webhook_endpoints').delete().eq('id', endpointId);
    if (cleanupAdmin) await cleanupAdmin();
  });

  test('with pending_retry selection: Replay is disabled, Force retry + Cancel are enabled with correct counts', async ({ page }) => {
    await scopeDeliveryList(page, endpointId);
    await loginAsAdmin(page, adminEmail, adminPassword);
    await page.goto('/pl/dashboard/webhooks/deliveries');

    // Switch to pending_retry filter.
    await page.getByRole('button', { name: /Oczekuje na ponowienie|Pending retry/i }).first().click();

    await expect(page.locator('tbody tr', { hasText: endpointUrl })).toHaveCount(2, { timeout: 10000 });

    const selectAll = page.getByRole('checkbox', { name: /Zaznacz wszystkie|Select all/i });
    await selectAll.check();

    // Replay button is disabled (no DLQ items in pending_retry filter)
    const replayBtn = page.getByRole('button', { name: /Powtórz \(0\)|Replay \(0\)/i });
    await expect(replayBtn).toBeDisabled();

    const forceRetryBtn = page.getByRole('button', { name: /^(Ponów teraz|Retry now) \(2\)$/i });
    await expect(forceRetryBtn).toBeEnabled();

    const cancelBtn = page.getByRole('button', { name: /^(Anuluj|Cancel) \(2\)$/i });
    await expect(cancelBtn).toBeEnabled();

    await forceRetryBtn.click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await modal.getByRole('button', { name: /^Ponów teraz$|^Retry now$/i }).click();

    // The batch changes both schedules from an hour in the future to now.
    await expect
      .poll(
        async () => {
          const { data: rows } = await supabaseAdmin
            .from('webhook_logs')
            .select('id, next_retry_at')
            .in('id', pendingIds);
          if (!rows || rows.length !== 2) return false;
          return rows.every(
            (row) => Math.abs(new Date(row.next_retry_at!).getTime() - Date.now()) < 60_000,
          );
        },
        { timeout: 20_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
  });
});

test('order delivery retry retains metadata in the logs panel @J71', async ({ page, request }) => {
  const { storeBuyerPayload } = await import('@/lib/webhooks/buyer-payload-storage');
  const admin = await createTestAdmin('order-delivery-retry');
  test.setTimeout(180_000);
  const receiver = await webhookReceiver('whsec_fixture');
  let tunnel: Awaited<ReturnType<typeof webhookTunnel>> | undefined;
  const marker = `order-link-${crypto.randomUUID()}`;
  const payload = { event: 'order.placed', data: { order: { payUrl: `https://shop.example/pay?token=${marker}` } } };
  let endpointId: string | undefined;
  try {
    tunnel = await webhookTunnel(receiver.url);
    await expect.poll(async () => {
      try {
        await lookup(new URL(tunnel!.url).hostname, { all: true });
        return (await request.get(tunnel!.url, { timeout: 5000 })).status();
      } catch { return 0; }
    }, { timeout: 90_000 }).toBe(401);
    const endpoint = await supabaseAdmin.from('webhook_endpoints').insert({
      url: tunnel.url, events: ['order.placed'], is_active: true, secret: 'whsec_fixture',
      description: marker, product_filter_mode: 'all',
    }).select('id').single();
    expect(endpoint.error).toBeNull();
    endpointId = endpoint.data!.id;
    const inserted = await supabaseAdmin.from('webhook_logs').insert({
      endpoint_id: endpointId, event_type: 'order.placed', payload: await storeBuyerPayload('order.placed', payload),
      status: 'failed', attempt_count: 1, max_attempts: 5, http_status: 503,
    }).select('id').single();
    expect(inserted.error).toBeNull();
    const logId = inserted.data!.id;
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/webhooks');
    const endpointRow = page.getByRole('row').filter({ hasText: marker });
    await endpointRow.getByRole('button', { name: 'Logi', exact: true }).click();
    const drawer = page.getByRole('dialog').filter({ hasText: tunnel.url });
    const row = drawer.getByRole('row').filter({ hasText: 'order.placed' });
    await expect(row).toBeVisible();
    const retryResponse = page.waitForResponse(r => r.url().includes(`/webhooks/logs/${logId}/retry`) && r.request().method() === 'POST');
    await row.getByRole('button', { name: /^Ponów$|^Retry$/i }).click();
    const response = await retryResponse;
    expect(response.status()).toBe(200);
    expect((await response.json()).data).toMatchObject({ success: true, http_status: 200 });
    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0]).toMatchObject(payload);
    const stored = await supabaseAdmin.from('webhook_logs').select('*').eq('id', logId).single();
    expect(stored.error).toBeNull();
    expect(stored.data).toMatchObject({ status: 'success', http_status: 200, attempt_count: 2, response_body: null });
    expect(JSON.stringify(stored.data)).not.toContain('token=');
    const logs = await page.request.get(`/api/v1/webhooks/logs?endpoint_id=${endpointId}`);
    expect(logs.status()).toBe(200);
    expect(await logs.text()).not.toContain('token=');
  } finally {
    if (endpointId) {
      await supabaseAdmin.from('webhook_logs').delete().eq('endpoint_id', endpointId);
      await supabaseAdmin.from('webhook_endpoints').delete().eq('id', endpointId);
    }
    await tunnel?.close();
    await receiver.close();
    await admin.cleanup();
  }
});

test('URL changes keep earlier deliveries closed in API and panel @J71', async ({ page, request }) => {
  const admin = await createTestAdmin('delivery-destination');
  let endpointId: string | undefined;
  try {
    await loginAsAdmin(page, admin.email, admin.password);
    const createdKey = await page.request.post('/api/v1/api-keys', { data: { name: 'Delivery configuration', scopes: ['webhooks:write'] } });
    expect(createdKey.status()).toBe(201);
    const keyBody = await createdKey.json();
    const key = keyBody.data.key;
    expect(key).toMatch(/^sf_/);
    const headers = { Authorization: `Bearer ${key}` };
    const url = `https://example.com/destination-${crypto.randomUUID()}`;
    const endpoint = await supabaseAdmin.from('webhook_endpoints').insert({ url, secret: 'whsec_destination', events: ['purchase.completed'], is_active: true }).select('id').single();
    expect(endpoint.error).toBeNull();
    endpointId = endpoint.data!.id;
    const log = await supabaseAdmin.from('webhook_logs').insert({ endpoint_id: endpointId, event_type: 'purchase.completed', payload: {}, status: 'pending_retry', attempt_count: 1, next_retry_at: new Date(Date.now() + 3600000).toISOString() }).select('id').single();
    expect(log.error).toBeNull();
    const changed = await request.patch(`/api/v1/webhooks/${endpointId}`, { headers, data: { url: `${url}-new` } });
    expect(changed.status()).toBe(200);
    const path = `/api/v1/webhooks/logs/${log.data!.id}`;
    for (const action of ['replay', 'force-retry', 'retry']) {
      expect((await request.post(`${path}/${action}`, { headers, data: {} })).status()).toBe(403);
      expect((await page.request.post(`${path}/${action}`, { data: {} })).status()).toBe(409);
    }
    const closed = await supabaseAdmin.from('webhook_logs').select('status,next_retry_at').eq('id', log.data!.id).single();
    expect(closed.data).toMatchObject({ status: 'permanently_failed', next_retry_at: null });
    for (const [locale, message] of [['pl', 'Adres webhooka został zmieniony.'], ['en', 'The endpoint URL changed.']]) {
      await page.goto(`/${locale}/dashboard/webhooks/deliveries`);
      const table = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Endpoint', exact: true }) });
      const row = table.getByRole('row').filter({ hasText: `${url}-new` });
      const next = page.getByRole('button', { name: /^(Następna strona|Next page)$/ });
      await expect(table).toBeVisible();
      while (await row.count() === 0 && await next.count() > 0 && await next.isEnabled()) {
        await next.click();
        await expect(table).toBeVisible();
      }
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: /Powtórz|Replay/i }).click();
      await expect(page.getByText(message, { exact: false })).toBeVisible();
    }
    const fresh = await supabaseAdmin.from('webhook_logs').insert({ endpoint_id: endpointId, event_type: 'purchase.completed', payload: {}, status: 'permanently_failed' }).select('id').single();
    expect(fresh.error).toBeNull();
    expect((await page.request.post(`/api/v1/webhooks/logs/${fresh.data!.id}/replay`, { data: {} })).status()).toBe(200);
  } finally {
    if (endpointId) { await supabaseAdmin.from('webhook_logs').delete().eq('endpoint_id', endpointId); await supabaseAdmin.from('webhook_endpoints').delete().eq('id', endpointId); }
    await admin.cleanup();
  }
});

test('webhook deliveries can reach older records and reset the page on filter change @J71', async ({ page }) => {
  const admin = await createTestAdmin('delivery-pagination');
  let endpointId: string | undefined;
  try {
    const description = `Delivery history ${crypto.randomUUID()}`;
    const endpoint = await supabaseAdmin.from('webhook_endpoints').insert({
      url: 'https://example.com/delivery-history',
      events: ['purchase.completed'],
      is_active: false,
      secret: 'whsec_fixture',
      description,
    }).select('id').single();
    expect(endpoint.error).toBeNull();
    endpointId = endpoint.data!.id;

    const delivery = { endpoint_id: endpointId, event_type: 'purchase.completed', payload: {}, status: 'archived' as const };
    const now = Date.now();
    const inserted = await supabaseAdmin.from('webhook_logs').insert([
      { ...delivery, event_type: 'order.placed', created_at: new Date(now - 1).toISOString() },
      ...Array.from({ length: 50 }, () => ({ ...delivery, created_at: new Date(now).toISOString() })),
    ]);
    expect(inserted.error).toBeNull();

    await scopeDeliveryList(page, endpointId);
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/webhooks/deliveries');
    await page.getByRole('button', { name: 'Zarchiwizowane', exact: true }).click();
    const rows = page.getByRole('row').filter({ hasText: description });
    const older = rows.filter({ hasText: 'order.placed' });
    await expect(rows.filter({ hasText: 'purchase.completed' }).first()).toBeVisible();
    await expect(older).toHaveCount(0);

    const next = page.getByRole('button', { name: 'Następna strona', exact: true });
    const previous = page.getByRole('button', { name: 'Poprzednia strona', exact: true });
    await expect(next).toBeEnabled();
    await next.click();
    await expect(older).toBeVisible();
    await previous.click();
    await expect(older).toHaveCount(0);

    await next.click();
    await expect(older).toBeVisible();
    const changedFilter = page.waitForRequest(request => {
      const url = new URL(request.url());
      return url.pathname === '/api/v1/webhooks/logs' && url.searchParams.get('status') === 'permanently_failed';
    });
    await page.getByRole('button', { name: 'DLQ (trwale nieudane)', exact: true }).click();
    expect(new URL((await changedFilter).url()).searchParams.has('cursor')).toBe(false);
    await expect(older).toHaveCount(0);
  } finally {
    if (endpointId) {
      await supabaseAdmin.from('webhook_logs').delete().eq('endpoint_id', endpointId);
      await supabaseAdmin.from('webhook_endpoints').delete().eq('id', endpointId);
    }
    await admin.cleanup();
  }
});
