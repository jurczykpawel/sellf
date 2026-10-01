/**
 * Unit tests for the ECB (Frankfurter) currency provider's base URL.
 *
 * Sellf's E2E suite must not depend on the real frankfurter.dev host being
 * reachable. `CURRENCY_ECB_BASE_URL` lets a test runner point the provider at
 * a local stub server that serves fixed rates while still exercising the real
 * fetch + JSON-parsing code path in `ECBProvider.fetchRates`.
 *
 * @see admin-panel/src/lib/services/currencyService.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createCurrencyService, DEFAULT_ECB_BASE_URL } from '@/lib/services/currencyService';

const SAVED_CURRENCY_ECB_BASE_URL = process.env.CURRENCY_ECB_BASE_URL;

function stubFetchOnce(rates: Record<string, number>, base = 'USD') {
  return vi.fn().mockResolvedValue({
    ok: true,
    statusText: 'OK',
    json: async () => ({
      amount: 1,
      base,
      date: '2026-01-01',
      rates,
    }),
  });
}

beforeEach(() => {
  delete process.env.CURRENCY_ECB_BASE_URL;
});

afterEach(() => {
  if (SAVED_CURRENCY_ECB_BASE_URL === undefined) delete process.env.CURRENCY_ECB_BASE_URL;
  else process.env.CURRENCY_ECB_BASE_URL = SAVED_CURRENCY_ECB_BASE_URL;
  vi.unstubAllGlobals();
});

describe('DEFAULT_ECB_BASE_URL', () => {
  it('points at the real frankfurter.dev API', () => {
    expect(DEFAULT_ECB_BASE_URL).toBe('https://api.frankfurter.dev/v1');
  });
});

describe('ECBProvider base URL', () => {
  it('fetches from the default frankfurter.dev host when CURRENCY_ECB_BASE_URL is unset', async () => {
    const fetchMock = stubFetchOnce({ EUR: 0.9 });
    vi.stubGlobal('fetch', fetchMock);

    const service = createCurrencyService('ecb');
    await service.fetchRates('USD');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl.startsWith(DEFAULT_ECB_BASE_URL)).toBe(true);
  });

  it('fetches from CURRENCY_ECB_BASE_URL when set, instead of the real host', async () => {
    process.env.CURRENCY_ECB_BASE_URL = 'http://127.0.0.1:3799/fake-fx';
    const fetchMock = stubFetchOnce({ EUR: 0.5 });
    vi.stubGlobal('fetch', fetchMock);

    const service = createCurrencyService('ecb');
    await service.fetchRates('USD');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl.startsWith('http://127.0.0.1:3799/fake-fx')).toBe(true);
    expect(calledUrl.startsWith(DEFAULT_ECB_BASE_URL)).toBe(false);
  });

  it('still parses a real Frankfurter-shaped response through the normal code path', async () => {
    process.env.CURRENCY_ECB_BASE_URL = 'http://127.0.0.1:3799/fake-fx';
    const fetchMock = stubFetchOnce({ EUR: 0.9123, PLN: 4.01 }, 'USD');
    vi.stubGlobal('fetch', fetchMock);

    const service = createCurrencyService('ecb');
    const rates = await service.fetchRates('USD');

    expect(rates.base).toBe('USD');
    expect(rates.rates).toEqual({ EUR: 0.9123, PLN: 4.01 });
    expect(rates.source).toBe('ecb');
    expect(typeof rates.timestamp).toBe('number');
  });
});
