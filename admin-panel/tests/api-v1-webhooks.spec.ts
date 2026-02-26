/**
 * Tests for Webhooks API v1
 *
 * Tests webhook CRUD operations, logs, test endpoint, and retry.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing. Cannot run API tests.');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helper to login as admin via browser context
async function loginAsAdmin(page: any, email: string, password: string) {
  await page.goto('/login');

  await page.evaluate(async ({ email, password, url, anonKey }: { email: string; password: string; url: string; anonKey: string }) => {
    // @ts-ignore
    const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
    const sb = createBrowserClient(url, anonKey);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, {
    email,
    password,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  });

  await page.reload();
}

test.describe('Webhooks API v1', () => {
  let adminUserId: string;
  let adminEmail: string;
  const adminPassword = 'TestPassword123!';
  let testWebhookId: string;
  let testLogId: string;

  test.beforeAll(async () => {
    // Create admin user for all tests
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `webhooks-api-test-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: { full_name: 'Webhooks API Tester' }
    });

    if (error) throw error;
    adminUserId = user!.id;

    // Make user an admin
    await supabaseAdmin.from('admin_users').insert({ user_id: adminUserId });

    // Create a test webhook endpoint
    const { data: webhook, error: webhookError } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({
        url: `https://example.com/webhook-test-${randomStr}`,
        events: ['payment.completed', 'payment.refunded'],
        description: 'Test webhook endpoint',
        is_active: true,
        secret: `whsec_test_${randomStr}`,
      })
      .select('id')
      .single();

    if (webhookError) throw webhookError;
    testWebhookId = webhook.id;

    // Create a test webhook log
    const { data: log, error: logError } = await supabaseAdmin
      .from('webhook_logs')
      .insert({
        endpoint_id: testWebhookId,
        event_type: 'payment.completed',
        payload: { event: 'payment.completed', data: { test: true } },
        status: 'failed',
        http_status: 500,
        response_body: 'Internal Server Error',
        error_message: 'HTTP 500',
        duration_ms: 150,
      })
      .select('id')
      .single();

    if (logError) throw logError;
    testLogId = log.id;
  });

  test.afterAll(async () => {
    // Cleanup - delete in reverse order of foreign key dependencies
    if (testLogId) {
      await supabaseAdmin.from('webhook_logs').delete().eq('id', testLogId);
    }
    if (testWebhookId) {
      await supabaseAdmin.from('webhook_endpoints').delete().eq('id', testWebhookId);
    }
    if (adminUserId) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUserId);
      await supabaseAdmin.auth.admin.deleteUser(adminUserId);
    }
  });

  test.describe('Authentication', () => {
    test('should return 401 for unauthenticated requests to list webhooks', async ({ request }) => {
      const response = await request.get('/api/v1/webhooks');

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('should return 401 for unauthenticated requests to single webhook', async ({ request }) => {
      const response = await request.get(`/api/v1/webhooks/${testWebhookId}`);

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('should return 401 for unauthenticated POST requests', async ({ request }) => {
      const response = await request.post('/api/v1/webhooks', {
        data: {
          url: 'https://example.com/webhook',
          events: ['payment.completed']
        }
      });

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    test('should return 401 for unauthenticated requests to webhook logs', async ({ request }) => {
      const response = await request.get('/api/v1/webhooks/logs');

      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  test.describe('GET /api/v1/webhooks', () => {
    test('should return paginated list of webhooks', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toHaveProperty('pagination');
      expect(body.pagination).toHaveProperty('has_more');
      expect(body.pagination).toHaveProperty('next_cursor');
    });

    test('should include test webhook in list', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks');

      expect(response.status()).toBe(200);
      const body = await response.json();

      const testWebhook = body.data.find((w: any) => w.id === testWebhookId);
      expect(testWebhook).toBeDefined();
      expect(testWebhook.events).toContain('payment.completed');
      expect(testWebhook.is_active).toBe(true);
    });

    test('should support status filter - active', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks?status=active');

      expect(response.status()).toBe(200);
      const body = await response.json();

      // We created an active webhook in beforeAll, so results must not be empty
      expect(body.data.length).toBeGreaterThan(0);
      body.data.forEach((w: any) => {
        expect(w.is_active).toBe(true);
      });
    });

    test('should support status filter - inactive', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create an inactive webhook to ensure the filter has data to return
      const randomStr = Math.random().toString(36).substring(7);
      const { data: inactiveWebhook } = await supabaseAdmin
        .from('webhook_endpoints')
        .insert({
          url: `https://example.com/inactive-test-${randomStr}`,
          events: ['payment.completed'],
          is_active: false,
          secret: `whsec_inactive_${randomStr}`,
        })
        .select('id')
        .single();

      try {
        const response = await page.request.get('/api/v1/webhooks?status=inactive');

        expect(response.status()).toBe(200);
        const body = await response.json();

        expect(body.data.length).toBeGreaterThan(0);
        body.data.forEach((w: any) => {
          expect(w.is_active).toBe(false);
        });
      } finally {
        if (inactiveWebhook) {
          await supabaseAdmin.from('webhook_endpoints').delete().eq('id', inactiveWebhook.id);
        }
      }
    });

    test('should support limit parameter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks?limit=5');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.length).toBeLessThanOrEqual(5);
    });
  });

  test.describe('POST /api/v1/webhooks', () => {
    test('should create a new webhook', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const randomStr = Math.random().toString(36).substring(7);
      const response = await page.request.post('/api/v1/webhooks', {
        data: {
          url: `https://example.com/new-webhook-${randomStr}`,
          events: ['payment.completed', 'user.access_granted'],
          description: 'Test created webhook'
        }
      });

      expect(response.status()).toBe(201);
      const body = await response.json();

      expect(body.data).toHaveProperty('id');
      expect(body.data.url).toContain('new-webhook');
      expect(body.data.events).toContain('payment.completed');
      expect(body.data.events).toContain('user.access_granted');
      expect(body.data.description).toBe('Test created webhook');
      expect(body.data.is_active).toBe(true);

      // Cleanup
      await supabaseAdmin.from('webhook_endpoints').delete().eq('id', body.data.id);
    });

    test('should return 400 for missing URL', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/webhooks', {
        data: {
          events: ['payment.completed']
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
      expect(body.error.message.toLowerCase()).toContain('url');
    });

    test('should return 400 for missing events', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/webhooks', {
        data: {
          url: 'https://example.com/webhook'
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
      expect(body.error.message.toLowerCase()).toContain('events');
    });

    test('should return 400 for non-HTTPS URL', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/webhooks', {
        data: {
          url: 'http://example.com/webhook',
          events: ['payment.completed']
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
      expect(body.error.message.toLowerCase()).toContain('https');
    });

    test('should return 400 for localhost URL (SSRF protection)', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/webhooks', {
        data: {
          url: 'https://localhost/webhook',
          events: ['payment.completed']
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should return 400 for invalid event type', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/webhooks', {
        data: {
          url: 'https://example.com/webhook',
          events: ['invalid.event.type']
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  test.describe('GET /api/v1/webhooks/:id', () => {
    test('should return webhook details', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/webhooks/${testWebhookId}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data.id).toBe(testWebhookId);
      expect(body.data).toHaveProperty('url');
      expect(body.data).toHaveProperty('events');
      expect(body.data).toHaveProperty('description');
      expect(body.data).toHaveProperty('is_active');
      expect(body.data).toHaveProperty('created_at');
      expect(body.data).toHaveProperty('updated_at');
    });

    test('should return 404 for non-existent webhook', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks/11111111-1111-4111-a111-111111111111');

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid webhook ID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks/invalid-id');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  test.describe('PATCH /api/v1/webhooks/:id', () => {
    test('should update webhook URL', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a webhook to update
      const randomStr = Math.random().toString(36).substring(7);
      const { data: webhook } = await supabaseAdmin
        .from('webhook_endpoints')
        .insert({
          url: `https://example.com/update-test-${randomStr}`,
          events: ['payment.completed'],
          is_active: true,
          secret: `whsec_update_${randomStr}`,
        })
        .select('id')
        .single();

      try {
        const newRandomStr = Math.random().toString(36).substring(7);
        const response = await page.request.patch(`/api/v1/webhooks/${webhook!.id}`, {
          data: {
            url: `https://example.com/updated-${newRandomStr}`
          }
        });

        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.data.url).toContain('updated');
      } finally {
        await supabaseAdmin.from('webhook_endpoints').delete().eq('id', webhook!.id);
      }
    });

    test('should update webhook events', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const randomStr = Math.random().toString(36).substring(7);
      const { data: webhook } = await supabaseAdmin
        .from('webhook_endpoints')
        .insert({
          url: `https://example.com/events-test-${randomStr}`,
          events: ['payment.completed'],
          is_active: true,
          secret: `whsec_events_${randomStr}`,
        })
        .select('id')
        .single();

      try {
        const response = await page.request.patch(`/api/v1/webhooks/${webhook!.id}`, {
          data: {
            events: ['payment.refunded', 'user.access_granted']
          }
        });

        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.data.events).toContain('payment.refunded');
        expect(body.data.events).toContain('user.access_granted');
        expect(body.data.events).not.toContain('payment.completed');
      } finally {
        await supabaseAdmin.from('webhook_endpoints').delete().eq('id', webhook!.id);
      }
    });

    test('should update webhook is_active status', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const randomStr = Math.random().toString(36).substring(7);
      const { data: webhook } = await supabaseAdmin
        .from('webhook_endpoints')
        .insert({
          url: `https://example.com/active-test-${randomStr}`,
          events: ['payment.completed'],
          is_active: true,
          secret: `whsec_active_${randomStr}`,
        })
        .select('id')
        .single();

      try {
        const response = await page.request.patch(`/api/v1/webhooks/${webhook!.id}`, {
          data: {
            is_active: false
          }
        });

        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.data.is_active).toBe(false);
      } finally {
        await supabaseAdmin.from('webhook_endpoints').delete().eq('id', webhook!.id);
      }
    });

    test('should return 404 for non-existent webhook', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.patch('/api/v1/webhooks/11111111-1111-4111-a111-111111111111', {
        data: {
          is_active: false
        }
      });

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  test.describe('DELETE /api/v1/webhooks/:id', () => {
    test('should delete webhook', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a webhook to delete
      const randomStr = Math.random().toString(36).substring(7);
      const { data: webhook } = await supabaseAdmin
        .from('webhook_endpoints')
        .insert({
          url: `https://example.com/delete-test-${randomStr}`,
          events: ['payment.completed'],
          is_active: true,
          secret: `whsec_delete_${randomStr}`,
        })
        .select('id')
        .single();

      const response = await page.request.delete(`/api/v1/webhooks/${webhook!.id}`);

      // DELETE returns 204 No Content
      expect(response.status()).toBe(204);

      // Verify webhook is deleted
      const { data: check } = await supabaseAdmin
        .from('webhook_endpoints')
        .select('id')
        .eq('id', webhook!.id)
        .single();

      expect(check).toBeNull();
    });

    test('should return 404 for non-existent webhook', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.delete('/api/v1/webhooks/11111111-1111-4111-a111-111111111111');

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid webhook ID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.delete('/api/v1/webhooks/invalid-id');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  test.describe('GET /api/v1/webhooks/logs', () => {
    test('should return paginated list of webhook logs', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks/logs');

      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toHaveProperty('pagination');
      expect(body.pagination).toHaveProperty('has_more');
      expect(body.pagination).toHaveProperty('next_cursor');
    });

    test('should include test log in list', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks/logs');

      expect(response.status()).toBe(200);
      const body = await response.json();

      const testLog = body.data.find((l: any) => l.id === testLogId);
      expect(testLog).toBeDefined();
      expect(testLog.status).toBe('failed');
      expect(testLog.event_type).toBe('payment.completed');
    });

    test('should support endpoint_id filter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get(`/api/v1/webhooks/logs?endpoint_id=${testWebhookId}`);

      expect(response.status()).toBe(200);
      const body = await response.json();

      // We created a log for testWebhookId in beforeAll, so results must not be empty
      expect(body.data.length).toBeGreaterThan(0);
      body.data.forEach((l: any) => {
        expect(l.endpoint_id).toBe(testWebhookId);
      });
    });

    test('should support status filter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks/logs?status=failed');

      expect(response.status()).toBe(200);
      const body = await response.json();

      // We created a failed log in beforeAll, so results must not be empty
      expect(body.data.length).toBeGreaterThan(0);
      body.data.forEach((l: any) => {
        expect(l.status).toBe('failed');
      });
    });

    test('should support event_type filter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks/logs?event_type=payment.completed');

      expect(response.status()).toBe(200);
      const body = await response.json();

      // We created a payment.completed log in beforeAll, so results must not be empty
      expect(body.data.length).toBeGreaterThan(0);
      body.data.forEach((l: any) => {
        expect(l.event_type).toBe('payment.completed');
      });
    });

    test('should return 400 for invalid status filter', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks/logs?status=invalid');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should include endpoint details in log', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks/logs');

      expect(response.status()).toBe(200);
      const body = await response.json();

      // We created a log with an endpoint in beforeAll, so at least one must have endpoint details
      expect(body.data.length).toBeGreaterThan(0);
      const logWithEndpoint = body.data.find((l: any) => l.endpoint !== null);
      expect(logWithEndpoint).toBeDefined();
      expect(logWithEndpoint.endpoint).toHaveProperty('id');
      expect(logWithEndpoint.endpoint).toHaveProperty('url');
    });
  });

  test.describe('POST /api/v1/webhooks/:id/test', () => {
    test('should return response for test webhook', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post(`/api/v1/webhooks/${testWebhookId}/test`);

      // Webhook will likely fail since example.com doesn't accept our webhook
      // but we should get a valid response structure
      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data).toHaveProperty('success');
      expect(body.data).toHaveProperty('http_status');
    });

    test('should support custom event_type', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post(`/api/v1/webhooks/${testWebhookId}/test`, {
        data: {
          event_type: 'payment.refunded'
        }
      });

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data).toHaveProperty('success');
    });

    test('should return 404 for non-existent webhook', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/webhooks/11111111-1111-4111-a111-111111111111/test');

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid webhook ID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/webhooks/invalid-id/test');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  test.describe('POST /api/v1/webhooks/logs/:logId/retry', () => {
    test('should return response for retry', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post(`/api/v1/webhooks/logs/${testLogId}/retry`);

      // Retry will likely fail but we should get a valid response
      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.data).toHaveProperty('success');
      expect(body.data).toHaveProperty('http_status');
    });

    test('should return 404 for non-existent log', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/webhooks/logs/11111111-1111-4111-a111-111111111111/retry');

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    test('should return 400 for invalid log ID format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.post('/api/v1/webhooks/logs/invalid-id/retry');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });

    test('should return 400 for retrying non-failed log', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a success log
      const randomStr = Math.random().toString(36).substring(7);
      const { data: successLog } = await supabaseAdmin
        .from('webhook_logs')
        .insert({
          endpoint_id: testWebhookId,
          event_type: 'payment.completed',
          payload: { test: true },
          status: 'success',
          http_status: 200,
          duration_ms: 100,
        })
        .select('id')
        .single();

      try {
        const response = await page.request.post(`/api/v1/webhooks/logs/${successLog!.id}/retry`);

        expect(response.status()).toBe(400);
        const body = await response.json();
        expect(body.error.code).toBe('INVALID_INPUT');
        expect(body.error.message).toContain('failed');
      } finally {
        await supabaseAdmin.from('webhook_logs').delete().eq('id', successLog!.id);
      }
    });
  });

  test.describe('Cursor Pagination', () => {
    test('should support cursor-based pagination for webhooks', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a second webhook to guarantee pagination has multiple items
      const randomStr = Math.random().toString(36).substring(7);
      const { data: extraWebhook } = await supabaseAdmin
        .from('webhook_endpoints')
        .insert({
          url: `https://example.com/pagination-test-${randomStr}`,
          events: ['payment.completed'],
          is_active: true,
          secret: `whsec_pagination_${randomStr}`,
        })
        .select('id')
        .single();

      try {
        // Get first page with limit 1
        const response1 = await page.request.get('/api/v1/webhooks?limit=1');
        expect(response1.status()).toBe(200);
        const body1 = await response1.json();

        expect(body1.data.length).toBe(1);
        expect(body1.pagination.has_more).toBe(true);
        expect(body1.pagination.next_cursor).toBeTruthy();

        // Get second page using cursor
        const response2 = await page.request.get(
          `/api/v1/webhooks?limit=1&cursor=${body1.pagination.next_cursor}`
        );
        expect(response2.status()).toBe(200);
        const body2 = await response2.json();

        // Second page should have different items
        expect(body2.data.length).toBeGreaterThan(0);
        expect(body2.data[0].id).not.toBe(body1.data[0].id);
      } finally {
        if (extraWebhook) {
          await supabaseAdmin.from('webhook_endpoints').delete().eq('id', extraWebhook.id);
        }
      }
    });

    test('should support cursor-based pagination for logs', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      // Create a second log to guarantee pagination has multiple items
      const { data: extraLog } = await supabaseAdmin
        .from('webhook_logs')
        .insert({
          endpoint_id: testWebhookId,
          event_type: 'payment.refunded',
          payload: { event: 'payment.refunded', data: { test: true } },
          status: 'failed',
          http_status: 502,
          response_body: 'Bad Gateway',
          error_message: 'HTTP 502',
          duration_ms: 200,
        })
        .select('id')
        .single();

      try {
        // Get first page with limit 1
        const response1 = await page.request.get('/api/v1/webhooks/logs?limit=1');
        expect(response1.status()).toBe(200);
        const body1 = await response1.json();

        expect(body1.data.length).toBe(1);
        expect(body1.pagination.has_more).toBe(true);
        expect(body1.pagination.next_cursor).toBeTruthy();

        // Get second page using cursor
        const response2 = await page.request.get(
          `/api/v1/webhooks/logs?limit=1&cursor=${body1.pagination.next_cursor}`
        );
        expect(response2.status()).toBe(200);
        const body2 = await response2.json();

        // Second page should have different items
        expect(body2.data.length).toBeGreaterThan(0);
        expect(body2.data[0].id).not.toBe(body1.data[0].id);
      } finally {
        if (extraLog) {
          await supabaseAdmin.from('webhook_logs').delete().eq('id', extraLog.id);
        }
      }
    });

    test('should return 400 for invalid cursor format', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);

      const response = await page.request.get('/api/v1/webhooks?cursor=invalid-cursor');

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });
});
