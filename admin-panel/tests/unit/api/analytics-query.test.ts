import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), groups: vi.fn() }));
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), authenticate: mocks.authenticate }));
vi.mock('@/lib/payments/statistics', () => ({ getRevenueGroups: mocks.groups, countRevenueOrders: () => 0 }));
import { GET as dashboard } from '@/app/api/v1/analytics/dashboard/route';
import { GET as revenue } from '@/app/api/v1/analytics/revenue/route';
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: () => query, eq: () => query, gt: () => query, then: (resolve: (v: unknown) => void) => resolve({ count: 0 }) };
  mocks.authenticate.mockResolvedValue({ supabase: { from: () => query } });
  mocks.groups.mockResolvedValue([]);
});
for (const [name, get] of Object.entries({ dashboard, revenue })) {
  it.each(['not-a-uuid', '123', 'null'])(`${name} rejects invalid product_id %s before loading data`, async id => {
    const response = await get(new NextRequest(`http://localhost/api/v1/analytics/${name}?product_id=${id}`));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_INPUT');
    expect(mocks.groups).not.toHaveBeenCalled();
  });
  it.each(['', '?product_id=', '?product_id=90000000-0000-4000-a000-000000000001'])(`${name} accepts absent, empty and valid filters: %s`, async query => {
    const response = await get(new NextRequest(`http://localhost/api/v1/analytics/${name}${query}`));
    expect(response.status).toBe(200);
    expect(mocks.groups).toHaveBeenCalled();
  });
}
it.each(['period=invalid', 'group_by=invalid', 'start_date=wrong', 'end_date=wrong', 'start_date=2026-11-23&end_date=2026-11-20'])('revenue rejects invalid query %s before loading data', async query => {
  const response = await revenue(new NextRequest(`http://localhost/api/v1/analytics/revenue?${query}`));
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe('INVALID_INPUT');
  expect(mocks.groups).not.toHaveBeenCalled();
});
