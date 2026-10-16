/** Affiliate queue drain behavior. @see src/lib/affiliates/sync/worker.ts */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drainAffiliateWork } from '@/lib/affiliates/sync/worker';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), retrieve: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks }));
vi.mock('@/lib/stripe/server', () => ({ getStripeServer: async () => ({ checkout: { sessions: mocks } }) }));
const work = { payment_id: 'payment', lease_token: 'token', requested_generation: '9007199254740993' };
const session = { id: 'cs_test_order', created: 1767312000, livemode: false, payment_intent: 'pi_order' };
let snapshot: unknown;
let sessionId: string;
beforeEach(() => {
  vi.resetAllMocks(); snapshot = null; sessionId = session.id;
  mocks.rpc.mockImplementation((name: string) => name === 'affiliate_claim_work'
    ? { select: vi.fn().mockResolvedValue({ data: [work], error: null }) }
    : Promise.resolve({ data: true, error: null }));
  mocks.from.mockImplementation((table: string) => {
    const query = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.limit.mockReturnValue(query);
    query.maybeSingle.mockImplementation(async () => ({ data: table === 'affiliate_commissions' ? snapshot : { session_id: sessionId }, error: null }));
    return query;
  });
  mocks.retrieve.mockResolvedValue(session);
  mocks.list.mockResolvedValue({ data: [session], has_more: false });
});

describe('drainAffiliateWork', () => {
  it('uses the server timestamp and exact claimed generation', async () => {
    expect(await drainAffiliateWork()).toMatchObject({ success: true, data: { claimed: 1, applied: 1, deferred: 0, failed: 0 } });
    expect(mocks.retrieve).toHaveBeenCalledWith(session.id);
    expect(mocks.rpc).toHaveBeenCalledWith('affiliate_apply_sync', {
      p_payment: 'payment', p_token: 'token', p_generation: work.requested_generation,
      p_session_created_at: '2026-01-02T00:00:00.000Z', p_livemode: false,
    });
  });
  it('resolves a PI to exactly one owning Checkout Session', async () => {
    sessionId = 'pi_order'; await drainAffiliateWork();
    expect(mocks.list).toHaveBeenCalledWith({ payment_intent: sessionId, limit: 2 });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });
  it.each([
    { data: [], has_more: false }, { data: [session, session], has_more: false },
    { data: [session], has_more: true }, { data: [{ ...session, payment_intent: 'pi_other' }], has_more: false },
  ])('defers an unresolved PI without applying attribution', async result => {
    sessionId = 'pi_order'; mocks.list.mockResolvedValue(result);
    expect(await drainAffiliateWork()).toMatchObject({ data: { failed: 1 } });
    expect(mocks.rpc).toHaveBeenCalledWith('affiliate_retry_work', expect.objectContaining({ p_error: 'session_unresolved' }));
    expect(mocks.rpc).not.toHaveBeenCalledWith('affiliate_apply_sync', expect.anything());
  });
  it('reuses frozen session facts for corrections without Stripe', async () => {
    snapshot = { session_created_at: '2026-01-02T00:00:00+00:00', livemode: true };
    await drainAffiliateWork(); expect(mocks.retrieve).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('affiliate_apply_sync', expect.objectContaining({ p_livemode: true }));
  });
  it('leaves readiness and stale lease outcomes with the atomic RPC', async () => {
    mocks.rpc.mockImplementation((name: string) => name === 'affiliate_claim_work'
      ? { select: vi.fn().mockResolvedValue({ data: [work], error: null }) } : Promise.resolve({ data: false, error: null }));
    expect(await drainAffiliateWork()).toMatchObject({ data: { deferred: 1, failed: 0 } });
    expect(mocks.rpc).not.toHaveBeenCalledWith('affiliate_retry_work', expect.anything());
  });
  it('stores only a fixed code on provider failure', async () => {
    mocks.retrieve.mockRejectedValue(new Error('buyer@example.test secret'));
    expect(await drainAffiliateWork()).toMatchObject({ data: { failed: 1 } });
    expect(mocks.rpc).toHaveBeenCalledWith('affiliate_retry_work', expect.objectContaining({ p_error: 'sync_failed' }));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain('buyer@');
  });
  it('returns a bounded queue failure without a provider lookup', async () => {
    mocks.rpc.mockImplementation(() => ({ select: vi.fn().mockResolvedValue({ data: null, error: { message: 'unavailable' } }) }));
    expect(await drainAffiliateWork()).toEqual({ success: false, error: 'queue_unavailable' });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });
  it('requires text generations from the claim projection', async () => {
    mocks.rpc.mockImplementation(() => ({ select: vi.fn().mockResolvedValue({ data: [{ ...work, requested_generation: 1 }], error: null }) }));
    expect(await drainAffiliateWork()).toEqual({ success: false, error: 'queue_unavailable' });
  });
  it.each([0, 101, 1.5, NaN])('rejects invalid batch bound %s before creating work', async limit => {
    expect(await drainAffiliateWork(limit)).toEqual({ success: false, error: 'invalid_limit' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
