// @vitest-environment happy-dom
/**
 * Dashboard reads: interrupted ones stay quiet, real failures are still logged.
 * @see src/components/dashboard/CurrencySelector.tsx
 */
import { createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import CurrencySelector from '@/components/dashboard/CurrencySelector';
const { getUsedCurrencies } = vi.hoisted(() => ({ getUsedCurrencies: vi.fn() }));
vi.mock('@/lib/actions/currency', () => ({ getUsedCurrencies }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/contexts/UserPreferencesContext', () => ({
  useUserPreferences: () => ({ displayCurrency: null, currencyViewMode: 'grouped', setCurrencyPreferences: vi.fn() }),
}));
vi.mock('@/components/ui/Tooltip', () => ({ Tooltip: ({ children }: { children: unknown }) => children }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); getUsedCurrencies.mockReset(); });

const unexpected = () => new Error('An unexpected response was received from the server.');

it('logs "unexpected response" while the component is mounted', async () => {
  getUsedCurrencies.mockRejectedValueOnce(unexpected());
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { render(createElement(CurrencySelector)); });
  expect(log).toHaveBeenCalledTimes(1);
});

it('does not log "unexpected response" that arrives after unmount', async () => {
  let reject!: (error: Error) => void;
  getUsedCurrencies.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { unmount } = render(createElement(CurrencySelector));
  unmount();
  await act(async () => { reject(unexpected()); });
  expect(log).not.toHaveBeenCalled();
});
