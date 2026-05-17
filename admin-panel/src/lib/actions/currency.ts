'use server'

import { createClient } from '@/lib/supabase/server'
import { withAdminClient } from '@/lib/actions/admin-auth'
import { createCurrencyService, type ExchangeRates } from '@/lib/services/currencyService'
import { getDecryptedCurrencyConfigInternal as getDecryptedCurrencyConfig } from '@/lib/integrations/internal-secrets'

// ============================================
// SERVER-SIDE CACHE FOR EXCHANGE RATES
// ============================================
// Cache rates for 1 hour to avoid hammering external APIs
// Key format: `${provider}-${baseCurrency}-${hourTimestamp}`

interface CachedRates {
  rates: ExchangeRates
  expiresAt: number
}

const ratesCache = new Map<string, CachedRates>()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

function getCacheKey(provider: string, baseCurrency: string): string {
  // Round to nearest hour to maximize cache hits
  const hourTimestamp = Math.floor(Date.now() / CACHE_TTL)
  return `${provider}-${baseCurrency}-${hourTimestamp}`
}

function getCachedRates(provider: string, baseCurrency: string): ExchangeRates | null {
  const key = getCacheKey(provider, baseCurrency)
  const cached = ratesCache.get(key)

  if (!cached) return null

  // Check expiry
  if (Date.now() > cached.expiresAt) {
    ratesCache.delete(key)
    return null
  }

  return cached.rates
}

function setCachedRates(provider: string, baseCurrency: string, rates: ExchangeRates): void {
  const key = getCacheKey(provider, baseCurrency)
  ratesCache.set(key, {
    rates,
    expiresAt: Date.now() + CACHE_TTL
  })

  // Clean up old cache entries (keep only last 20)
  if (ratesCache.size > 20) {
    const firstKey = ratesCache.keys().next().value
    if (firstKey) ratesCache.delete(firstKey)
  }
}

/**
 * Fetch exchange rates (cached for 1 hour)
 * OPTIMIZED: Uses server-side cache to avoid redundant API calls
 * Priority: Database config > .env config > manual fallback
 */
export async function getExchangeRates(baseCurrency: string = 'USD'): Promise<ExchangeRates | null> {
  try {
    // Get decrypted config from database (priority) or .env (fallback)
    const config = await getDecryptedCurrencyConfig()

    if (!config) {
      console.error('[getExchangeRates] No currency config found')
      return null
    }

    // Check cache first
    const cached = getCachedRates(config.provider, baseCurrency)
    if (cached) {
      return cached
    }

    const currencyService = createCurrencyService(config.provider, config.apiKey || undefined)
    const rates = await currencyService.fetchRates(baseCurrency)

    if (rates) {
      setCachedRates(config.provider, baseCurrency, rates)
    }

    return rates
  } catch (error: any) {
    console.error('Error fetching exchange rates:', error)
    return null
  }
}

/**
 * Convert amount from one currency to another using cached rates
 * OPTIMIZED: Uses getExchangeRates() which has server-side cache
 * Priority: Database config > .env config > manual fallback
 */
export async function convertCurrencyAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<number | null> {
  try {
    if (fromCurrency === toCurrency) return amount

    // Get decrypted config
    const config = await getDecryptedCurrencyConfig()

    if (!config) {
      console.error('[convertCurrencyAmount] No currency config found')
      return null
    }

    // Use cached getExchangeRates instead of direct fetch
    const rates = await getExchangeRates(fromCurrency)

    if (!rates) {
      console.error(`[convertCurrencyAmount] No rates returned for base ${fromCurrency}`)
      return null
    }

    if (!rates.rates[toCurrency]) {
      console.error(`[convertCurrencyAmount] No rate found for ${fromCurrency} → ${toCurrency}. Available rates:`, Object.keys(rates.rates))
      return null
    }

    const currencyService = createCurrencyService(config.provider, config.apiKey || undefined)
    const convertedAmount = currencyService.convert(amount, fromCurrency, toCurrency, rates)
    return Math.round(convertedAmount) // Round to nearest cent
  } catch (error: any) {
    console.error(`[convertCurrencyAmount] Error converting ${amount} from ${fromCurrency} to ${toCurrency}:`, error.message)
    return null
  }
}

/**
 * Get all unique currencies used in transactions
 */
