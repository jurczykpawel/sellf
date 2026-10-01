/**
 * Unit test: saving a webhook endpoint with a custom_payload_fields key that
 * collides with a core envelope key (event/timestamp/data) is rejected at
 * write time, on both create (POST) and update (PATCH).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  checkFeature: vi.fn(),
}));

vi.mock('@/lib/api', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/api')>()),
  authenticate: mocks.authenticate,
}));
vi.mock('@/lib/license/resolve', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/license/resolve')>()),
  checkFeature: mocks.checkFeature,
}));

import { POST } from '@/app/api/v1/webhooks/route';
import { PATCH } from '@/app/api/v1/webhooks/[id]/route';

const WEBHOOK_ID = 'a1b2c3d4-e5f6-4890-abcd-ef0123456789';

function makePostRequest(body: unknown) {
  return new Request('http://localhost/api/v1/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: unknown) {
  return new Request(`http://localhost/api/v1/webhooks/${WEBHOOK_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('webhook write endpoints — reserved custom_payload_fields keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkFeature.mockResolvedValue(true);
  });

  it('POST /api/v1/webhooks rejects a custom field named "event"', async () => {
    mocks.authenticate.mockResolvedValue({ supabase: { from: vi.fn() } });

    const res = await POST(
      makePostRequest({
        url: 'https://example.com/hook',
        events: ['payment.completed'],
        custom_payload_fields: { event: 'fake.event' },
      }) as never,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('event');
  });

  it('POST /api/v1/webhooks accepts non-colliding custom field names', async () => {
    mocks.authenticate.mockResolvedValue({ supabase: { from: vi.fn() } });

    const res = await POST(
      makePostRequest({
        url: 'https://example.com/hook',
        events: ['payment.completed'],
        custom_payload_fields: { brand: 'tsa' },
      }) as never,
    );

    // Not rejected by the field-name check (may still fail later, e.g. DB access
    // in this unit test — it must never be a 400 about custom_payload_fields).
    if (res.status === 400) {
      const body = await res.json();
      expect(JSON.stringify(body)).not.toContain('reserved for the webhook envelope');
    }
  });

  it('PATCH /api/v1/webhooks/:id rejects a custom field named "data"', async () => {
    mocks.authenticate.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: WEBHOOK_ID }, error: null }) }) }),
        }),
      },
    });

    const res = await PATCH(makePatchRequest({ custom_payload_fields: { data: 'custom' } }) as never, {
      params: Promise.resolve({ id: WEBHOOK_ID }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('data');
  });
});
