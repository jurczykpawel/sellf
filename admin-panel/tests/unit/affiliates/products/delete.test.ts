/** Product archive contract. @see src/app/api/v1/products/[id]/route.ts */
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({ rule: true, error: null as { code: string } | null, removed: [] as string[], reads: [] as string[] }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/api', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return { ...original, authenticate: async () => ({ supabase: { from: (table: string) => {
    state.reads.push(table);
    const q = { select: () => q, eq: () => q, limit: () => q,
      single: async () => ({ data: { id: 'aaaaaaaa-0000-4000-a000-000000000001', slug: 'fixture' } }),
      maybeSingle: async () => ({ data: state.rule ? { id: 'rule' } : null, error: state.error }),
      delete: () => { state.removed.push(table); return q; }, then: (resolve: (value: object) => void) => resolve({ error: null }),
    }; return q;
  } } }) };
});
import { DELETE } from '@/app/api/v1/products/[id]/route';
const request = () => new NextRequest('http://localhost/api/v1/products/aaaaaaaa-0000-4000-a000-000000000001', { method: 'DELETE' });
const params = { params: Promise.resolve({ id: 'aaaaaaaa-0000-4000-a000-000000000001' }) };
beforeEach(() => { state.rule = true; state.error = null; state.removed = []; state.reads = []; });
it('returns an archive action before category cleanup for any rule', async () => {
  const response = await DELETE(request(), params);
  expect(response.status).toBe(409);
  expect(JSON.stringify(await response.json())).toContain('is_active');
  expect(state.removed).toEqual([]);
});
it('keeps relations when rule lookup fails', async () => {
  state.error = { code: 'XX000' };
  expect((await DELETE(request(), params)).status).toBe(500);
  expect(state.removed).toEqual([]);
});
it('retains normal deletion for products without affiliate history', async () => {
  state.rule = false;
  expect((await DELETE(request(), params)).status).toBe(204);
  expect(state.reads).toContain('affiliate_rules');
  expect(state.removed).toEqual(['product_categories', 'products']);
});
