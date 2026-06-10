import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The refund-request free-text reason must be length-bounded so an authenticated
 * user can't bloat the DB row / downstream emails with an unbounded payload.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  checkRateLimit: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: mocks.getUser } }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: mocks.from, rpc: mocks.rpc })),
}));

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

import { POST } from '@/app/api/public/refund-request/route';

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/public/refund-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mocks.checkRateLimit.mockResolvedValue(true);
});

describe('POST /api/public/refund-request — reason length', () => {
  it('rejects a reason longer than 2000 characters before touching the DB', async () => {
    const res = await POST(makeRequest({ transactionId: 'tx-1', reason: 'a'.repeat(2001) }));
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a non-string reason', async () => {
    const res = await POST(makeRequest({ transactionId: 'tx-1', reason: { evil: true } }));
    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
