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
const { products, dashboard, revenue, convert, realtime } = vi.hoisted(() => ({
  products: vi.fn(), dashboard: vi.fn(), revenue: vi.fn(), convert: vi.fn(),
  realtime: { addRefreshListener: vi.fn(), removeRefreshListener: vi.fn() },
}));
vi.mock('@/lib/actions/products', () => ({ getProductsList: products }));
vi.mock('@/lib/actions/dashboard', () => ({ getDashboardStats: dashboard }));
vi.mock('@/lib/actions/analytics', () => ({ getRevenueStats: revenue }));
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
afterEach(() => { cleanup(); vi.restoreAllMocks(); products.mockReset(); dashboard.mockReset(); revenue.mockReset(); convert.mockReset(); });

const unexpected = () => new Error('An unexpected response was received from the server.');
const deferred = () => {
  let reject!: (error: Error) => void;
  const promise = new Promise<never>((_, fail) => { reject = fail; });
  return { promise, reject };
};

it('ProductFilter: a product list interrupted by unmount rejects quietly', async () => {
  const { promise, reject } = deferred();
  products.mockReturnValueOnce(promise);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { unmount } = render(createElement(ProductFilter));
  unmount();
  await act(async () => { reject(unexpected()); });
  expect(log).not.toHaveBeenCalled();
});

it('ProductFilter: a failure while mounted is logged, not thrown', async () => {
  products.mockRejectedValueOnce(unexpected());
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { render(createElement(ProductFilter)); });
  expect(log).toHaveBeenCalledTimes(1);
});

const mountStatsWithRevenue = async () => {
  dashboard.mockResolvedValue({ totalProducts: 0, totalUsers: 0, activeUsers: 0, totalOrders: 0, recentSales: [] });
  revenue.mockResolvedValue({ totalRevenue: { PLN: 100 }, todayRevenue: { PLN: 10 } });
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
  await act(async () => { reject(unexpected()); });
  expect(log).not.toHaveBeenCalled();
});

it('StatsOverview: a conversion failure while mounted is logged', async () => {
  const { reject } = await mountStatsWithRevenue();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { reject(unexpected()); });
  expect(log).toHaveBeenCalledWith('Error converting revenue:', expect.any(Error));
});
