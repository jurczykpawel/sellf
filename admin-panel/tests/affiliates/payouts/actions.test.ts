import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), mode: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: mocks.auth }));
vi.mock('@/lib/stripe/affiliate-mode', () => ({ getAffiliateLivemode: mocks.mode }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { reservePayout, markPayoutPaid, cancelPayout, adjustCommission } from '@/lib/affiliates/payouts/actions';
const id = 'af000000-0000-4000-a000-000000000001';
const reserve = { member_id: id, currency: 'PLN', cutoff: '2026-01-01T00:00:00Z', member_version: '9007199254740993', program_version: '1', payee_reference: 'partner' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockImplementation(async fn => fn({ user: { id }, dataClient: { rpc: mocks.rpc } }));
  mocks.rpc.mockReturnValue({ select: () => ({ single: async () => ({ data: { id }, error: null }) }) });
});
it('uses the session actor and exact versions', async () => {
  expect((await reservePayout(reserve)).success).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith('affiliate_reserve', expect.objectContaining({ p_actor: id, p_member_version: '9007199254740993' }));
  expect(mocks.auth.mock.calls[0][1]).toEqual({ mutating: true });
});
it('rejects additional actor fields and invalid references', async () => {
  for (const input of [{ ...reserve, actor: id }, { ...reserve, payee_reference: '\r\nx' }]) expect((await reservePayout(input)).success).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('requires complete payment evidence and confirmation', async () => {
  for (const input of [{}, { payout_id: id, version: '1', bank_reference: 'bank' }]) expect((await markPayoutPaid(input)).success).toBe(false);
  expect((await cancelPayout({ payout_id: id, version: '1', no_transfer: false, reason: 'checked' })).success).toBe(false);
  expect((await adjustCommission({ commission_id: id, version: '1', amount_minor: '0', reason: 'review', evidence_reference: 'case', review_dispute: true })).success).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['23505'])('maps %s to a conflict without database detail', async code => {
  mocks.rpc.mockReturnValue({ select: () => ({ single: async () => ({ error: { code, message: 'private detail' } }) }) });
  expect(await reservePayout(reserve)).toEqual({ success: false, error: 'conflict', errorCode: '409' });
});
it('does not execute without an admin session', async () => {
  mocks.auth.mockResolvedValue({ success: false, errorCode: 'FORBIDDEN' });
  expect((await reservePayout(reserve)).success).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('maps the non-retrying database conflict code', async () => {
  mocks.rpc.mockReturnValue({ select: () => ({ single: async () => ({ error: { code: 'PT409' } }) }) });
  expect((await reservePayout(reserve)).errorCode).toBe('409');
});

it.each([true, false])('reserves using the current instance mode %s', async livemode => {
  mocks.mode.mockResolvedValue(livemode);
  await reservePayout(reserve);
  expect(mocks.rpc).toHaveBeenCalledWith('affiliate_reserve', expect.objectContaining({ p_livemode: livemode }));
});
