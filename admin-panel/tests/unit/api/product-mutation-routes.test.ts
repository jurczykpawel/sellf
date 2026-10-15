/** @see src/app/api/v1/products/route.ts */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  authenticate: mocks.authenticate,
}));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { POST } from '@/app/api/v1/products/route';
import { PATCH, DELETE } from '@/app/api/v1/products/[id]/route';

const actor = 'dddddddd-0000-4000-a000-000000000000';
const product = { id: 'aaaaaaaa-0000-4000-a000-000000000001', name: 'Course', slug: 'course', price: 49, currency: 'USD', product_type: 'digital', is_active: true };
const context = { params: Promise.resolve({ id: product.id }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation(() => {
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query), neq: vi.fn(() => query),
      insert: vi.fn(() => query), update: vi.fn(() => query), delete: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      single: vi.fn(async () => ({ data: product, error: null })),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: product, error: null }).then(resolve),
    };
    return query;
  });
  mocks.rpc.mockReturnValue({
    select: () => ({ single: async () => ({ data: product, error: null }) }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [product], error: null }).then(resolve),
  });
});

describe.each(['session', 'api_key'])('%s product mutations', (method) => {
  beforeEach(() => {
    mocks.authenticate.mockResolvedValue({ method, admin: { userId: actor }, supabase: { from: mocks.from, rpc: mocks.rpc } });
  });

  it.each(['INSERT', 'UPDATE', 'DELETE'])('uses the authenticated actor and atomic RPC for %s', async (operation) => {
    const request = new NextRequest('http://localhost/api/v1/products', {
      method: operation === 'INSERT' ? 'POST' : operation === 'UPDATE' ? 'PATCH' : 'DELETE',
      ...(operation === 'DELETE' ? {} : { body: JSON.stringify({ name: 'Course', slug: 'course', price: 49, currency: 'USD' }) }),
    });
    const response = operation === 'INSERT' ? await POST(request)
      : operation === 'UPDATE' ? await PATCH(request, context) : await DELETE(request, context);
    expect(response.status).toBe(operation === 'INSERT' ? 201 : operation === 'DELETE' ? 204 : 200);
    expect(mocks.rpc).toHaveBeenCalledWith('mutate_product_with_audit', expect.objectContaining({
      operation_param: operation, actor_id: actor, product_id: operation === 'INSERT' ? null : product.id,
    }));
    for (const result of mocks.from.mock.results) {
      expect(result.value.insert).not.toHaveBeenCalled();
      expect(result.value.update).not.toHaveBeenCalled();
      expect(result.value.delete).not.toHaveBeenCalled();
    }
  });

  it.each(['POST', 'PATCH', 'DELETE'])('returns failure when the %s transaction fails', async (method) => {
    const failure = { data: null, error: { code: 'XX000', message: 'private database detail' } };
    mocks.rpc.mockReturnValue({
      select: () => ({ single: async () => failure }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(failure).then(resolve),
    });
    const request = new NextRequest('http://localhost/api/v1/products', {
      method, ...(method === 'DELETE' ? {} : { body: JSON.stringify({ name: 'Course', slug: 'course', price: 49, currency: 'USD' }) }),
    });
    const response = method === 'POST' ? await POST(request)
      : method === 'PATCH' ? await PATCH(request, context) : await DELETE(request, context);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private database detail');
  });

  it.each([
    ['POST', '23505', 409], ['PATCH', '23505', 409], ['DELETE', '23503', 409],
    ['PATCH', 'P0002', 404], ['DELETE', 'P0002', 404],
  ] as const)('maps %s transaction error %s to %s', async (method, code, status) => {
    const failure = { data: null, error: { code } };
    mocks.rpc.mockReturnValue({
      select: () => ({ single: async () => failure }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(failure).then(resolve),
    });
    const request = new NextRequest('http://localhost/api/v1/products', {
      method, ...(method === 'DELETE' ? {} : { body: JSON.stringify({ name: 'Course', slug: 'course', price: 49, currency: 'USD' }) }),
    });
    const response = method === 'POST' ? await POST(request)
      : method === 'PATCH' ? await PATCH(request, context) : await DELETE(request, context);
    expect(response.status).toBe(status);
  });
});
