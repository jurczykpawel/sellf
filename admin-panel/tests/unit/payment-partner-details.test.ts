import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ allowed: true, rows: [] as unknown[], from: vi.fn(), error: null as unknown }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (fn: (ctx: unknown) => unknown) => m.allowed ? fn({ dataClient: { from: m.from } }) : { success: false, errorCode: 'FORBIDDEN' } }));
import { getPaymentPartnerDetails } from '@/lib/actions/payment-details';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => { m.allowed = true; m.error = null; m.rows = []; m.from.mockReset().mockImplementation(() => ({ select: () => ({ eq: async () => ({ data: m.rows, error: m.error }) }) })); });
it('reads only commissions for the selected payment and hides the section without commissions', async () => {
  expect(await getPaymentPartnerDetails(id)).toEqual({ success: true, data: [] });
  expect(m.from).toHaveBeenCalledWith('affiliate_commissions');
});
it('does not read partner data for a non-admin or invalid payment', async () => {
  m.allowed = false; expect((await getPaymentPartnerDetails(id)).success).toBe(false);
  expect((await getPaymentPartnerDetails('bad')).success).toBe(false); expect(m.from).not.toHaveBeenCalled();
});
it.each([
  [[{ amount_minor: 1000, allocations: [] }], null, false, null, 'held'],
  [[{ amount_minor: 1000, allocations: [] }], '2020-01-01', false, null, 'accrued'],
  [[{ amount_minor: 1000, allocations: [{ released_at: null, payout: { status: 'paid' } }] }], null, false, null, 'paid'],
  [[{ amount_minor: 1000, allocations: [] }, { amount_minor: -1000, allocations: [] }], null, false, null, 'reversed'],
  [[{ amount_minor: 1000, allocations: [] }], '2020-01-01', true, null, 'held'],
  [[{ amount_minor: 1000, allocations: [{ released_at: null, payout: { status: 'reserved' } }] }], '2020-01-01', false, null, 'reserved'],
])('shows the ledger state %s', async (ledger, eligible_at, dispute_seen, dispute_reviewed_at, status) => {
  m.rows = [{ id, currency: 'PLN', accrued_minor: 1000, eligible_at, dispute_seen, dispute_reviewed_at,
    member: { display_name: 'Partner', code: 'PARTNER' }, binding: { coupon: { code: 'SAVE' } },
    rule: { percentage_bps: 1500, fixed_minor: null }, payment: { status: 'completed' }, ledger }];
  const r = await getPaymentPartnerDetails(id);
  expect(r.data?.[0]).toMatchObject({ partner: 'Partner', coupon: 'SAVE', percentage_bps: 1500, accrued_minor: 1000, status });
});
it('returns an error rather than an empty section when reading fails', async () => { m.error = { message: 'db' }; expect((await getPaymentPartnerDetails(id)).success).toBe(false); });
