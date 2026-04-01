/**
 * Omnibus Directive (EU 2019/2161) Service
 * Implements 30-day price history tracking for discount transparency
 *
 * All data-fetching functions require an explicit Supabase client parameter
 * to support marketplace multi-tenant schemas (DRY — no internal createClient).
 */

// ===== TYPES =====

type PriceEntry = {
  price: string;
  sale_price: string | null;
  currency: string;
  effective_from: string;
};

// ===== INTERNAL HELPERS =====

/**
 * Check if Omnibus price tracking is enabled in the given schema's shop_config.
 */
async function isOmnibusEnabled(client: any): Promise<boolean> {
  const { data, error } = await client
    .from('shop_config')
    .select('omnibus_enabled')
    .single();

  if (error) {
    console.error('Error checking Omnibus settings:', error);
    return false;
  }

  return data?.omnibus_enabled ?? false;
}

// ===== PUBLIC API =====

/**
 * Get the lowest price for a product in the last 30 days.
 * Returns null if Omnibus is disabled, product is exempt, or no price history exists.
 *
 * @param productId - Product UUID
 * @param client - Schema-scoped Supabase client (seller or platform)
 */
export async function getLowestPriceInLast30Days(
  productId: string,
  client: any,
): Promise<{
  lowestPrice: number;
  currency: string;
  effectiveFrom: Date;
} | null> {
  // Check if Omnibus is globally enabled in this schema
  const globalEnabled = await isOmnibusEnabled(client);
  if (!globalEnabled) {
    return null;
  }

  // Check if product is exempt
  const { data: product, error: productError } = await client
    .from('products')
    .select('omnibus_exempt')
    .eq('id', productId)
    .single();

  if (productError) {
    console.error('Error fetching product:', productError);
    return null;
  }

  if (product?.omnibus_exempt) {
    return null;
  }

  // Calculate 30 days ago
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Query price history — all entries from last 30 days
  const { data: history, error } = await client
    .from('product_price_history')
    .select('price, sale_price, currency, effective_from')
    .eq('product_id', productId)
    .gte('effective_from', thirtyDaysAgo.toISOString())
    .order('effective_from', { ascending: false });

  if (error || !history || history.length === 0) {
    return null;
  }

  // Find entry with lowest effective price (min of price and sale_price if set)
  const lowestEntry = history.reduce((lowest: PriceEntry, entry: PriceEntry) => {
    const effectivePrice = entry.sale_price
      ? Math.min(parseFloat(entry.price), parseFloat(entry.sale_price))
      : parseFloat(entry.price);

    const lowestEffectivePrice = lowest.sale_price
      ? Math.min(parseFloat(lowest.price), parseFloat(lowest.sale_price))
      : parseFloat(lowest.price);

    return effectivePrice < lowestEffectivePrice ? entry : lowest;
  });

  const lowestPrice = lowestEntry.sale_price
    ? Math.min(parseFloat(lowestEntry.price), parseFloat(lowestEntry.sale_price))
    : parseFloat(lowestEntry.price);

  return {
    lowestPrice,
    currency: lowestEntry.currency,
    effectiveFrom: new Date(lowestEntry.effective_from),
  };
}

/**
 * Determine if sale price is currently active.
 * Pure function — no DB access needed.
 */
export function isSalePriceActive(
  salePrice: number | null,
  salePriceUntil: string | null,
  saleQuantityLimit?: number | null,
  saleQuantitySold?: number | null
): boolean {
  if (!salePrice || salePrice <= 0) return false;
  if (salePriceUntil && new Date(salePriceUntil) <= new Date()) return false;

  if (saleQuantityLimit !== null && saleQuantityLimit !== undefined) {
    const sold = saleQuantitySold ?? 0;
    if (sold >= saleQuantityLimit) return false;
  }

  return true;
}

/**
 * Calculate effective price considering regular price, sale price, and coupon.
 * Promotions do NOT stack — chooses the most beneficial for the customer.
 * Pure function — no DB access needed.
 */
export function calculateEffectivePrice(
  price: number,
  salePrice: number | null,
  salePriceUntil: string | null,
  couponDiscount: number = 0,
  saleQuantityLimit?: number | null,
  saleQuantitySold?: number | null
): {
  effectivePrice: number;
  originalPrice: number;
  showStrikethrough: boolean;
  isUsingSalePrice: boolean;
  isUsingCoupon: boolean;
} {
  const activeSalePrice = isSalePriceActive(salePrice, salePriceUntil, saleQuantityLimit, saleQuantitySold)
    ? salePrice
    : null;

  const priceWithCoupon = couponDiscount > 0 ? price - couponDiscount : null;

  const prices = [
    { value: price, type: 'regular' },
    activeSalePrice ? { value: activeSalePrice, type: 'sale' } : null,
    priceWithCoupon ? { value: priceWithCoupon, type: 'coupon' } : null,
  ].filter((p): p is { value: number; type: string } => p !== null);

  const best = prices.reduce((min, p) => (p.value < min.value ? p : min));

  return {
    effectivePrice: best.value,
    originalPrice: price,
    showStrikethrough: best.value < price,
    isUsingSalePrice: best.type === 'sale',
    isUsingCoupon: best.type === 'coupon',
  };
}
