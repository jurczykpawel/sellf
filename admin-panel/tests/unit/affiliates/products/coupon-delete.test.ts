import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({ bound: true, error: null as { code: string } | null, deleted: false }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), authenticate: async () => ({ supabase: { from: (table: string) => {
  const q = { select: () => q, eq: () => q, limit: () => q,
    single: async () => ({ data: { id: 'coupon' } }),
    maybeSingle: async () => ({ data: table === 'affiliate_coupon_bindings' && state.bound ? { id: 'binding' } : null, error: state.error }),
    delete: () => { state.deleted = true; return q; }, then: (resolve: (value: object) => void) => resolve({ error: null }),
  }; return q;
} } }) }));
import { DELETE } from '@/app/api/v1/coupons/[id]/route';
const request = () => new NextRequest('http://localhost/api/v1/coupons/aaaaaaaa-0000-4000-a000-000000000001', { method: 'DELETE' });
const params = { params: Promise.resolve({ id: 'aaaaaaaa-0000-4000-a000-000000000001' }) };
beforeEach(() => { state.bound = true; state.error = null; state.deleted = false; });
it('gives partner binding guidance before deleting an unused coupon', async () => {
  const response = await DELETE(request(), params);
  expect(response.status).toBe(409); expect(JSON.stringify(await response.json())).toContain('bound to a partner'); expect(state.deleted).toBe(false);
});
it('keeps a coupon when binding lookup fails', async () => { state.error = { code: 'XX000' }; expect((await DELETE(request(), params)).status).toBe(500); expect(state.deleted).toBe(false); });
it('deletes an unbound unused coupon', async () => { state.bound = false; expect((await DELETE(request(), params)).status).toBe(204); expect(state.deleted).toBe(true); });
