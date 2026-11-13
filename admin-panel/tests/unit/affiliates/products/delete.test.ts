/** Product delete / archive contract. @see src/app/api/v1/products/[id]/route.ts */
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({ removed: [] as string[], rpc: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/api', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return { ...original, authenticate: async () => ({ admin: { userId: 'dddddddd-0000-4000-a000-000000000000' }, supabase: { rpc: state.rpc, from: (table: string) => {
    const q = { select: () => q, eq: () => q, limit: () => q,
      single: async () => ({ data: { id: 'aaaaaaaa-0000-4000-a000-000000000001', slug: 'fixture' } }),
      delete: () => { state.removed.push(table); return q; },
    }; return q;
  } } }) };
});
import { DELETE } from '@/app/api/v1/products/[id]/route';
const id = 'aaaaaaaa-0000-4000-a000-000000000001';
const request = (query = '') => new NextRequest(`http://localhost/api/v1/products/${id}${query}`, { method: 'DELETE' });
const params = { params: Promise.resolve({ id }) };
const impact = { orders: 2, invoices: 1, licenses: 1, accesses: 2, subscriptions: 0, hasHistory: true };
const rpcArgs = (permanent: boolean) => ({ event_actor: { type: 'user', id: 'dddddddd-0000-4000-a000-000000000000' },
  p_product_id: id, actor_id: 'dddddddd-0000-4000-a000-000000000000', p_permanent: permanent });
beforeEach(() => { state.removed = []; state.rpc.mockReset(); });

it('archives a product with history and reports what was kept', async () => {
  state.rpc.mockResolvedValue({ data: { result: 'archived', impact }, error: null });
  const response = await DELETE(request(), params);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { id, status: 'archived', impact } });
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith('remove_product_as', rpcArgs(false));
  expect(state.removed).toEqual([]);
});

it('deletes a product without history', async () => {
  state.rpc.mockResolvedValue({ data: { result: 'deleted', impact: { ...impact, orders: 0, hasHistory: false } }, error: null });
  expect((await DELETE(request(), params)).status).toBe(204);
});

it('sends permanent=true as an explicit permanent delete', async () => {
  state.rpc.mockResolvedValue({ data: { result: 'deleted', impact }, error: null });
  expect((await DELETE(request('?permanent=true'), params)).status).toBe(204);
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith('remove_product_as', rpcArgs(true));
});

it.each([['55000', 'Archive it first'], ['23503', 'stays in the archive']])('maps %s to a conflict with guidance', async (code, text) => {
  state.rpc.mockResolvedValue({ data: null, error: { code, message: 'private database detail' } });
  const response = await DELETE(request('?permanent=true'), params);
  expect(response.status).toBe(409);
  const body = await response.text();
  expect(body).toContain(text);
  expect(body).not.toContain('private database detail');
});
