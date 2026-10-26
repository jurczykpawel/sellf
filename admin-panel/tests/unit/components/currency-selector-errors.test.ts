// @vitest-environment happy-dom
/**
 * Dashboard reads: interrupted ones stay quiet, real failures are still logged.
 * @see src/components/dashboard/CurrencySelector.tsx
 */
import { createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import CurrencySelector from '@/components/dashboard/CurrencySelector';
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/api/dashboard-reads', () => ({ readDashboard: read }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/contexts/UserPreferencesContext', () => ({
  useUserPreferences: () => ({ displayCurrency: null, currencyViewMode: 'grouped', setCurrencyPreferences: vi.fn() }),
}));
vi.mock('@/components/ui/Tooltip', () => ({ Tooltip: ({ children }: { children: unknown }) => children }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); read.mockReset(); });

const failure = () => new Error('boom');

it('logs a failed read while the component is mounted', async () => {
  read.mockRejectedValueOnce(failure());
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { render(createElement(CurrencySelector)); });
  expect(log).toHaveBeenCalledTimes(1);
});

it('aborts the read on unmount and ignores its rejection', async () => {
  let reject!: (error: Error) => void;
  read.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { unmount } = render(createElement(CurrencySelector));
  const signal: AbortSignal = read.mock.calls[0][2];
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { reject(failure()); });
  expect(log).not.toHaveBeenCalled();
});
