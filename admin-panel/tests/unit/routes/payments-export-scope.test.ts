import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const rpcMock = vi.fn();
const { resolveCurrentTierMock } = vi.hoisted(() => ({ resolveCurrentTierMock: vi.fn() }));
const platformFrom = vi.fn((table: string) => {
  if (table === 'admin_users') {
    return {
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { id: 'admin-row-1', user_id: 'admin-1' }, error: null }),
        }),
      }),
    };
  }
  if (table === 'api_keys') {
    return {
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: { name: 'Test Key' }, error: null }) }),
      }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    };
  }
  throw new Error(`unexpected table ${table}`);
});

function makeTransactionsChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.gte = self;
  chain.lte = self;
  chain.order = self;
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    from: vi.fn(),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn(() => makeTransactionsChain()) })),
  createPlatformClient: vi.fn(() => ({ rpc: rpcMock, from: platformFrom })),
}));

vi.mock('@/lib/rate-limiting', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/rate-limiting')>()),
  checkRateLimit: vi.fn().mockResolvedValue(true),
  checkRateLimitForIdentifier: vi.fn().mockResolvedValue(true),
  getRateLimitIdentifier: vi.fn(),
}));

vi.mock('@/lib/license/resolve', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/license/resolve')>()),
  resolveCurrentTier: resolveCurrentTierMock,
}));

import { POST } from '@/app/api/v1/payments/export/route';
import { _resetApiKeyAuthCacheForTests } from '@/lib/api/middleware';

function makeKey(seed: string): string {
  const hex = seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, '0');
  return `sf_test_${hex}`;
}

function makeRequest(key: string): NextRequest {
  const headers = new Headers();
  headers.set('authorization', `Bearer ${key}`);
  headers.set('content-type', 'application/json');
  return new NextRequest('http://localhost/api/v1/payments/export', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
}

function mockKeyScopes(scopes: string[]) {
  rpcMock.mockResolvedValueOnce({
    data: [{
      key_id: 'key-1',
      admin_user_id: 'admin-row-1',
      scopes,
      rate_limit_per_minute: 60,
      is_valid: true,
      rejection_reason: null,
    }],
    error: null,
  });
}

beforeEach(() => {
  rpcMock.mockReset();
  resolveCurrentTierMock.mockReset();
  resolveCurrentTierMock.mockResolvedValue('registered');
  _resetApiKeyAuthCacheForTests();
});

describe('POST /api/v1/payments/export — scope gate', () => {
  it('allows a key with only payments:read', async () => {
    mockKeyScopes(['payments:read']);
    const res = await POST(makeRequest(makeKey('a')));
    expect(res.status).toBe(200);
  });

  it('rejects a key with only analytics:read', async () => {
    mockKeyScopes(['analytics:read']);
    const res = await POST(makeRequest(makeKey('b')));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a key with neither scope', async () => {
    mockKeyScopes(['products:read']);
    const res = await POST(makeRequest(makeKey('c')));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
