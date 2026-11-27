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
      select: vi.fn(() => query), eq: vi.fn(() => query), neq: vi.fn(() => query), limit: vi.fn(() => query),
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

const apiKeyId = 'a1340000-0000-4000-a000-0000000000aa';
describe.each(['session', 'api_key'])('%s product mutations', (method) => {
  beforeEach(() => {
    mocks.authenticate.mockResolvedValue({ method, apiKey: { id: apiKeyId }, admin: { userId: actor }, supabase: { from: mocks.from, rpc: mocks.rpc } });
  });

  it.each(['INSERT', 'UPDATE', 'DELETE'])('uses the authenticated actor and atomic RPC for %s', async (operation) => {
    const request = new NextRequest('http://localhost/api/v1/products', {
      method: operation === 'INSERT' ? 'POST' : operation === 'UPDATE' ? 'PATCH' : 'DELETE',
      ...(operation === 'DELETE' ? {} : { body: JSON.stringify({ name: 'Course', slug: 'course', price: 49, currency: 'USD' }) }),
    });
    const response = operation === 'INSERT' ? await POST(request)
      : operation === 'UPDATE' ? await PATCH(request, context) : await DELETE(request, context);
    expect(response.status).toBe(operation === 'INSERT' ? 201 : operation === 'DELETE' ? 204 : 200);
    const eventActor = method === 'api_key' ? { type: 'api_key', id: apiKeyId } : { type: 'user', id: actor };
    expect(mocks.rpc).toHaveBeenCalledWith(...(operation === 'DELETE'
      ? ['remove_product_as', { event_actor: eventActor, actor_id: actor, p_product_id: product.id, p_permanent: false }]
      : ['mutate_product_as', expect.objectContaining({
        operation_param: operation, actor_id: actor, product_id: operation === 'INSERT' ? null : product.id, event_actor: eventActor,
      })]));
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
    expect(mocks.rpc).toHaveBeenCalledWith(method === 'DELETE' ? 'remove_product_as' : 'mutate_product_as', expect.objectContaining({ actor_id: actor }));
    expect(await response.text()).not.toContain('private database detail');
  });

  it.each([
    ['DELETE', '2BP01', 409], ['POST', '23505', 409], ['PATCH', '23505', 409], ['DELETE', '23503', 409],
    ['PATCH', '23503', 409], ['PATCH', 'P0002', 404], ['DELETE', 'P0002', 404],
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

it('replaces nested event sessions in the same audited product transaction', async () => {
  mocks.authenticate.mockResolvedValue({ admin: { userId: actor }, supabase: { from: mocks.from, rpc: mocks.rpc } });
  const sessions = [{ starts_at: '2099-01-01T00:00:00Z', tiers: [{ price: 47, seats: 30, sort: 0 }] }];
  const response = await PATCH(new NextRequest('http://localhost/api/v1/products/'+product.id, { method: 'PATCH', body: JSON.stringify({ sessions }) }), context);
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith('mutate_product_as', expect.objectContaining({ product_data: { sessions: [expect.objectContaining({ tiers: sessions[0].tiers })] } }));
});

it.each([
  [{ custom_price_min: 100 }, { currency: 'JPY', custom_price_min: 0, custom_price_presets: [5, 10, 25] }],
  [{ currency: 'JPY' }, { currency: 'USD', custom_price_min: 0, custom_price_presets: [5, 10, 25] }],
  [{ custom_price_presets: [10, 20, 30] }, { currency: 'JPY', custom_price_min: 100, custom_price_presets: [100, 200, 300] }],
])('rejects a partial preset policy change using saved values (%j)', async (patch, stored) => {
  mocks.authenticate.mockResolvedValue({ admin: { userId: actor }, supabase: { from: mocks.from, rpc: mocks.rpc } });
  const implementation = mocks.from.getMockImplementation()!;
  mocks.from.mockImplementation((...args) => {
    const query = implementation(...args);
    const row = { ...product, allow_custom_price: true, show_price_presets: true, ...stored };
    query.maybeSingle.mockResolvedValue({ data: row, error: null });
    query.single.mockResolvedValue({ data: row, error: null });
    return query;
  });
  const response = await PATCH(new NextRequest('http://localhost/api/v1/products/'+product.id, { method: 'PATCH', body: JSON.stringify(patch) }), context);
  expect(response.status).toBe(400);
  expect(await response.text()).toContain('custom_price_presets');
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('accepts partial presets in the saved currency when they meet its minimum', async () => {
  mocks.authenticate.mockResolvedValue({ admin: { userId: actor }, supabase: { from: mocks.from, rpc: mocks.rpc } });
  const implementation = mocks.from.getMockImplementation()!;
  mocks.from.mockImplementation((...args) => {
    const query = implementation(...args);
    query.single.mockResolvedValue({ data: { ...product, currency: 'GBP', allow_custom_price: false, show_price_presets: true, custom_price_min: 0, custom_price_presets: [1] }, error: null });
    return query;
  });
  const response = await PATCH(new NextRequest('http://localhost/api/v1/products/'+product.id, { method: 'PATCH', body: JSON.stringify({ allow_custom_price: true, custom_price_presets: [0, 0.3, 0.4] }) }), context);
  expect(response.status).toBe(200);
});

const savedComponent = 'aaaaaaaa-0000-4000-a000-000000000009';
function archivedBundle() {
  mocks.authenticate.mockResolvedValue({ admin: { userId: actor }, supabase: { from: mocks.from, rpc: mocks.rpc } });
  const implementation = mocks.from.getMockImplementation()!;
  mocks.from.mockImplementation((table: string) => {
    const query = implementation(table);
    query.single.mockResolvedValue({ data: { ...product, is_bundle: true, is_active: false, archived_at: '2026-11-01T00:00:00Z' }, error: null });
    if (table === 'bundle_items') {
      query.order = vi.fn(() => query);
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ component_product_id: savedComponent }], error: null }).then(resolve);
    }
    return query;
  });
}

it.each([
  [{ bundleItemIds: [] }],
  [{ name: 'Renamed', bundleItemIds: ['aaaaaaaa-0000-4000-a000-000000000002'] }],
])('refuses to change the composition of an archived bundle before writing anything (%j)', async (patch) => {
  archivedBundle();
  const response = await PATCH(new NextRequest('http://localhost/api/v1/products/'+product.id, { method: 'PATCH', body: JSON.stringify(patch) }), context);
  expect(response.status).toBe(409);
  const { error } = await response.json();
  expect(error.message).toMatch(/restore the bundle/i);
  // The panel words the refusal in its own language from this code, not from the English message.
  expect(error.details).toEqual({ code: ['bundle_archived'] });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('lets the panel save other fields of an archived bundle when the composition is unchanged', async () => {
  archivedBundle();
  const response = await PATCH(new NextRequest('http://localhost/api/v1/products/'+product.id, { method: 'PATCH', body: JSON.stringify({ name: 'Renamed', bundleItemIds: [savedComponent] }) }), context);
  expect(response.status).toBe(200);
  expect(mocks.rpc).not.toHaveBeenCalledWith('replace_bundle_items', expect.anything());
});

it('a bundle archived after the pre-check leaves no field, relation or composition written (W343r P2)', async () => {
  mocks.authenticate.mockResolvedValue({ admin: { userId: actor }, supabase: { from: mocks.from, rpc: mocks.rpc } });
  const implementation = mocks.from.getMockImplementation()!;
  mocks.from.mockImplementation((...args) => {
    const query = implementation(...args);
    query.single.mockResolvedValue({ data: { ...product, is_bundle: true, is_active: false, archived_at: null }, error: null });
    return query;
  });
  const refusal = { data: null, error: { code: '55000', message: 'Restore the bundle from the archive before editing its contents', details: 'bundle_archived' } };
  mocks.rpc.mockReturnValue({ select: () => ({ single: async () => refusal }), then: (resolve: (value: unknown) => unknown) => Promise.resolve(refusal).then(resolve) });
  const response = await PATCH(new NextRequest('http://localhost/api/v1/products/'+product.id, { method: 'PATCH', body: JSON.stringify({ name: 'Renamed', categories: [], bundleItemIds: [] }) }), context);
  expect(response.status).toBe(409);
  expect((await response.json()).error.details).toEqual({ code: ['bundle_archived'] });
  // Fields and composition go through one transaction; nothing else was attempted.
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith('mutate_bundle_product_as', expect.objectContaining({ p_product_id: product.id, p_component_ids: [] }));
  expect(mocks.from).not.toHaveBeenCalledWith('product_categories');
});

it('a composition-only PATCH refused for an archived bundle writes no categories or tags (W343r2 P4)', async () => {
  mocks.authenticate.mockResolvedValue({ admin: { userId: actor }, supabase: { from: mocks.from, rpc: mocks.rpc } });
  const implementation = mocks.from.getMockImplementation()!;
  mocks.from.mockImplementation((...args) => {
    const query = implementation(...args);
    query.single.mockResolvedValue({ data: { ...product, is_bundle: true, is_active: false, archived_at: null }, error: null });
    return query;
  });
  mocks.rpc.mockImplementation((name: string) => name === 'replace_bundle_items'
    ? Promise.resolve({ data: null, error: { code: '55000', message: 'Archived', details: 'bundle_archived' } })
    : { select: () => ({ single: async () => ({ data: product, error: null }) }) });
  const response = await PATCH(new NextRequest('http://localhost/api/v1/products/'+product.id, { method: 'PATCH', body: JSON.stringify({ categories: [], tags: [], bundleItemIds: [] }) }), context);
  expect(response.status).toBe(409);
  expect((await response.json()).error.details).toEqual({ code: ['bundle_archived'] });
  expect(mocks.from).not.toHaveBeenCalledWith('product_categories');
  expect(mocks.from).not.toHaveBeenCalledWith('product_tags');
});

it('activating an archived product answers 409 with a code the panel can word', async () => {
  mocks.authenticate.mockResolvedValue({ admin: { userId: actor }, supabase: { from: mocks.from, rpc: mocks.rpc } });
  const failure = { data: null, error: { code: '23514', message: 'new row violates check constraint "products_archived_not_active"' } };
  mocks.rpc.mockReturnValue({ select: () => ({ single: async () => failure }), then: (resolve: (value: unknown) => unknown) => Promise.resolve(failure).then(resolve) });
  const response = await PATCH(new NextRequest('http://localhost/api/v1/products/'+product.id, { method: 'PATCH', body: JSON.stringify({ is_active: true }) }), context);
  expect(response.status).toBe(409);
  expect((await response.json()).error.details).toEqual({ code: ['product_archived'] });
});
