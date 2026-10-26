// @vitest-environment happy-dom
/** Revenue series, axes and labels share major currency units. @see src/components/dashboard/RevenueChart.tsx */
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RevenueChart from '@/components/dashboard/RevenueChart';

const state = vi.hoisted(() => ({
  read: vi.fn(), chart: { data: [] as Record<string, number>[] },
  axis: { tickFormatter: (_value: number): string => '' },
  tooltip: { formatter: (_value: number, _name: string): string[] => [] },
  preferences: { hideValues: false, currencyViewMode: 'grouped', displayCurrency: 'PLN' },
  realtime: { addRefreshListener: vi.fn(), removeRefreshListener: vi.fn() },
  conversion: { convertMultipleCurrencies: vi.fn() },
}));
vi.mock('@/lib/api/dashboard-reads', () => ({ readDashboard: state.read }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/contexts/RealtimeContext', () => ({ useRealtime: () => state.realtime }));
vi.mock('@/contexts/UserPreferencesContext', () => ({ useUserPreferences: () => state.preferences }));
vi.mock('@/hooks/useCurrencyConversion', () => ({ useCurrencyConversion: () => state.conversion }));
vi.mock('@/components/dashboard/DateRangeFilter', () => ({ default: () => null }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  AreaChart: ({ children, data }: { children: ReactNode; data: Record<string, number>[] }) => { state.chart.data = data; return createElement('svg', null, children); },
  YAxis: (props: typeof state.axis) => { state.axis = props; return null; },
  Tooltip: (props: typeof state.tooltip) => { state.tooltip = props; return null; },
  Area: () => null, XAxis: () => null, CartesianGrid: () => null, Legend: () => null,
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  state.preferences.hideValues = false;
  state.preferences.currencyViewMode = 'grouped';
  state.read.mockResolvedValue([
    { date: '2026-10-24', hour: 12, amount: { PLN: 330840, JPY: 1000 }, orders: 2 },
    { date: '2026-10-25', hour: 13, amount: { PLN: 351160 }, orders: 1 },
  ]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const renderChart = async () => { await act(async () => { render(createElement(RevenueChart)); }); };
const currency = (value: number, code: string) => new Intl.NumberFormat('en', {
  style: 'currency', currency: code, minimumFractionDigits: 0, maximumFractionDigits: 0,
}).format(value);

it('plots mixed PLN and JPY in major units and fills missing currencies with zero', async () => {
  await renderChart();
  expect(state.chart.data[0]).toMatchObject({ PLN: 3308.4, JPY: 1000 });
  expect(state.chart.data[1]).toMatchObject({ PLN: 3511.6, JPY: 0 });
  expect(state.axis.tickFormatter(4000)).toBe('4K');
  expect(state.tooltip.formatter(3308.4, 'PLN')).toEqual([currency(3308.4, 'PLN'), 'PLN']);
  expect(state.tooltip.formatter(1000, 'JPY')).toEqual([currency(1000, 'JPY'), 'JPY']);
  expect(screen.getByText(`${currency(1000, 'JPY')} + ${currency(6820, 'PLN')}`, { normalizer: value => value })).toBeTruthy();
});

it.each(['PLN', 'JPY', 'KRW', 'VND'])('keeps the single %s series, axis, tooltip and total consistent', async code => {
  const major = code === 'PLN' ? 3308.4 : 1000;
  state.read.mockResolvedValue([{ date: '2026-10-24', amount: { [code]: code === 'PLN' ? 330840 : 1000 }, orders: 1 }]);
  await renderChart();
  expect(state.chart.data[0][code]).toBe(major);
  expect(state.axis.tickFormatter(major)).toBe(currency(major, code));
  expect(state.tooltip.formatter(major, code)).toEqual([currency(major, code), code]);
  expect(screen.getByText(currency(major, code), { normalizer: value => value })).toBeTruthy();
});

it('uses the same units for hourly grouped data', async () => {
  await renderChart();
  await act(async () => { fireEvent.click(screen.getByText('revenueChart.periodToday')); });
  expect(state.read).toHaveBeenLastCalledWith('hourly', expect.anything(), expect.anything());
  expect(state.chart.data[0]).toMatchObject({ hour: 12, PLN: 3308.4, JPY: 1000 });
});

it('normalizes converted amounts once for the series, axis and tooltip', async () => {
  state.preferences.currencyViewMode = 'converted';
  state.conversion.convertMultipleCurrencies.mockResolvedValue([333340, 351160]);
  await renderChart();
  expect(state.chart.data[0].PLN).toBe(3333.4);
  expect(state.axis.tickFormatter(3333.4)).toBe(currency(3333.4, 'PLN'));
  expect(state.tooltip.formatter(3333.4, 'PLN')).toEqual([currency(3333.4, 'PLN'), 'PLN']);
  expect(screen.getByText(currency(6845, 'PLN'), { normalizer: value => value })).toBeTruthy();
});

it('retains hidden amounts in the header, single-currency axis and tooltip', async () => {
  state.preferences.hideValues = true;
  state.read.mockResolvedValue([{ date: '2026-10-24', amount: { PLN: 330840 }, orders: 1 }]);
  await renderChart();
  expect(state.axis.tickFormatter(3308.4)).toBe('****');
  expect(state.tooltip.formatter(3308.4, 'PLN')).toEqual(['****', 'PLN']);
  expect(screen.getByText('****')).toBeTruthy();
});
