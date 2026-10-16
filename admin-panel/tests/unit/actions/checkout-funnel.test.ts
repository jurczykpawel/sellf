import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), adminCheck: vi.fn(), createAdmin: vi.fn(), range: vi.fn(),
  select: vi.fn(), gte: vi.fn(), lte: vi.fn(), eq: vi.fn(), order: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: mocks.getUser },
  from: () => ({ select: () => ({ eq: () => ({ single: mocks.adminCheck }) }) }),
}) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdmin }));
vi.mock('@/lib/demo-guard', () => ({ isDemoMode: () => false }));

import { getCheckoutFunnel } from '@/lib/actions/checkout-funnel';

const productId = '11111111-1111-4111-8111-111111111111';
const row = (status: string, id: string | null = productId) => ({
  status, product_id: id, products: id ? { name: 'Course' } : null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin' } } });
  mocks.adminCheck.mockResolvedValue({ data: { user_id: 'admin' } });
  const query = { select: mocks.select, gte: mocks.gte, lte: mocks.lte, eq: mocks.eq, order: mocks.order, range: mocks.range };
  for (const fn of [mocks.select, mocks.gte, mocks.lte, mocks.eq, mocks.order]) fn.mockReturnValue(query);
  mocks.createAdmin.mockReturnValue({ from: () => query });
  mocks.range.mockResolvedValue({ data: [], error: null });
});

describe('checkout funnel', () => {
  it('requires an admin before creating the data client', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await getCheckoutFunnel()).success).toBe(false);
    mocks.adminCheck.mockResolvedValueOnce({ data: null });
    expect((await getCheckoutFunnel()).success).toBe(false);
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it('keeps pending separate and counts paid outcomes including refunds and disputes', async () => {
    mocks.range.mockResolvedValueOnce({ data: ['completed', 'refunded', 'partially_refunded', 'disputed', 'pending', 'abandoned'].map(s => row(s)), error: null });
    const result = await getCheckoutFunnel(7, productId);
    expect(result.data?.totals).toEqual({ started: 6, paid: 4, pending: 1, abandoned: 1 });
    expect(result.data?.products).toEqual([{ productId, name: 'Course', started: 6, paid: 4, pending: 1, abandoned: 1 }]);
    expect(mocks.eq).toHaveBeenCalledWith('product_id', productId);
    const end = new Date(mocks.lte.mock.calls[0][1]);
    const start = new Date(mocks.gte.mock.calls[0][1]);
    expect(end.getTime() - start.getTime()).toBe(7 * 86400000);
  });

  it('reads beyond the first page and keeps products without a live product name', async () => {
    mocks.range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => row('abandoned')), error: null })
      .mockResolvedValueOnce({ data: [row('pending', null)], error: null });
    const result = await getCheckoutFunnel(30);
    expect(result.data?.totals).toEqual({ started: 1001, paid: 0, pending: 1, abandoned: 1000 });
    expect(result.data?.products).toHaveLength(2);
    expect(result.data?.products[1]).toMatchObject({ productId: null, name: null, pending: 1 });
    expect(mocks.range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it('returns an empty funnel for no records', async () => {
    expect((await getCheckoutFunnel()).data).toMatchObject({ totals: { started: 0, paid: 0, pending: 0, abandoned: 0 }, products: [] });
  });

  it('does not present partial data as a successful funnel', async () => {
    mocks.range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => row('pending')), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
    expect(await getCheckoutFunnel()).toMatchObject({ success: false });
  });

  it.each([0, -1, 1.5, 366, NaN])('rejects invalid period %s', async days => {
    expect((await getCheckoutFunnel(days)).success).toBe(false);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it('rejects invalid product filters', async () => {
    expect((await getCheckoutFunnel(30, 'invalid')).success).toBe(false);
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
