import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const rpcMock = vi.fn();
const rateLimitMock = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
  createPlatformClient: vi.fn(() => ({
    rpc: rpcMock,
    from: vi.fn(),
  })),
}));

// Stub session client so authenticateViaSession returns null cleanly
// (no console.error noise) before we exercise authenticateViaApiKey.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    from: vi.fn(),
  })),
}));

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: (...args: unknown[]) => rateLimitMock(...args),
  getRateLimitIdentifier: vi.fn(),
}));

import { authenticate, _resetApiKeyAuthCacheForTests } from '@/lib/api/middleware';

function makeKey(seed: string): string {
  // sf_test_ + 64 hex chars (matches parseApiKeyFromHeader format requirement)
  const hex = seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, '0');
  return `sf_test_${hex}`;
}

function makeRequestWithKey(key: string): NextRequest {
  const headers = new Headers();
  headers.set('authorization', `Bearer ${key}`);
  return new NextRequest('http://localhost/api/v1/test', {
    method: 'GET',
    headers,
  });
}

describe('API key auth — invalid-hash negative cache', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rateLimitMock.mockReset();
    rateLimitMock.mockResolvedValue(true);
    _resetApiKeyAuthCacheForTests();
  });

  afterEach(() => {
    _resetApiKeyAuthCacheForTests();
  });

  it('first invalid attempt hits the DB; second attempt with same hash is rejected without DB', async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ is_valid: false, rejection_reason: 'Invalid API key' }], error: null });

    const req = makeRequestWithKey(makeKey('aaaaaaaaaaaaaaaaaaaa'));

    await expect(authenticate(req)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // Second attempt with same key — must be rejected by cache, no new RPC.
    await expect(authenticate(req)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('caches the case where verify_api_key returns no rows', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });

    const req = makeRequestWithKey(makeKey('bbbbbbbbbbbbbbbbbbbb'));

    await expect(authenticate(req)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(rpcMock).toHaveBeenCalledTimes(1);

    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    await expect(authenticate(req)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('a different key is not affected by the cached one', async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ is_valid: false, rejection_reason: 'Invalid API key' }], error: null });

    await expect(authenticate(makeRequestWithKey(makeKey('cccccccccccccccccccc')))).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(rpcMock).toHaveBeenCalledTimes(1);

    rpcMock.mockResolvedValueOnce({ data: [{ is_valid: false, rejection_reason: 'Invalid API key' }], error: null });
    await expect(authenticate(makeRequestWithKey(makeKey('dddddddddddddddddddd')))).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it('refuses pre-RPC when rate limit is exhausted, regardless of cache', async () => {
    rateLimitMock.mockReset();
    rateLimitMock.mockResolvedValue(false);

    const req = makeRequestWithKey(makeKey('eeeeeeeeeeeeeeeeeeee'));
    await expect(authenticate(req)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
