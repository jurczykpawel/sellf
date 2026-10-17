/** Product affiliate actions. @see src/lib/affiliates/products/actions.ts */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: true, admin: true, rpc: vi.fn(), from: vi.fn(), privileged: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.session ? { id: 'session-admin' } : null } }) },
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: mocks.admin ? { user_id: 'session-admin' } : null }) }) }) }),
}) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { mocks.privileged(); return { rpc: mocks.rpc, from: mocks.from }; } }));
vi.mock('@/lib/demo-guard', () => ({ isDemoMode: () => false }));
import { bindAffiliateCoupon, createAffiliateRule, getAffiliateProduct, getAffiliateCoupon } from '@/lib/affiliates/products/actions';
const id = 'aaaaaaaa-0000-4000-a000-000000000001';
const rule = { product_id: id, expected_revision: 0, enabled: true, rule: { percentage_bps: 2000 } };
beforeEach(() => { vi.clearAllMocks(); mocks.session = true; mocks.admin = true; mocks.rpc.mockReturnValue({ select: () => ({ single: () => Promise.resolve({ data: { id }, error: null }) }) }); });
describe('product affiliates actions', () => {
  it.each([[false, true, 'UNAUTHORIZED'], [true, false, 'FORBIDDEN']])('requires a session admin (%s/%s)', async (session, admin, errorCode) => {
    mocks.session = session; mocks.admin = admin;
    expect(await createAffiliateRule(rule)).toMatchObject({ success: false, errorCode });
    expect(mocks.privileged).not.toHaveBeenCalled();
  });
  it('uses the session actor and creates a new revision', async () => {
    expect(await createAffiliateRule(rule)).toEqual({ success: true, data: { id } });
    expect(mocks.rpc).toHaveBeenCalledWith('affiliate_rule_create', expect.objectContaining({ p_actor: 'session-admin', p_expected_revision: 0, p_percentage_bps: 2000 }));
  });
  it('preserves fixed minor units and binding versions as strings', async () => {
    await createAffiliateRule({ ...rule, rule: { fixed_minor: '9007199254740993', currency: 'PLN' } });
    expect(mocks.rpc.mock.calls[0][1].p_fixed_minor).toBe('9007199254740993');
    await bindAffiliateCoupon({ coupon_id: id, member_id: id, expected_version: '9007199254740993' });
    expect(mocks.rpc.mock.calls[1][1]).toEqual({ p_actor: 'session-admin', p_coupon: id, p_member: id, p_expected_version: '9007199254740993' });
  });
  it.each([{ ...rule, actor: id }, { ...rule, hold_days: 3 }, { ...rule, rule: { percentage_bps: 50, fixed_minor: '1', currency: 'PLN' } }, { ...rule, expected_revision: -1 }])('rejects unsupported input', async input => {
    expect(await createAffiliateRule(input)).toMatchObject({ success: false, errorCode: 'INVALID_INPUT' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects unsupported coupon input', async () => {
    expect(await bindAffiliateCoupon({ coupon_id: id, member_id: id, expected_version: '0', actor: id })).toMatchObject({ success: false, errorCode: 'INVALID_INPUT' });
  });
  it.each([['PT409', 'CONFLICT'], ['22023', 'INVALID_INPUT'], ['23503', 'INVALID_INPUT'], ['42501', 'FORBIDDEN'], ['XX000', 'INTERNAL_ERROR']])('maps %s without database details', async (code, errorCode) => {
    mocks.rpc.mockReturnValue({ select: () => ({ single: () => Promise.resolve({ error: { code, message: 'private database details' } }) }) });
    expect(await createAffiliateRule(rule)).toEqual({ success: false, error: errorCode, errorCode });
  });
  it('projects product policy and exact rule amounts', async () => {
    const single = vi.fn().mockResolvedValueOnce({ data: { id, product_type: 'one_time', is_refundable: true, refund_period_days: null }, error: null })
      .mockResolvedValueOnce({ data: { id, revision: 1, enabled: true, percentage_bps: null, fixed_minor: '9007199254740993', currency: 'PLN' }, error: null });
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: single };
    mocks.from.mockReturnValue(query);
    expect(await getAffiliateProduct(id)).toMatchObject({ success: true, data: { rule: { fixed_minor: '9007199254740993' } } });
    expect(query.select).toHaveBeenCalledWith('id,revision,enabled,percentage_bps,fixed_minor::text,currency');
  });
});

it('projects owner names and bounds a literal name search', async () => {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(), ilike: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValueOnce({ data: { member_id: id, version: '9007199254740993' } }).mockResolvedValueOnce({ data: { display_name: 'Maria', code: 'maria' } }),
    then: (resolve: (result: object) => void) => resolve({ data: [{ id, display_name: 'Maria', code: 'maria' }] }),
  };
  mocks.from.mockReturnValue(query);
  expect(await getAffiliateCoupon({ coupon_id: id, cursor: id, search: 'Maria_%' })).toMatchObject({ success: true, data: { binding: { display_name: 'Maria', version: '9007199254740993' } } });
  expect(query.limit).toHaveBeenCalledWith(25);
  expect(query.gt).toHaveBeenCalledWith('id', id);
  expect(query.ilike).toHaveBeenCalledWith('display_name', '%Maria\\_\\%%');
  expect(await getAffiliateCoupon({ coupon_id: id, search: 'x'.repeat(121) })).toMatchObject({ success: false, errorCode: 'INVALID_INPUT' });
});
