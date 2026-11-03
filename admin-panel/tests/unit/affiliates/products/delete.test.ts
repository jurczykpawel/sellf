/** Product archive contract. @see src/app/api/v1/products/[id]/route.ts */
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({ rule: true, commission: false, error: null as { code: string } | null, removed: [] as string[], reads: [] as string[], rpc: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/api', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return { ...original, authenticate: async () => ({ admin: { userId: 'dddddddd-0000-4000-a000-000000000000' }, supabase: { rpc: state.rpc, from: (table: string) => {
    state.reads.push(table);
    const q = { select: () => q, eq: () => q, limit: () => q,
      single: async () => ({ data: { id: 'aaaaaaaa-0000-4000-a000-000000000001', slug: 'fixture' } }),
      maybeSingle: async () => ({ data: (table === 'affiliate_rules' ? state.rule : state.commission) ? { id: 'history' } : null, error: state.error }),
      delete: () => { state.removed.push(table); return q; }, then: (resolve: (value: object) => void) => resolve({ error: null }),
    }; return q;
  } } }) };
});
import { DELETE } from '@/app/api/v1/products/[id]/route';
const request = () => new NextRequest('http://localhost/api/v1/products/aaaaaaaa-0000-4000-a000-000000000001', { method: 'DELETE' });
const params = { params: Promise.resolve({ id: 'aaaaaaaa-0000-4000-a000-000000000001' }) };
beforeEach(() => { state.rule = true; state.commission = false; state.error = null; state.removed = []; state.reads = []; state.rpc.mockReset().mockResolvedValue({ error: null }); });
it('returns an archive action before category cleanup for any rule', async () => {
  const response = await DELETE(request(), params);
  expect(response.status).toBe(409);
  expect(state.rpc).not.toHaveBeenCalled();
  expect(JSON.stringify(await response.json())).toContain('is_active');
  expect(state.removed).toEqual([]);
});
it('keeps relations when rule lookup fails', async () => {
  state.error = { code: 'XX000' };
  expect((await DELETE(request(), params)).status).toBe(500);
  expect(state.rpc).not.toHaveBeenCalled();
  expect(state.removed).toEqual([]);
});
it('retains normal deletion for products without affiliate history', async () => {
  state.rule = false;
  expect((await DELETE(request(), params)).status).toBe(204);
  expect(state.reads).toContain('affiliate_rules');
  expect(state.removed).toEqual([]);
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith('mutate_product_as', { event_actor: { type: 'user', id: 'dddddddd-0000-4000-a000-000000000000' }, operation_param: 'DELETE', product_data: {}, product_id: 'aaaaaaaa-0000-4000-a000-000000000001', actor_id: 'dddddddd-0000-4000-a000-000000000000' });
});

it('returns archive guidance for a primary product whose bump earned commission', async () => {
  state.rule = false; state.commission = true;
  expect((await DELETE(request(), params)).status).toBe(409);
  expect(state.rpc).not.toHaveBeenCalled();
  expect(state.reads).toContain('affiliate_commissions');
  expect(state.removed).toEqual([]);
});
