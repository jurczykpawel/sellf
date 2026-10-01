import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { authenticateMock, testEndpointMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  testEndpointMock: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, authenticate: authenticateMock };
});

vi.mock('@/lib/services/webhook-service', () => ({
  WebhookService: { testEndpoint: testEndpointMock },
}));

import { POST } from '@/app/api/v1/webhooks/[id]/test/route';

const WEBHOOK_ID = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';

function makeAuth(webhook: { id: string; url: string; events: string[]; is_active: boolean } | null) {
  return {
    method: 'api_key' as const,
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve(webhook ? { data: webhook, error: null } : { data: null, error: { message: 'not found' } }),
          }),
        }),
      }),
    },
    admin: { userId: 'u1', adminId: 'a1', email: null },
    apiKey: { id: 'k1', name: 'test', scopes: ['webhooks:write'], rateLimitPerMinute: 60 },
    scopes: ['webhooks:write'],
  };
}

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/webhooks/${WEBHOOK_ID}/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  authenticateMock.mockReset();
  authenticateMock.mockResolvedValue(makeAuth({ id: WEBHOOK_ID, url: 'https://seller.example/hook', events: ['purchase.completed'], is_active: true }));
  testEndpointMock.mockReset();
  testEndpointMock.mockResolvedValue({ success: true, status: 200 });
});

describe('POST /api/v1/webhooks/:id/test — event_type validation', () => {
  it('accepts a known event type', async () => {
    const res = await POST(makeRequest({ event_type: 'purchase.completed' }), { params: Promise.resolve({ id: WEBHOOK_ID }) });
    expect(res.status).toBe(200);
    expect(testEndpointMock).toHaveBeenCalledWith(WEBHOOK_ID, 'purchase.completed');
  });

  it('accepts the generic test.event fallback', async () => {
    const res = await POST(makeRequest({ event_type: 'test.event' }), { params: Promise.resolve({ id: WEBHOOK_ID }) });
    expect(res.status).toBe(200);
    expect(testEndpointMock).toHaveBeenCalledWith(WEBHOOK_ID, 'test.event');
  });

  it('accepts an omitted event_type', async () => {
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: WEBHOOK_ID }) });
    expect(res.status).toBe(200);
    expect(testEndpointMock).toHaveBeenCalledWith(WEBHOOK_ID, undefined);
  });

  it('rejects an unknown event type string', async () => {
    const res = await POST(makeRequest({ event_type: 'not-a-real-event' }), { params: Promise.resolve({ id: WEBHOOK_ID }) });
    expect(res.status).toBe(400);
    expect(testEndpointMock).not.toHaveBeenCalled();
  });

  it('rejects a non-string event_type (object)', async () => {
    const res = await POST(makeRequest({ event_type: { foo: 'bar' } }), { params: Promise.resolve({ id: WEBHOOK_ID }) });
    expect(res.status).toBe(400);
    expect(testEndpointMock).not.toHaveBeenCalled();
  });

  it('rejects a non-string event_type (number)', async () => {
    const res = await POST(makeRequest({ event_type: 12345 }), { params: Promise.resolve({ id: WEBHOOK_ID }) });
    expect(res.status).toBe(400);
    expect(testEndpointMock).not.toHaveBeenCalled();
  });
});
