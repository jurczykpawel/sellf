// @vitest-environment happy-dom
/**
 * Dashboard reads interrupted by leaving the page: no console noise, no unhandled rejection;
 * a failure while the component is still mounted is still logged.
 * @see src/components/dashboard/ProductFilter.tsx
 * @see src/components/StatsOverview.tsx
 */
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ProductFilter from '@/components/dashboard/ProductFilter';
import StatsOverview from '@/components/StatsOverview';
const { read, convert, realtime } = vi.hoisted(() => ({
  read: vi.fn(), convert: vi.fn(),
  realtime: { addRefreshListener: vi.fn(), removeRefreshListener: vi.fn() },
}));
vi.mock('@/lib/api/dashboard-reads', () => ({ readDashboard: read }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }), usePathname: () => '/dashboard',
}));
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('@/contexts/RealtimeContext', () => ({ useRealtime: () => realtime }));
vi.mock('@/contexts/UserPreferencesContext', () => ({
  useUserPreferences: () => ({ hideValues: false, currencyViewMode: 'converted', displayCurrency: 'USD' }),
}));
vi.mock('@/hooks/useCurrencyConversion', () => ({ useCurrencyConversion: () => ({ convertMultipleCurrencies: convert }) }));
vi.mock('@/components/ui/Combobox', () => ({ Combobox: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); read.mockReset(); convert.mockReset(); });

const failure = () => new Error('boom');
const deferred = () => {
  let reject!: (error: Error) => void;
  const promise = new Promise<never>((_, fail) => { reject = fail; });
  return { promise, reject };
};

it('ProductFilter: unmounting aborts the product list and its rejection stays quiet', async () => {
  const { promise, reject } = deferred();
  read.mockReturnValueOnce(promise);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { unmount } = render(createElement(ProductFilter));
  const signal: AbortSignal = read.mock.calls[0][2];
  expect(signal.aborted).toBe(false);
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { reject(failure()); });
  expect(log).not.toHaveBeenCalled();
});

it('ProductFilter: a failure while mounted is logged, not thrown', async () => {
  read.mockRejectedValueOnce(failure());
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { render(createElement(ProductFilter)); });
  expect(log).toHaveBeenCalledTimes(1);
});

const mountStatsWithRevenue = async () => {
  read.mockImplementation(async (name: string) => name === 'overview'
    ? { totalProducts: 0, totalUsers: 0, activeUsers: 0, totalOrders: 0, recentSales: [] }
    : { totalRevenue: { PLN: 100 }, todayRevenue: { PLN: 10 } });
  const { promise, reject } = deferred();
  convert.mockReturnValue(promise);
  const view = render(createElement(StatsOverview));
  await act(async () => {});
  return { view, reject };
};

it('StatsOverview: a currency conversion interrupted by unmount stays quiet', async () => {
  const { view, reject } = await mountStatsWithRevenue();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  view.unmount();
  await act(async () => { reject(failure()); });
  expect(log).not.toHaveBeenCalled();
});

it('StatsOverview: a conversion failure while mounted is logged', async () => {
  const { reject } = await mountStatsWithRevenue();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { reject(failure()); });
  expect(log).toHaveBeenCalledWith('Error converting revenue:', expect.any(Error));
});
