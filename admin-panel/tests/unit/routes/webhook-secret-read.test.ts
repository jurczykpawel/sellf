/** @see src/lib/webhooks/signing-secret.ts */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/api', async (actual) => ({
  ...(await actual<typeof import('@/lib/api')>()), authenticate: mocks.authenticate,
}));
vi.mock('@/lib/webhooks/endpoint-products', () => ({
  getEndpointProductIds: vi.fn(async () => []),
  getEndpointProductIdsMap: vi.fn(async () => ({})),
}));
import { GET as list } from '@/app/api/v1/webhooks/route';
import { GET, PATCH } from '@/app/api/v1/webhooks/[id]/route';

const id = 'ca4d8bda-014e-46b7-a3eb-13cbf1e250af';
const stored = 'enc:v1:{"encrypted_key":"stored-value"}';
const webhook = { id, secret: stored, created_at: '2026-10-15T00:00:00Z' };
const params = { params: Promise.resolve({ id }) };

describe('rotated webhook secret reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ supabase: { from: mocks.from } });
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [webhook], error: null }),
      single: vi.fn().mockResolvedValue({ data: webhook, error: null }),
    };
    mocks.from.mockReturnValue(query);
  });
  it('returns an empty secret in endpoint details', async () => {
    const response = await GET(new NextRequest(`http://localhost/api/v1/webhooks/${id}`), params);
    expect(response.status).toBe(200);
    expect((await response.json()).data.secret).toBe('');
  });
  it('returns an empty secret in the endpoint list', async () => {
    const response = await list(new NextRequest('http://localhost/api/v1/webhooks'));
    expect(response.status).toBe(200);
    expect((await response.json()).data[0].secret).toBe('');
  });
  it.each([{}, { is_active: false }])('returns an empty secret after PATCH %j', async (body) => {
    const response = await PATCH(new NextRequest(`http://localhost/api/v1/webhooks/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), params);
    expect(response.status).toBe(200);
    expect((await response.json()).data.secret).toBe('');
  });
});
