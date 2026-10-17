/**
 * CLIENT-SIDE CURRENCY CONVERSION
 * Lightweight helpers to convert currencies locally without server calls
 * Just needs exchange rates fetched once from server
 */

import { fromMinorUnits, toMinorUnits } from '@/lib/currency/minor-units';

export interface ExchangeRates {
  base: string;
  rates: { [currency: string]: number };
  timestamp?: number;
  source?: string;
}

/**
 * Convert amount from one currency to another using provided rates
 * This runs entirely on the client - no server calls!
 */
export function convertAmount(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: ExchangeRates
): number {
  // Same currency - no conversion needed
  if (fromCurrency === toCurrency) {
    return amount;
  }

  // If base currency matches 'from', direct conversion
  if (rates.base === fromCurrency) {
    const rate = rates.rates[toCurrency];
    if (!rate) {
      throw new Error(`No rate found for ${toCurrency}`);
    }
    return amount * rate;
  }

  // If base currency matches 'to', inverse conversion
  if (rates.base === toCurrency) {
    const rate = rates.rates[fromCurrency];
    if (!rate) {
      throw new Error(`No rate found for ${fromCurrency}`);
    }
    return amount / rate;
  }

  // Otherwise, convert through base currency
  const fromRate = rates.rates[fromCurrency];
  const toRate = rates.rates[toCurrency];

  if (!fromRate || !toRate) {
    throw new Error(`Missing rates for conversion ${fromCurrency} -> ${toCurrency}`);
  }

  // Convert from -> base -> to
  const amountInBase = amount / fromRate;
  return amountInBase * toRate;
}

/**
 * Convert an amount in Stripe minor units between currencies. Rates apply to major
 * units, so go minor -> major -> convert -> minor of the target (JPY has no minor unit).
 */
export function convertMinorAmount(
  minor: number,
  fromCurrency: string,
  toCurrency: string,
  rates: ExchangeRates
): number {
  if (fromCurrency === toCurrency) return minor;
  const major = convertAmount(fromMinorUnits(minor, fromCurrency), fromCurrency, toCurrency, rates);
  return toMinorUnits(major, toCurrency);
}

/**
 * Convert CurrencyAmount object (multiple currencies) to single target currency
 * Uses local conversion - no API calls!
 */
export function convertCurrencyAmount(
  amounts: { [currency: string]: number },
  targetCurrency: string,
  rates: ExchangeRates
): number {
  let total = 0;

  for (const [currency, amount] of Object.entries(amounts)) {
    if (currency === targetCurrency) {
      total += amount;
    } else {
      try {
        const converted = convertMinorAmount(amount, currency, targetCurrency, rates);
        total += converted;
      } catch (error) {
        console.error(`Failed to convert ${amount} ${currency} to ${targetCurrency}:`, error);
        // Skip this amount
      }
    }
  }

  return Math.round(total);
}

/**
 * Convert array of CurrencyAmount objects to target currency
 * Uses local conversion - no API calls!
 */
export function convertCurrencyArray(
  amountsArray: Array<{ [currency: string]: number }>,
  targetCurrency: string,
  rates: ExchangeRates
): number[] {
  return amountsArray.map(amounts => convertCurrencyAmount(amounts, targetCurrency, rates));
}
