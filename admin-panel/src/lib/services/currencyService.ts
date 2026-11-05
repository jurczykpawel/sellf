/**
 * Currency Exchange Rate Service
 *
 * Uses Next.js fetch cache for automatic rate caching (1 hour revalidation).
 * Flexible architecture - easy to swap providers by changing the implementation.
 */

export interface ExchangeRateProvider {
  name: string;
  fetchRates(baseCurrency: string): Promise<ExchangeRates>;
}

export interface ExchangeRates {
  base: string;
  rates: { [currency: string]: number };
  timestamp: number;
  source: string;
}

// Cache duration: 1 hour (3600 seconds)
const CACHE_DURATION = 3600;

/**
 * ExchangeRate-API.com Provider (FREE tier: 1500 requests/month)
 * Docs: https://www.exchangerate-api.com/docs/overview
 */
class ExchangeRateApiProvider implements ExchangeRateProvider {
  name = 'exchangerate-api';
  private apiKey: string;
  private baseUrl = 'https://v6.exchangerate-api.com/v6';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchRates(baseCurrency: string): Promise<ExchangeRates> {
    const url = `${this.baseUrl}/${this.apiKey}/latest/${baseCurrency}`;

    // Next.js will automatically cache this for CACHE_DURATION
    const response = await fetch(url, {
      next: { revalidate: CACHE_DURATION },
      redirect: 'error',
    });

    if (!response.ok) {
      throw new Error(`ExchangeRate-API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.result !== 'success') {
      throw new Error(`ExchangeRate-API returned: ${data['error-type']}`);
    }

    return {
      base: data.base_code,
      rates: data.conversion_rates,
      timestamp: data.time_last_update_unix * 1000,
      source: this.name,
    };
  }
}

/**
 * Fixer.io Provider (Paid, highly reliable)
 * Docs: https://fixer.io/documentation
 */
class FixerIoProvider implements ExchangeRateProvider {
  name = 'fixer';
  private apiKey: string;
  private baseUrl = 'https://api.fixer.io';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchRates(baseCurrency: string): Promise<ExchangeRates> {
    const url = `${this.baseUrl}/latest?access_key=${this.apiKey}&base=${baseCurrency}`;

    // Next.js will automatically cache this for CACHE_DURATION
    const response = await fetch(url, {
      next: { revalidate: CACHE_DURATION },
      redirect: 'error',
    });

    if (!response.ok) {
      throw new Error(`Fixer.io error: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(`Fixer.io error: ${data.error?.type}`);
    }

    return {
      base: data.base,
      rates: data.rates,
      timestamp: data.timestamp * 1000,
      source: this.name,
    };
  }
}

/**
 * Real Frankfurter API host. The single source of truth for the ECB
 * provider's default base URL — reused by the production startup guard
 * (`assertCurrencyProviderBaseUrl`) so the two never drift apart.
 */
export const DEFAULT_ECB_BASE_URL = 'https://api.frankfurter.dev/v1';

/**
 * European Central Bank Provider (FREE, official EU rates via Frankfurter API)
 * No API key needed. Uses frankfurter.dev (open-source, maintained by ECB data)
 * Source: https://www.frankfurter.dev/
 *
 * The base URL is overridable via `CURRENCY_ECB_BASE_URL` so an E2E test run
 * can point this provider at a local stub server instead of the real host —
 * `assertCurrencyProviderBaseUrl` (startup-assertions.ts) refuses to boot in
 * production with any override other than the real host.
 */
class ECBProvider implements ExchangeRateProvider {
  name = 'ecb';
  private baseUrl: string;

  constructor(baseUrl: string = process.env.CURRENCY_ECB_BASE_URL || DEFAULT_ECB_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async fetchRates(baseCurrency: string): Promise<ExchangeRates> {
    const url = `${this.baseUrl}/latest?from=${baseCurrency}`;

    // Next.js will automatically cache this for CACHE_DURATION
    const response = await fetch(url, {
      next: { revalidate: CACHE_DURATION },
      redirect: 'error',
    });

    if (!response.ok) {
      throw new Error(`ECB (Frankfurter) error: ${response.statusText}`);
    }

    const data = await response.json();

    // Frankfurter returns { amount, base, date, rates }
    if (!data.rates) {
      throw new Error(`ECB (Frankfurter) error: no rates in response`);
    }

    return {
      base: data.base,
      rates: data.rates,
      timestamp: new Date(data.date).getTime(),
      source: this.name,
    };
  }
}

export class CurrencyService {
  private provider: ExchangeRateProvider;

  constructor(providerType: 'exchangerate-api' | 'fixer' | 'ecb' = 'ecb', apiKey?: string) {
    switch (providerType) {
      case 'exchangerate-api':
        if (!apiKey) throw new Error('ExchangeRate-API requires API key');
        this.provider = new ExchangeRateApiProvider(apiKey);
        break;
      case 'fixer':
        if (!apiKey) throw new Error('Fixer.io requires API key');
        this.provider = new FixerIoProvider(apiKey);
        break;
      case 'ecb':
      default:
        this.provider = new ECBProvider();
    }
  }

  /**
   * Fetch latest rates from provider
   */
  async fetchRates(baseCurrency: string = 'USD'): Promise<ExchangeRates> {
    return this.provider.fetchRates(baseCurrency);
  }

  /**
   * Convert amount from one currency to another
   */
  convert(amount: number, from: string, to: string, rates: ExchangeRates): number {
    if (from === to) return amount;

    // If base matches 'from', use rate directly
    if (rates.base === from && rates.rates[to]) {
      return amount * rates.rates[to];
    }

    // If base matches 'to', use inverse rate
    if (rates.base === to && rates.rates[from]) {
      return amount / rates.rates[from];
    }

    // Cross-currency conversion through base
    const toBaseRate = rates.rates[from];
    const fromBaseRate = rates.rates[to];

    if (!toBaseRate || !fromBaseRate) {
      throw new Error(`Cannot convert ${from} to ${to}: missing rates`);
    }

    return (amount / toBaseRate) * fromBaseRate;
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return this.provider.name;
  }
}

/**
 * Create currency service instance based on configuration
 * Priority: Database > .env > manual fallback
 *
 * Note: This function should be called from server actions that use getDecryptedCurrencyConfig
 * For direct instantiation, use new CurrencyService(provider, apiKey)
 */
export function createCurrencyService(provider?: string, apiKey?: string): CurrencyService {
  // If provider and apiKey are provided directly, use them
  if (provider) {
    return new CurrencyService(provider as any, apiKey);
  }

  // Fallback to .env for backward compatibility (when called without getDecryptedCurrencyConfig)
  const envProvider = (process.env.NEXT_PUBLIC_CURRENCY_PROVIDER as any) || 'ecb';
  const envApiKey = process.env.CURRENCY_API_KEY;

  return new CurrencyService(envProvider, envApiKey);
}
