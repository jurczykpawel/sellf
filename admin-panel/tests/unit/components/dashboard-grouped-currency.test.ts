// @vitest-environment happy-dom
/**
 * Dashboard in "grouped by currency" mode never adds nominal amounts of different currencies together.
 * @see src/components/StatsOverview.tsx
 * @see src/components/dashboard/RevenueGoal.tsx
 */
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import StatsOverview from '@/components/StatsOverview';
import RevenueGoal from '@/components/dashboard/RevenueGoal';

const { read, convert, realtime, preferences, conversion } = vi.hoisted(() => {
  const convert = vi.fn();
  return {
    read: vi.fn(), convert, realtime: { addRefreshListener: vi.fn(), removeRefreshListener: vi.fn() },
    preferences: { hideValues: false, currencyViewMode: 'grouped', displayCurrency: null },
    conversion: { convertToSingleCurrency: convert, convertMultipleCurrencies: vi.fn() },
  };
});
vi.mock('@/lib/api/dashboard-reads', () => ({ readDashboard: read }));
vi.mock('@/lib/actions/analytics', () => ({ setRevenueGoal: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/contexts/RealtimeContext', () => ({ useRealtime: () => realtime }));
vi.mock('@/contexts/UserPreferencesContext', () => ({ useUserPreferences: () => preferences }));
vi.mock('@/hooks/useCurrencyConversion', () => ({ useCurrencyConversion: () => conversion }));
afterEach(() => { cleanup(); read.mockReset(); convert.mockReset(); });

it('shows no "today" change when nothing was sold today', async () => {
  read.mockImplementation(async (name: string) => name === 'stats'
    ? { totalRevenue: { PLN: 692922, USD: 72494 }, todayRevenue: {}, todayOrders: 0, lastOrderAt: null }
    : { totalProducts: 1, totalUsers: 1, totalAccess: 0, activeUsers: 0, totalRevenue: 0 });
  await act(async () => { render(createElement(StatsOverview)); });
  expect(screen.getByTestId('stat-card-total-revenue').textContent).not.toContain('stats.todayChange');
});

it('measures the revenue goal in the goal currency, not as a sum of nominals', async () => {
  read.mockImplementation(async (name: string) => name === 'goal'
    ? { amount: 1000000, startDate: '2026-10-01T00:00:00Z', currency: 'USD' }
    : { totalRevenue: { JPY: 1000, PLN: 692922, USD: 72494 }, todayRevenue: {}, todayOrders: 0, lastOrderAt: null });
  convert.mockResolvedValue(250000);
  const { container } = render(createElement(RevenueGoal));
  await act(async () => {});
  expect(convert).toHaveBeenCalledWith({ JPY: 1000, PLN: 692922, USD: 72494 }, 'USD');
  expect(container.textContent).toContain('$2,500');
  expect(container.textContent).not.toContain('$7,664');
  expect(container.textContent).toContain('goalConvertedNote');
});
