import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const rpcMock = vi.fn();
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

function makePaymentsChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.ilike = self;
  chain.gte = self;
  chain.lte = self;
  chain.in = self;
  chain.order = self;
  chain.limit = self;
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
  createAdminClient: vi.fn(() => ({ from: vi.fn(() => makePaymentsChain()) })),
  createPlatformClient: vi.fn(() => ({ rpc: rpcMock, from: platformFrom })),
}));

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  checkRateLimitForIdentifier: vi.fn().mockResolvedValue(true),
  getRateLimitIdentifier: vi.fn(),
}));

import { GET } from '@/app/api/v1/payments/route';
import { _resetApiKeyAuthCacheForTests } from '@/lib/api/middleware';

function makeKey(seed: string): string {
  const hex = seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, '0');
  return `sf_test_${hex}`;
}

function makeRequest(key: string): NextRequest {
  const headers = new Headers();
  headers.set('authorization', `Bearer ${key}`);
  return new NextRequest('http://localhost/api/v1/payments', { method: 'GET', headers });
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
  _resetApiKeyAuthCacheForTests();
});

describe('GET /api/v1/payments — scope gate', () => {
  it('allows a key with only payments:read', async () => {
    mockKeyScopes(['payments:read']);
    const res = await GET(makeRequest(makeKey('a')));
    expect(res.status).toBe(200);
  });

  it('rejects a key with only analytics:read', async () => {
    mockKeyScopes(['analytics:read']);
    const res = await GET(makeRequest(makeKey('b')));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a key with neither scope', async () => {
    mockKeyScopes(['products:read']);
    const res = await GET(makeRequest(makeKey('c')));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
