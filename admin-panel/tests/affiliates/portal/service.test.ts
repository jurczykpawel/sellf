/** Portal session boundaries. @see src/lib/affiliates/portal/service.ts */
import { beforeEach, expect, it, vi } from 'vitest';
import { readPartnerPortal, readAdminPortal, portalResponse, portalMetadata } from '@/lib/affiliates/portal/service';
const mocks = vi.hoisted(() => ({ user: vi.fn(), guard: vi.fn(), admin: vi.fn(), connection: vi.fn() }));
vi.mock('@/lib/stripe/affiliate-mode', () => ({ getAffiliateLivemode: async () => true }));
vi.mock('next/server', async importOriginal => ({ ...await importOriginal<typeof import('next/server')>(), connection: mocks.connection }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: mocks.guard }));
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: null }, error: null }); });
it('returns unauthorized before opening a data client', async () => {
  expect(await readPartnerPortal({})).toEqual({ success: false, error: 'unauthorized' });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('checks admin session before opening a data client', async () => {
  mocks.guard.mockRejectedValue(new Error('Forbidden'));
  expect(await readAdminPortal('af000000-0000-4000-a000-000000000001', {})).toEqual({ success: false, error: 'forbidden' });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('rejects member selection in own query and oversized pages', async () => {
  for (const query of [{ member_id: 'other' }, { limit: 101 }, { cursor: 'x' }]) expect(await readPartnerPortal(query)).toEqual({ success: false, error: 'invalid_input' });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('provides private HTTP and metadata defaults on failures too', () => {
  const response = portalResponse({ success: false, error: 'unavailable' });
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(portalMetadata.robots).toEqual({ index: false, follow: false });
});
it('pages newest purchases first with stable ties and an own cursor', async () => {
  const { pageCommissions } = await import('../oracles/portal');
  const older = { id: 'ffffffff-0000-4000-a000-000000000001', paid_at: '2026-01-01', currency: 'PLN' };
  const newer = { ...older, id: 'aaaaaaaa-0000-4000-a000-000000000001', paid_at: '2026-02-01' };
  const tie = { ...newer, id: 'bbbbbbbb-0000-4000-a000-000000000001' };
  const facts = [older, newer, tie];
  expect(pageCommissions(facts, { limit: 2 }).map(c => c.id)).toEqual([tie.id, newer.id]);
  expect(pageCommissions(facts, { limit: 2, cursor: newer.id }).map(c => c.id)).toEqual([older.id]);
  expect(pageCommissions(facts, { limit: 2, cursor: 'cccccccc-0000-4000-a000-000000000001' })).toEqual([]);
});
it('requests the next page with one keyset RPC and one summary RPC', async () => {
  const cursor = 'af000000-0000-4000-a000-000000000001';
  const rpc = vi.fn().mockImplementation(async (name: string) => ({ error: null, data: name === 'affiliate_portal_page'
    ? { commissions: [], next_cursor: null }
    : { balances: [], codes: [], rules: [], sync_pending: false, needs_review: false } }));
  const memberQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'member', code: 'own', status: 'approved' }, error: null }) };
  memberQuery.select.mockReturnValue(memberQuery); memberQuery.eq.mockReturnValue(memberQuery);
  const from = vi.fn((table: string) => { if (table !== 'affiliate_memberships') throw new Error('Unexpected history read'); return memberQuery; });
  mocks.admin.mockReturnValue({ rpc, from });
  mocks.user.mockResolvedValue({ data: { user: { id: 'user' } } });
  expect(await readPartnerPortal({ cursor, limit: 25 })).toMatchObject({ success: true, data: { commissions: [] } });
  expect(from).toHaveBeenCalledExactlyOnceWith('affiliate_memberships');
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenCalledWith('affiliate_portal_page', expect.objectContaining({ p_member: 'member', p_cursor: cursor, p_limit: 25 }));
});

it('passes the current payment mode to the summary RPC', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null, data: {} });
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'member', code: 'own', status: 'approved' } }) };
  mocks.admin.mockReturnValue({ rpc, from: () => q });
  mocks.user.mockResolvedValue({ data: { user: { id: 'user' } } });
  await readPartnerPortal();
  expect(rpc).toHaveBeenCalledWith('affiliate_portal_summary', expect.objectContaining({ p_livemode: true }));
});
