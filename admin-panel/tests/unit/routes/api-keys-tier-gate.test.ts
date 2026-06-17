/**
 * Unit test: creating an API key requires at least the (free) Registered tier.
 * Free instances are denied at POST /api/v1/api-keys before any key is created.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireAdminApi: vi.fn(),
  resolveCurrentTier: vi.fn(),
  createPlatformClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: mocks.requireAdminApi }));
vi.mock('@/lib/supabase/admin', () => ({ createPlatformClient: mocks.createPlatformClient }));
vi.mock('@/lib/license/resolve', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/license/resolve')>()),
  resolveCurrentTier: mocks.resolveCurrentTier,
}));

import { POST } from '@/app/api/v1/api-keys/route';

function makeRequest() {
  return new Request('http://localhost/api/v1/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'My key', scopes: ['products:read'] }),
  });
}

describe('POST /api/v1/api-keys — tier gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({});
    mocks.requireAdminApi.mockResolvedValue({ user: { id: 'admin-1' } });
    mocks.createPlatformClient.mockReturnValue({ from: vi.fn() });
  });

  it('denies API key creation on the free tier (403) without inserting', async () => {
    mocks.resolveCurrentTier.mockResolvedValue('free');

    const res = await POST(makeRequest() as never);

    expect(res.status).toBe(403);
    expect(mocks.createPlatformClient).not.toHaveBeenCalled();
  });

  it('passes the tier gate on the registered tier (does not 403)', async () => {
    mocks.resolveCurrentTier.mockResolvedValue('registered');
    // Insert path is exercised beyond the gate; make it fail loudly so the test
    // only asserts the gate let us through (status !== 403), not the full create.
    mocks.createPlatformClient.mockReturnValue({
      from: () => ({ insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'stop' } }) }) }) }),
    });

    const res = await POST(makeRequest() as never);

    expect(res.status).not.toBe(403);
  });
});
