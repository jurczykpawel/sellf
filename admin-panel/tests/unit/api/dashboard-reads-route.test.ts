/** Dashboard reads route: auth mapping, parameter validation and dispatch to the wrapped actions. */
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/dashboard/route';

const m = vi.hoisted(() => ({
  admin: vi.fn(), chart: vi.fn(), goal: vi.fn(), stats: vi.fn(), hourly: vi.fn(), rates: vi.fn(),
  currency: vi.fn(), used: vi.fn(), products: vi.fn(), overview: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth-server', () => ({ requireAdminApi: m.admin }));
vi.mock('@/lib/actions/analytics', () => ({ getSalesChartData: m.chart, getRevenueGoal: m.goal, getRevenueStats: m.stats, getHourlyRevenueStats: m.hourly }));
vi.mock('@/lib/actions/currency', () => ({ getExchangeRates: m.rates, getUsedCurrencies: m.used }));
vi.mock('@/lib/actions/shop-config', () => ({ getMyDefaultCurrency: m.currency }));
vi.mock('@/lib/actions/products', () => ({ getProductsList: m.products }));
vi.mock('@/lib/actions/dashboard', () => ({ getDashboardStats: m.overview }));

const PRODUCT = 'aaaaaaaa-1111-4111-a111-111111111111';
const call = (query: string) => GET(new NextRequest(`http://localhost/api/admin/dashboard?${query}`));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

it.each([['Unauthorized', 401], ['Forbidden', 403]] as const)('maps %s before reading anything', async (message, status) => {
  m.admin.mockRejectedValue(new Error(message));
  const response = await call('read=products');
  expect(response.status).toBe(status);
  expect(m.products).not.toHaveBeenCalled();
});

it('reports an unexpected failure as 500 without its details', async () => {
  m.admin.mockResolvedValue({});
  m.chart.mockRejectedValue(new Error('database password is hunter2'));
  const response = await call('read=chart');
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('hunter2');
});

it.each(['read=nope', 'read=constructor', 'read=chart&productId=not-a-uuid', 'read=chart&start=yesterday', 'read=rates&base=EURO', 'read=rates', 'read=hourly&timezone=Not/AZone', 'read=chart&timezone=Not/AZone'])('rejects %s', async query => {
  m.admin.mockResolvedValue({});
  expect((await call(query)).status).toBe(400);
  expect(m.chart).not.toHaveBeenCalled();
  expect(m.rates).not.toHaveBeenCalled();
});

it('passes parsed chart arguments to the action', async () => {
  m.admin.mockResolvedValue({});
  m.chart.mockResolvedValue([{ date: '2026-10-01', amount: { PLN: 100 }, orders: 1 }]);
  const response = await call(`read=chart&days=0&start=2026-10-01T00:00:00.000Z&end=2026-10-25T00:00:00.000Z&productId=${PRODUCT}&timezone=Europe/Warsaw`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: [{ date: '2026-10-01', amount: { PLN: 100 }, orders: 1 }] });
  expect(m.chart).toHaveBeenCalledWith(0, new Date('2026-10-01T00:00:00.000Z'), new Date('2026-10-25T00:00:00.000Z'), PRODUCT, 'Europe/Warsaw');
});

it('upper-cases the exchange rate base and defaults the chart to 30 days', async () => {
  m.admin.mockResolvedValue({});
  m.rates.mockResolvedValue({ PLN: 1 });
  m.chart.mockResolvedValue([]);
  await call('read=rates&base=eur');
  await call('read=chart');
  expect(m.rates).toHaveBeenCalledWith('EUR');
  expect(m.chart).toHaveBeenCalledWith(30, undefined, undefined, undefined, undefined);
});

it('passes the viewer timezone to the hourly read', async () => {
  m.admin.mockResolvedValue({});
  m.hourly.mockResolvedValue([]);
  await call(`read=hourly&timezone=Europe/Warsaw&productId=${PRODUCT}`);
  await call('read=hourly');
  expect(m.hourly).toHaveBeenNthCalledWith(1, 'Europe/Warsaw', PRODUCT);
  expect(m.hourly).toHaveBeenNthCalledWith(2, undefined, undefined);
});
