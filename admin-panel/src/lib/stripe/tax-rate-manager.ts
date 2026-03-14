/**
 * Stripe Tax Rate Manager
 *
 * Manages creation and caching of immutable Stripe Tax Rate objects.
 * Tax Rates in Stripe cannot be updated (percentage, inclusive, country are fixed),
 * so we create new ones when settings change and cache their IDs.
 *
 * Cache is stored in shop_config.stripe_tax_rate_cache JSONB.
 *
 * @see https://stripe.com/docs/api/tax_rates
 */

import { getStripeServer } from '@/lib/stripe/server';
import { getShopConfig, updateShopConfig } from '@/lib/actions/shop-config';

// ===== TYPES =====

interface TaxRateParams {
  percentage: number;
  inclusive: boolean;
  displayName?: string;
  country?: string;
}

// ===== CACHE KEY =====

function buildCacheKey(percentage: number, inclusive: boolean): string {
  return `${percentage.toFixed(2)}_${inclusive ? 'inclusive' : 'exclusive'}`;
}

// ===== IN-FLIGHT DEDUPLICATION =====

// Prevents duplicate Stripe API calls when multiple line items share the same tax rate
// within a single checkout request. Map is keyed by cacheKey, value is the pending promise.
const inFlightRequests = new Map<string, Promise<string>>();

// ===== GET OR CREATE =====

/**
 * Get or create a Stripe Tax Rate for the given parameters.
 * Checks cache first; creates new if not found or if cached ID is invalid.
 * Uses in-flight deduplication to avoid N+1 calls for the same rate within a request.
 */
export async function getOrCreateStripeTaxRate(params: TaxRateParams): Promise<string> {
  const { percentage, inclusive, displayName = 'VAT', country } = params;
  const cacheKey = buildCacheKey(percentage, inclusive);

  // Deduplicate concurrent requests for the same tax rate
  const existing = inFlightRequests.get(cacheKey);
  if (existing) return existing;

  const promise = _resolveStripeTaxRate(cacheKey, percentage, inclusive, displayName, country);
  inFlightRequests.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

async function _resolveStripeTaxRate(
  cacheKey: string,
  percentage: number,
  inclusive: boolean,
  displayName: string,
  country?: string,
): Promise<string> {
  const shopConfig = await getShopConfig();
  const cache: Record<string, string> = (shopConfig?.stripe_tax_rate_cache as Record<string, string>) || {};

  // Check cache — validate the cached ID still exists and matches
  if (cache[cacheKey]) {
    try {
      const stripe = await getStripeServer();
      const existing = await stripe.taxRates.retrieve(cache[cacheKey]);
      if (existing.active && existing.percentage === percentage && existing.inclusive === inclusive) {
        return cache[cacheKey];
      }
    } catch {
      // Cache entry invalid (deleted, archived, or Stripe error) — create new
    }
  }

  // Create new Stripe Tax Rate
  const stripe = await getStripeServer();
  const taxRate = await stripe.taxRates.create({
    display_name: displayName,
    percentage,
    inclusive,
    ...(country && { country }),
    description: `${displayName} ${percentage}% (${inclusive ? 'inclusive' : 'exclusive'})`,
  });

  // Update cache
  const updatedCache = { ...cache, [cacheKey]: taxRate.id };
  await updateShopConfig({ stripe_tax_rate_cache: updatedCache });

  return taxRate.id;
}
