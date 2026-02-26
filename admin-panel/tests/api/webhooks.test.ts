/**
 * API Integration Tests: Webhooks
 *
 * Migrated from api-v1-webhooks.spec.ts (Playwright → Vitest)
 * Tests webhook CRUD operations, logs, test endpoint, and retry.
 *
 * Run: npm run test:api (requires dev server running)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { get, post, patch, del, cleanup, deleteTestApiKey, API_URL, supabase } from './setup';

interface Webhook {
  id: string;
  url: string;
  events: string[];
  description?: string;
  is_active: boolean;
  secret?: string;
  created_at: string;
  updated_at: string;
}

interface WebhookLog {
  id: string;
  endpoint_id: string;
  event_type: string;
  status: string;
  http_status?: number;
  payload?: unknown;
  response_body?: string;
  error_message?: string;
  duration_ms?: number;
  endpoint?: {
    id: string;
    url: string;
  };
  created_at: string;
}

interface WebhookTestResult {
  success: boolean;
  http_status?: number;
  error?: string;
}

interface ApiResponse<T> {
  data?: T;
  error?: { code: string; message: string };
  pagination?: { cursor: string | null; next_cursor: string | null; has_more: boolean; limit: number };
}

describe('Webhooks API v1', () => {
  const createdWebhookIds: string[] = [];
  let testWebhookId: string;
  let testLogId: string;

  beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);

    // Create a test webhook endpoint
    const { data: webhook, error: webhookError } = await supabase
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
    const { data: log, error: logError } = await supabase
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

  afterAll(async () => {
    // Cleanup logs first
    if (testLogId) {
      await supabase.from('webhook_logs').delete().eq('id', testLogId);
    }
    // Cleanup webhook
    if (testWebhookId) {
      await supabase.from('webhook_endpoints').delete().eq('id', testWebhookId);
    }
    // Cleanup created webhooks via API
    await cleanup({ webhooks: createdWebhookIds });
    await deleteTestApiKey();
  });

  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests to list webhooks', async () => {
      const response = await fetch(`${API_URL}/api/v1/webhooks`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for unauthenticated requests to single webhook', async () => {
      const response = await fetch(`${API_URL}/api/v1/webhooks/${testWebhookId}`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for unauthenticated POST requests', async () => {
      const response = await fetch(`${API_URL}/api/v1/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://example.com/webhook',
          events: ['payment.completed'],
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for unauthenticated requests to webhook logs', async () => {
      const response = await fetch(`${API_URL}/api/v1/webhooks/logs`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/v1/webhooks', () => {
    it('should return paginated list of webhooks', async () => {
      const { status, data } = await get<ApiResponse<Webhook[]>>('/api/v1/webhooks');

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('has_more');
      expect(data.pagination).toHaveProperty('next_cursor');
    });

    it('should include test webhook in list', async () => {
      const { status, data } = await get<ApiResponse<Webhook[]>>('/api/v1/webhooks');

      expect(status).toBe(200);
      const testWebhook = data.data!.find((w) => w.id === testWebhookId);
      expect(testWebhook).toBeDefined();
      expect(testWebhook!.events).toContain('payment.completed');
      expect(testWebhook!.is_active).toBe(true);
    });

    it('should support status filter - active', async () => {
      const { status, data } = await get<ApiResponse<Webhook[]>>('/api/v1/webhooks?status=active');

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      for (const w of data.data!) {
        expect(w.is_active).toBe(true);
      }
    });

    it('should support status filter - inactive', async () => {
      const { status, data } = await get<ApiResponse<Webhook[]>>('/api/v1/webhooks?status=inactive');

      expect(status).toBe(200);
      // Inactive webhooks may not exist — if any are returned, verify the filter
      for (const w of data.data!) {
        expect(w.is_active).toBe(false);
      }
    });

    it('should support limit parameter', async () => {
      const { status, data } = await get<ApiResponse<Webhook[]>>('/api/v1/webhooks?limit=5');

      expect(status).toBe(200);
      expect(data.data!.length).toBeLessThanOrEqual(5);
    });
  });

  describe('POST /api/v1/webhooks', () => {
    it('should create a new webhook', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { status, data } = await post<ApiResponse<Webhook>>('/api/v1/webhooks', {
        url: `https://example.com/new-webhook-${randomStr}`,
        events: ['payment.completed', 'user.access_granted'],
        description: 'Test created webhook',
      });

      expect(status).toBe(201);
      expect(data.data).toHaveProperty('id');
      expect(data.data!.url).toContain('new-webhook');
      expect(data.data!.events).toContain('payment.completed');
      expect(data.data!.events).toContain('user.access_granted');
      expect(data.data!.description).toBe('Test created webhook');
      expect(data.data!.is_active).toBe(true);

      createdWebhookIds.push(data.data!.id);
    });

    it('should return 400 for missing URL', async () => {
      const { status, data } = await post<ApiResponse<Webhook>>('/api/v1/webhooks', {
        events: ['payment.completed'],
      });

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
      expect(data.error!.message.toLowerCase()).toContain('url');
    });

    it('should return 400 for missing events', async () => {
      const { status, data } = await post<ApiResponse<Webhook>>('/api/v1/webhooks', {
        url: 'https://example.com/webhook',
      });

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
      expect(data.error!.message.toLowerCase()).toContain('events');
    });

    it('should return 400 for non-HTTPS URL', async () => {
      const { status, data } = await post<ApiResponse<Webhook>>('/api/v1/webhooks', {
        url: 'http://example.com/webhook',
        events: ['payment.completed'],
      });

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
      expect(data.error!.message.toLowerCase()).toContain('https');
    });

    it('should return 400 for localhost URL (SSRF protection)', async () => {
      const { status, data } = await post<ApiResponse<Webhook>>('/api/v1/webhooks', {
        url: 'https://localhost/webhook',
        events: ['payment.completed'],
      });

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should return 400 for invalid event type', async () => {
      const { status, data } = await post<ApiResponse<Webhook>>('/api/v1/webhooks', {
        url: 'https://example.com/webhook',
        events: ['invalid.event.type'],
      });

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should reject internal network URLs (SSRF protection)', async () => {
      const { status, data } = await post<ApiResponse<Webhook>>('/api/v1/webhooks', {
        url: 'http://192.168.1.1/webhook',
        events: ['payment.completed'],
      });

      expect(status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });

  describe('GET /api/v1/webhooks/:id', () => {
    it('should return webhook details', async () => {
      const { status, data } = await get<ApiResponse<Webhook>>(`/api/v1/webhooks/${testWebhookId}`);

      expect(status).toBe(200);
      expect(data.data!.id).toBe(testWebhookId);
      expect(data.data!).toHaveProperty('url');
      expect(data.data!).toHaveProperty('events');
      expect(data.data!).toHaveProperty('description');
      expect(data.data!).toHaveProperty('is_active');
      expect(data.data!).toHaveProperty('created_at');
      expect(data.data!).toHaveProperty('updated_at');
    });

    it('should return 404 for non-existent webhook', async () => {
      const { status, data } = await get<ApiResponse<Webhook>>(
        '/api/v1/webhooks/11111111-1111-4111-a111-111111111111'
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid webhook ID format', async () => {
      const { status, data } = await get<ApiResponse<Webhook>>('/api/v1/webhooks/invalid-id');

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });
  });

  describe('PATCH /api/v1/webhooks/:id', () => {
    it('should update webhook URL', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { data: webhook } = await supabase
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
        const { status, data } = await patch<ApiResponse<Webhook>>(`/api/v1/webhooks/${webhook!.id}`, {
          url: `https://example.com/updated-${newRandomStr}`,
        });

        expect(status).toBe(200);
        expect(data.data!.url).toContain('updated');
      } finally {
        await supabase.from('webhook_endpoints').delete().eq('id', webhook!.id);
      }
    });

    it('should update webhook events', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { data: webhook } = await supabase
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
        const { status, data } = await patch<ApiResponse<Webhook>>(`/api/v1/webhooks/${webhook!.id}`, {
          events: ['payment.refunded', 'user.access_granted'],
        });

        expect(status).toBe(200);
        expect(data.data!.events).toContain('payment.refunded');
        expect(data.data!.events).toContain('user.access_granted');
        expect(data.data!.events).not.toContain('payment.completed');
      } finally {
        await supabase.from('webhook_endpoints').delete().eq('id', webhook!.id);
      }
    });

    it('should update webhook is_active status', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { data: webhook } = await supabase
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
        const { status, data } = await patch<ApiResponse<Webhook>>(`/api/v1/webhooks/${webhook!.id}`, {
          is_active: false,
        });

        expect(status).toBe(200);
        expect(data.data!.is_active).toBe(false);
      } finally {
        await supabase.from('webhook_endpoints').delete().eq('id', webhook!.id);
      }
    });

    it('should return 404 for non-existent webhook', async () => {
      const { status, data } = await patch<ApiResponse<Webhook>>(
        '/api/v1/webhooks/11111111-1111-4111-a111-111111111111',
        { is_active: false }
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/webhooks/:id', () => {
    it('should delete webhook', async () => {
      const randomStr = Math.random().toString(36).substring(7);
      const { data: webhook } = await supabase
        .from('webhook_endpoints')
        .insert({
          url: `https://example.com/delete-test-${randomStr}`,
          events: ['payment.completed'],
          is_active: true,
          secret: `whsec_delete_${randomStr}`,
        })
        .select('id')
        .single();

      const { status } = await del<ApiResponse<null>>(`/api/v1/webhooks/${webhook!.id}`);
      expect(status).toBe(204);

      // Verify webhook is deleted
      const { data: check } = await supabase
        .from('webhook_endpoints')
        .select('id')
        .eq('id', webhook!.id)
        .single();

      expect(check).toBeNull();
    });

    it('should return 404 for non-existent webhook', async () => {
      const { status, data } = await del<ApiResponse<null>>(
        '/api/v1/webhooks/11111111-1111-4111-a111-111111111111'
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid webhook ID format', async () => {
      const { status, data } = await del<ApiResponse<null>>('/api/v1/webhooks/invalid-id');

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });
  });

  describe('GET /api/v1/webhooks/logs', () => {
    it('should return paginated list of webhook logs', async () => {
      const { status, data } = await get<ApiResponse<WebhookLog[]>>('/api/v1/webhooks/logs');

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('has_more');
      expect(data.pagination).toHaveProperty('next_cursor');
    });

    it('should include test log in list', async () => {
      const { status, data } = await get<ApiResponse<WebhookLog[]>>('/api/v1/webhooks/logs');

      expect(status).toBe(200);
      const testLog = data.data!.find((l) => l.id === testLogId);
      expect(testLog).toBeDefined();
      expect(testLog!.status).toBe('failed');
      expect(testLog!.event_type).toBe('payment.completed');
    });

    it('should support endpoint_id filter', async () => {
      const { status, data } = await get<ApiResponse<WebhookLog[]>>(
        `/api/v1/webhooks/logs?endpoint_id=${testWebhookId}`
      );

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      for (const l of data.data!) {
        expect(l.endpoint_id).toBe(testWebhookId);
      }
    });

    it('should support status filter', async () => {
      const { status, data } = await get<ApiResponse<WebhookLog[]>>('/api/v1/webhooks/logs?status=failed');

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      for (const l of data.data!) {
        expect(l.status).toBe('failed');
      }
    });

    it('should support event_type filter', async () => {
      const { status, data } = await get<ApiResponse<WebhookLog[]>>(
        '/api/v1/webhooks/logs?event_type=payment.completed'
      );

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      for (const l of data.data!) {
        expect(l.event_type).toBe('payment.completed');
      }
    });

    it('should return 400 for invalid status filter', async () => {
      const { status, data } = await get<ApiResponse<WebhookLog[]>>('/api/v1/webhooks/logs?status=invalid');

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should include endpoint details in log', async () => {
      const { status, data } = await get<ApiResponse<WebhookLog[]>>('/api/v1/webhooks/logs');

      expect(status).toBe(200);
      expect(data.data!.length).toBeGreaterThan(0);
      const logWithEndpoint = data.data!.find((l) => l.endpoint !== null && l.endpoint !== undefined);
      expect(logWithEndpoint).toBeDefined();
      expect(logWithEndpoint!.endpoint).toHaveProperty('id');
      expect(logWithEndpoint!.endpoint).toHaveProperty('url');
    });
  });

  describe('POST /api/v1/webhooks/:id/test', () => {
    it('should return response for test webhook', async () => {
      const { status, data } = await post<ApiResponse<WebhookTestResult>>(
        `/api/v1/webhooks/${testWebhookId}/test`,
        {}
      );

      // Webhook will likely fail since example.com doesn't accept our webhook
      // but we should get a valid response structure
      expect(status).toBe(200);
      expect(data.data!).toHaveProperty('success');
      expect(data.data!).toHaveProperty('http_status');
    });

    it('should support custom event_type', async () => {
      const { status, data } = await post<ApiResponse<WebhookTestResult>>(
        `/api/v1/webhooks/${testWebhookId}/test`,
        { event_type: 'payment.refunded' }
      );

      expect(status).toBe(200);
      expect(data.data!).toHaveProperty('success');
    });

    it('should return 404 for non-existent webhook', async () => {
      const { status, data } = await post<ApiResponse<WebhookTestResult>>(
        '/api/v1/webhooks/11111111-1111-4111-a111-111111111111/test',
        {}
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid webhook ID format', async () => {
      const { status, data } = await post<ApiResponse<WebhookTestResult>>(
        '/api/v1/webhooks/invalid-id/test',
        {}
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });
  });

  describe('POST /api/v1/webhooks/logs/:logId/retry', () => {
    it('should return response for retry', async () => {
      const { status, data } = await post<ApiResponse<WebhookTestResult>>(
        `/api/v1/webhooks/logs/${testLogId}/retry`,
        {}
      );

      // Retry will likely fail but we should get a valid response
      expect(status).toBe(200);
      expect(data.data!).toHaveProperty('success');
      expect(data.data!).toHaveProperty('http_status');
    });

    it('should return 404 for non-existent log', async () => {
      const { status, data } = await post<ApiResponse<WebhookTestResult>>(
        '/api/v1/webhooks/logs/11111111-1111-4111-a111-111111111111/retry',
        {}
      );

      expect(status).toBe(404);
      expect(data.error!.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid log ID format', async () => {
      const { status, data } = await post<ApiResponse<WebhookTestResult>>(
        '/api/v1/webhooks/logs/invalid-id/retry',
        {}
      );

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });

    it('should return 400 for retrying non-failed log', async () => {
      // Create a success log
      const { data: successLog } = await supabase
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
        const { status, data } = await post<ApiResponse<WebhookTestResult>>(
          `/api/v1/webhooks/logs/${successLog!.id}/retry`,
          {}
        );

        expect(status).toBe(400);
        expect(data.error!.code).toBe('INVALID_INPUT');
        expect(data.error!.message).toContain('failed');
      } finally {
        await supabase.from('webhook_logs').delete().eq('id', successLog!.id);
      }
    });
  });

  describe('Cursor Pagination', () => {
    it('should support cursor-based pagination for webhooks', async () => {
      const response1 = await get<ApiResponse<Webhook[]>>('/api/v1/webhooks?limit=1');
      expect(response1.status).toBe(200);

      if (!response1.data.pagination?.has_more || !response1.data.pagination?.next_cursor) {
        // Only one webhook exists — pagination cannot be fully tested
        expect(response1.data.data!.length).toBe(1);
        return;
      }

      const response2 = await get<ApiResponse<Webhook[]>>(
        `/api/v1/webhooks?limit=1&cursor=${response1.data.pagination.next_cursor}`
      );
      expect(response2.status).toBe(200);
      expect(response2.data.data!.length).toBeGreaterThan(0);
      expect(response2.data.data![0].id).not.toBe(response1.data.data![0].id);
    });

    it('should support cursor-based pagination for logs', async () => {
      const response1 = await get<ApiResponse<WebhookLog[]>>('/api/v1/webhooks/logs?limit=1');
      expect(response1.status).toBe(200);

      if (!response1.data.pagination?.has_more || !response1.data.pagination?.next_cursor) {
        // Only one log exists — pagination cannot be fully tested
        expect(response1.data.data!.length).toBe(1);
        return;
      }

      const response2 = await get<ApiResponse<WebhookLog[]>>(
        `/api/v1/webhooks/logs?limit=1&cursor=${response1.data.pagination.next_cursor}`
      );
      expect(response2.status).toBe(200);
      expect(response2.data.data!.length).toBeGreaterThan(0);
      expect(response2.data.data![0].id).not.toBe(response1.data.data![0].id);
    });

    it('should return 400 for invalid cursor format', async () => {
      const { status, data } = await get<ApiResponse<Webhook[]>>('/api/v1/webhooks?cursor=invalid-cursor');

      expect(status).toBe(400);
      expect(data.error!.code).toBe('INVALID_INPUT');
    });
  });

  describe('Response Format', () => {
    it('should use standardized success response format', async () => {
      const { status, data } = await get<ApiResponse<Webhook>>(`/api/v1/webhooks/${testWebhookId}`);

      expect(status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
      expect(data.data).toHaveProperty('url');
      expect(data.data).toHaveProperty('events');
      expect(data.data).toHaveProperty('is_active');
      expect(data.data).toHaveProperty('created_at');
    });

    it('should use standardized error response format', async () => {
      const { status, data } = await get<ApiResponse<Webhook>>('/api/v1/webhooks/invalid-id');

      expect(status).toBe(400);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code');
      expect(data.error).toHaveProperty('message');
      expect(typeof data.error!.code).toBe('string');
      expect(typeof data.error!.message).toBe('string');
    });

    it('should include pagination in list responses', async () => {
      const { status, data } = await get<ApiResponse<Webhook[]>>('/api/v1/webhooks');

      expect(status).toBe(200);
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('next_cursor');
      expect(data.pagination).toHaveProperty('has_more');
      expect(typeof data.pagination!.has_more).toBe('boolean');
    });
  });
});
