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

function makePaymentDetailChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.single = () =>
    Promise.resolve({
      data: {
        id: 'payment-1',
        customer_email: 'buyer@example.com',
        amount: 1000,
        currency: 'usd',
        status: 'completed',
        stripe_payment_intent_id: 'pi_123',
        product_id: 'product-1',
        products: { id: 'product-1', name: 'Product', slug: 'product', price: 1000, currency: 'usd', custom_checkout_fields: null },
        user_id: null,
        session_id: 'sess_1',
        refund_id: null,
        refunded_amount: 0,
        refunded_at: null,
        refunded_by: null,
        refund_reason: null,
        metadata: {},
        custom_field_values: null,
        net_total: 1000,
        tax_total: 0,
        tax_snapshot_status: 'none',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      error: null,
    });
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    from: vi.fn(),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn(() => makePaymentDetailChain()) })),
  createPlatformClient: vi.fn(() => ({ rpc: rpcMock, from: platformFrom })),
}));

vi.mock('@/lib/rate-limiting', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  checkRateLimitForIdentifier: vi.fn().mockResolvedValue(true),
  getRateLimitIdentifier: vi.fn(),
}));

import { GET } from '@/app/api/v1/payments/[id]/route';
import { _resetApiKeyAuthCacheForTests } from '@/lib/api/middleware';

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';

function makeKey(seed: string): string {
  const hex = seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, '0');
  return `sf_test_${hex}`;
}

function makeRequest(key: string): NextRequest {
  const headers = new Headers();
  headers.set('authorization', `Bearer ${key}`);
  return new NextRequest(`http://localhost/api/v1/payments/${PAYMENT_ID}`, { method: 'GET', headers });
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

function callRoute(key: string) {
  return GET(makeRequest(key), { params: Promise.resolve({ id: PAYMENT_ID }) });
}

beforeEach(() => {
  rpcMock.mockReset();
  _resetApiKeyAuthCacheForTests();
});

describe('GET /api/v1/payments/:id — scope gate', () => {
  it('allows a key with only payments:read', async () => {
    mockKeyScopes(['payments:read']);
    const res = await callRoute(makeKey('a'));
    expect(res.status).toBe(200);
  });

  it('rejects a key with only analytics:read', async () => {
    mockKeyScopes(['analytics:read']);
    const res = await callRoute(makeKey('b'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a key with neither scope', async () => {
    mockKeyScopes(['products:read']);
    const res = await callRoute(makeKey('c'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
