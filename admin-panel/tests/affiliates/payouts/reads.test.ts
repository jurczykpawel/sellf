/** First-run payout reads. @see src/lib/affiliates/payouts/reads.ts */
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), program: null as null | { thresholds: Record<string, string> }, error: null as null | { code: string } }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (fn: (ctx: unknown) => unknown) => fn({ dataClient: { from: mocks.from } }) }));
import { getPayoutChoices } from '@/lib/affiliates/payouts/reads';
beforeEach(() => {
  mocks.program = null; mocks.error = null;
  mocks.from.mockImplementation((table: string) => {
    const result = () => ({ data: table === 'affiliate_programs' ? mocks.program : [], error: table === 'affiliate_programs' ? mocks.error : null });
    const query = { select: () => query, ilike: () => query, order: () => query, limit: async () => result(),
      single: async () => mocks.program ? result() : { data: null, error: { code: 'PGRST116' } }, maybeSingle: async () => result() };
    return query;
  });
});
it('returns settings currencies and an unconfigured state when no program exists', async () => {
  expect(await getPayoutChoices({})).toEqual({ success: true, data: { programConfigured: false, members: [], currencies: ['PLN'], payouts: [], commissions: [] } });
});
it('retains configured currencies', async () => {
  mocks.program = { thresholds: { EUR: '5000', CHF: '10000' } };
  expect((await getPayoutChoices({})).data).toMatchObject({ programConfigured: true, currencies: ['EUR', 'CHF'] });
});
it('keeps database failures distinct from an unconfigured program', async () => {
  mocks.error = { code: '42501' };
  expect(await getPayoutChoices({})).toEqual({ success: false, error: 'unavailable', errorCode: '422' });
});
