import { useState, useCallback, useRef } from 'react';
import { readDashboard } from '@/lib/api/dashboard-reads';
import { convertCurrencyAmount, convertCurrencyArray, type ExchangeRates } from '@/lib/utils/currency-conversion';
import { CurrencyAmount } from '@/lib/actions/analytics';

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Hook to convert CurrencyAmount objects to a single target currency
 * SUPER OPTIMIZED: Fetches rates ONCE and caches them, converts locally
 */
export function useCurrencyConversion() {
  const [converting, setConverting] = useState(false);

  // Cache rates in a ref to avoid re-fetching for same currency
  // Key: targetCurrency, Value: { rates, timestamp }
  const ratesCache = useRef<Map<string, { rates: ExchangeRates; timestamp: number }>>(new Map());

  /**
   * Get cached rates or fetch new ones
   * OPTIMIZED: Client-side cache + server-side cache
   */
  const getRates = useCallback(async (targetCurrency: string): Promise<ExchangeRates | null> => {
    // Check client-side cache first
    const cached = ratesCache.current.get(targetCurrency);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.rates;
    }

    // Fetch from server (which has its own cache)
    const rates = await readDashboard<ExchangeRates | null>('rates', { base: targetCurrency });
    if (rates) {
      ratesCache.current.set(targetCurrency, { rates, timestamp: Date.now() });
    }

    return rates;
  }, []);

  /**
   * Convert a CurrencyAmount object to a single currency
   * SUPER EFFICIENT: Fetches rates once (with cache), converts locally
   */
  const convertToSingleCurrency = useCallback(async (
    amounts: CurrencyAmount,
    targetCurrency: string
  ): Promise<number> => {
    if (!amounts || Object.keys(amounts).length === 0) {
      return 0;
    }

    // If only one currency and it matches target, return directly
    const currencies = Object.keys(amounts);
    if (currencies.length === 1 && currencies[0] === targetCurrency) {
      return amounts[targetCurrency];
    }

    setConverting(true);
    try {
      // Get rates (cached if available)
      const rates = await getRates(targetCurrency);

      if (!rates) {
        console.error(`Failed to get rates for ${targetCurrency}`);
        return amounts[targetCurrency] || 0;
      }

      // Convert locally using cached rates - NO SERVER CALL!
      const total = convertCurrencyAmount(amounts, targetCurrency, rates);
      return total;
    } finally {
      setConverting(false);
    }
  }, [getRates]);

  /**
   * Convert array of CurrencyAmount objects
   * SUPER EFFICIENT: Fetches rates ONCE, converts ALL locally
   */
  const convertMultipleCurrencies = useCallback(async (
    amountsArray: CurrencyAmount[],
    targetCurrency: string
  ): Promise<number[]> => {
    if (amountsArray.length === 0) return [];

    setConverting(true);
    try {
      // Get rates ONCE for all conversions
      const rates = await getRates(targetCurrency);

      if (!rates) {
        console.error(`Failed to get rates for ${targetCurrency}`);
        return amountsArray.map(() => 0);
      }

      // Convert ALL amounts locally - NO ADDITIONAL SERVER CALLS!
      const results = convertCurrencyArray(amountsArray, targetCurrency, rates);
      return results;
    } finally {
      setConverting(false);
    }
  }, [getRates]);

  return {
    convertToSingleCurrency,
    convertMultipleCurrencies,
    converting,
    getRates, // Export getRates in case components want to fetch rates once themselves
  };
}
