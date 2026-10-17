/** CSV availability without program configuration. @see src/lib/affiliates/payouts/download.ts */
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ programRead: vi.fn() }));
vi.mock('@/lib/stripe/affiliate-mode', () => ({ getAffiliateLivemode: async () => true }));
vi.mock('@/lib/affiliates/payouts/query', () => ({ readPreview: async () => ({ sync_required: false }) }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (fn: (ctx: unknown) => unknown) => fn({ user: { id: 'admin' }, dataClient: { from: (table: string) => {
  if (table === 'affiliate_programs') return { select: () => ({ maybeSingle: mocks.programRead }) };
  const query = { select: () => query, eq: () => query, single: async () => ({ error: null, data: table === 'affiliate_payouts' ? { id: 'af000000-0000-4000-a000-000000000001', version: '1', livemode: true, status: 'reserved', needs_review: false } : { status: 'approved', user_id: 'member' } }) };
  return query;
} } }) }));
import { downloadPayoutCsv } from '@/lib/affiliates/payouts/download';
it('declines export when the program has not been configured', async () => {
  mocks.programRead.mockResolvedValue({ data: null, error: null });
  expect((await downloadPayoutCsv({ payout_id: 'af000000-0000-4000-a000-000000000001', version: '1' })).status).toBe(409);
  expect(mocks.programRead).toHaveBeenCalledOnce();
});
