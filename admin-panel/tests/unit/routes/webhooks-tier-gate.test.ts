/**
 * Unit test: creating a webhook endpoint requires at least the (free) Registered
 * tier. Free instances are denied at POST /api/v1/webhooks before creation.
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

function makeRequest() {
  return new Request('http://localhost/api/v1/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/hook', events: ['payment.completed'] }),
  });
}

describe('POST /api/v1/webhooks — tier gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ supabase: { from: vi.fn() } });
  });

  it('denies webhook creation when the webhooks feature is not available (403)', async () => {
    mocks.checkFeature.mockResolvedValue(false);

    const res = await POST(makeRequest() as never);

    expect(res.status).toBe(403);
  });

  it('passes the tier gate when the webhooks feature is available (no 403 from the gate)', async () => {
    // Feature available → the base gate must let the request through to later
    // validation; we only assert the gate itself didn't reject with 403 here.
    mocks.checkFeature.mockResolvedValue(true);

    const res = await POST(makeRequest() as never);

    // URL/events are valid, so it won't be a 403 from the base gate. (It may hit
    // a later DB error, but never a 403 at this stage.)
    expect(res.status).not.toBe(403);
  });
});
