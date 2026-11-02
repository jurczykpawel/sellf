// @vitest-environment happy-dom
/** Regression: overlapping config loads must not reset a provider the user already picked. */
import { StrictMode, createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CurrencySettings from '@/components/settings/CurrencySettings';

const mocks = vi.hoisted(() => ({ getConfig: vi.fn() }));

vi.mock('next-intl', async (importOriginal) => {
  const { createNextIntlMock } = await import('@/../tests/mocks/next-intl');
  return createNextIntlMock(await importOriginal<typeof import('next-intl')>());
});
vi.mock('@/lib/actions/currency-config', () => ({
  getCurrencyConfig: mocks.getConfig,
  saveCurrencyConfig: vi.fn(),
  deleteCurrencyConfig: vi.fn(),
}));
vi.mock('@/lib/actions/currency', () => ({ getExchangeRates: vi.fn() }));
vi.mock('@/lib/actions/shop-config', () => ({ getMyDefaultCurrency: async () => 'USD' }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const configWith = (provider: string) => ({
  success: true,
  data: { provider, enabled: true, hasDatabaseConfig: false, configuredIn: 'none' },
});

it('shows the form only once the newest config load has settled', async () => {
  const resolvers: ((value: unknown) => void)[] = [];
  mocks.getConfig.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));

  const view = render(createElement(StrictMode, null, createElement(CurrencySettings)));
  await act(async () => {});
  expect(resolvers).toHaveLength(2);

  await act(async () => { resolvers[0](configWith('ecb')); });
  expect(view.container.querySelector('select#provider')).toBeNull();

  await act(async () => { resolvers[1](configWith('fixer')); });
  const select = view.container.querySelector('select#provider') as HTMLSelectElement;
  expect(select.value).toBe('fixer');
  fireEvent.change(select, { target: { value: 'exchangerate-api' } });
  expect(select.value).toBe('exchangerate-api');
});
