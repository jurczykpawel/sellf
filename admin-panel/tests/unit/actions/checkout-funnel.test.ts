import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), adminCheck: vi.fn(), createAdmin: vi.fn(), rpc: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: mocks.getUser },
  from: () => ({ select: () => ({ eq: () => ({ single: mocks.adminCheck }) }) }),
}) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdmin }));
vi.mock('@/lib/demo-guard', () => ({ isDemoMode: () => false }));

import { getCheckoutFunnel } from '@/lib/actions/checkout-funnel';

const productId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin' } } });
  mocks.adminCheck.mockResolvedValue({ data: { user_id: 'admin' } });
  mocks.createAdmin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: { totals: { started: 0, paid: 0, pending: 0, abandoned: 0 }, products: [] }, error: null });
});

describe('checkout funnel', () => {
  it('requires an admin before creating the data client', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await getCheckoutFunnel()).success).toBe(false);
    mocks.adminCheck.mockResolvedValueOnce({ data: null });
    expect((await getCheckoutFunnel()).success).toBe(false);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it('uses one aggregate RPC for the selected period and product', async () => {
    const data = { totals: { started: 100000, paid: 60000, pending: 20000, abandoned: 20000 }, products: [{ productId, name: 'Course', started: 100000, paid: 60000, pending: 20000, abandoned: 20000 }] };
    mocks.rpc.mockResolvedValueOnce({ data, error: null });
    expect((await getCheckoutFunnel(90, productId)).data).toEqual(data);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_checkout_funnel', { p_days: 90, p_product_id: productId });
  });

  it('uses the default period and all products', async () => {
    await getCheckoutFunnel();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_checkout_funnel', { p_days: 30, p_product_id: null });
  });

  it('returns an empty funnel for no records', async () => {
    expect((await getCheckoutFunnel()).data).toMatchObject({ totals: { started: 0, paid: 0, pending: 0, abandoned: 0 }, products: [] });
  });

  it('returns an error instead of zeros when the aggregate read fails', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
    expect(await getCheckoutFunnel()).toMatchObject({ success: false });
  });

  it.each([0, -1, 1.5, 366, NaN])('rejects invalid period %s', async days => {
    expect((await getCheckoutFunnel(days)).success).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid product filters', async () => {
    expect((await getCheckoutFunnel(30, 'invalid')).success).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
