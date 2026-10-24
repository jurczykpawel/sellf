// @vitest-environment happy-dom
/** @see src/components/StatsOverview.tsx */
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import StatsOverview from '@/components/StatsOverview';
const { dashboard, revenue, realtime } = vi.hoisted(() => ({
  dashboard: vi.fn(), revenue: vi.fn(), realtime: { addRefreshListener: vi.fn(), removeRefreshListener: vi.fn() },
}));
vi.mock('@/lib/actions/dashboard', () => ({ getDashboardStats: dashboard }));
vi.mock('@/lib/actions/analytics', () => ({ getRevenueStats: revenue }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string) => key }));
vi.mock('@/contexts/RealtimeContext', () => ({ useRealtime: () => realtime }));
vi.mock('@/contexts/UserPreferencesContext', () => ({ useUserPreferences: () => ({ hideValues: true }) }));
vi.mock('@/hooks/useCurrencyConversion', () => ({ useCurrencyConversion: () => ({}) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['AbortError', 'unmount'])('does not log a stats request after %s', async reason => {
  let reject!: (error: Error) => void;
  dashboard.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  revenue.mockResolvedValue(null);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const view = render(createElement(StatsOverview));
  if (reason === 'unmount') view.unmount();
  await act(async () => { reject(reason === 'unmount' ? new TypeError('Failed to fetch') : new DOMException('Cancelled', 'AbortError')); });
  expect(log).not.toHaveBeenCalled();
});

it('still logs a failed active stats request', async () => {
  dashboard.mockRejectedValue(new TypeError('Failed to fetch'));
  revenue.mockResolvedValue(null);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { render(createElement(StatsOverview)); });
  expect(log).toHaveBeenCalledWith('[StatsOverview] Failed to fetch stats:', expect.any(TypeError));
});