export async function getUsedCurrencies(): Promise<string[]> {
  // Used by the dashboard CurrencySelector which only renders when
  // currencies.length > 1 — under anon RLS this often returned [] because
  // the authenticated user's session race didn't yet have is_admin() cached,
  // leaving the selector invisible despite multi-currency transactions in
  // the DB. Admin-gated server action with the admin data client side-steps
  // the race; the endpoint is already admin-only (dashboard route).
  const result = await withAdminClient(async ({ dataClient }) => {
    const { data, error } = await dataClient
      .from('payment_transactions')
      .select('currency')
      .eq('status', 'completed')

    if (error) {
      console.error('Error fetching currencies:', error)
      return { success: false, error: error.message }
    }

    const currencies = [...new Set(data?.map((row) => row.currency) || [])]
    return { success: true, data: currencies.sort() }
  })

  return result.success ? (result.data ?? []) : []
}

/**
 * Bulk convert multiple amounts from different currencies to target currency
 * OPTIMIZED: Uses cached getExchangeRates + local conversion (no N API calls)
 */
export async function bulkConvertCurrency(
  amounts: { [currency: string]: number },
  targetCurrency: string
): Promise<number | null> {
  try {
    // If only target currency, no conversion needed
    const currencies = Object.keys(amounts);
    if (currencies.length === 1 && currencies[0] === targetCurrency) {
      return amounts[targetCurrency];
    }

    // Get config
    const config = await getDecryptedCurrencyConfig();
    if (!config) {
      console.error('[bulkConvertCurrency] No currency config found');
      return null;
    }

    // Use cached getExchangeRates instead of direct fetch
    const rates = await getExchangeRates(targetCurrency);
    if (!rates) {
      console.error('[bulkConvertCurrency] No rates returned');
      return null;
    }

    const currencyService = createCurrencyService(config.provider, config.apiKey || undefined);
    let total = 0;

    // Convert each amount locally (no API calls)
    for (const [currency, amount] of Object.entries(amounts)) {
      if (currency === targetCurrency) {
        total += amount;
      } else {
        try {
          const converted = currencyService.convert(amount, currency, targetCurrency, rates);
          total += converted;
        } catch (error: any) {
          console.error(`[bulkConvertCurrency] Failed to convert ${amount} ${currency} to ${targetCurrency}:`, error.message);
          // Skip this amount - don't add wrong currency
        }
      }
    }

    return Math.round(total);
  } catch (error: any) {
    console.error('[bulkConvertCurrency] Error:', error.message);
    return null;
  }
}

/**
 * Convert array of CurrencyAmount objects to target currency
 * SUPER OPTIMIZED: Fetches rates ONCE for ALL conversions
 * Perfect for charts with many data points (e.g. 30 days)
 */
export async function bulkConvertArray(
  amountsArray: Array<{ [currency: string]: number }>,
  targetCurrency: string
): Promise<number[]> {
  try {
    // Get config once
    const config = await getDecryptedCurrencyConfig();
    if (!config) {
      console.error('[bulkConvertArray] No currency config found');
      return amountsArray.map(() => 0);
    }

    // Fetch rates ONCE for all conversions
    const rates = await getExchangeRates(targetCurrency);
    if (!rates) {
      console.error('[bulkConvertArray] No rates returned');
      return amountsArray.map(() => 0);
    }

    const currencyService = createCurrencyService(config.provider, config.apiKey || undefined);

    // Convert all amounts using the same rates
    return amountsArray.map(amounts => {
      const currencies = Object.keys(amounts);

      // If only target currency, return directly
      if (currencies.length === 1 && currencies[0] === targetCurrency) {
        return amounts[targetCurrency];
      }

      let total = 0;
      for (const [currency, amount] of Object.entries(amounts)) {
        if (currency === targetCurrency) {
          total += amount;
        } else {
          try {
            const converted = currencyService.convert(amount, currency, targetCurrency, rates);
            total += converted;
          } catch (error: any) {
            console.error(`[bulkConvertArray] Failed to convert ${amount} ${currency} to ${targetCurrency}:`, error.message);
          }
        }
      }
      return Math.round(total);
    });
  } catch (error: any) {
    console.error('[bulkConvertArray] Error:', error.message);
    return amountsArray.map(() => 0);
  }
}
