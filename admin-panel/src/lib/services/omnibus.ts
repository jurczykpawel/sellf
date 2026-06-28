/**
 * Omnibus Directive (EU 2019/2161) Service
 * Implements 30-day price history tracking for discount transparency
 *
 * All data-fetching functions require an explicit Supabase client parameter (DRY).
 */

// ===== TYPES =====

type PriceEntry = {
  price: string;
  sale_price: string | null;
  currency: string;
  effective_from: string;
};

// ===== PURE LOGIC =====

/**
 * Select the Omnibus "prior price" reference from a product's 30-day price
 * history: the lowest price applied in the 30 days BEFORE the current reduction.
 *
 * The current reduction is the most recent price period (max `effective_from`).
 * Its `sale_price` is the discount being announced now and is EXCLUDED — only
 * its regular `price` counts as a reference. Without this exclusion the "lowest
 * price" always collapses to the current sale price (by definition the lowest),
 * which is meaningless and breaches the directive.
 *
 * Past periods contribute the price that genuinely applied (the lower of their
 * regular and sale price). Keying the current period by `effective_from === max`
 * (rather than by array position) means rows sharing the current timestamp — e.g.
 * an initial insert and a sale applied in the same DB transaction — all have
 * their sale excluded, so the edge can't reintroduce the bug. Input ordering is
 * irrelevant; the function derives the current period itself.
 *
 * The history passed in is already constrained to the last 30 days by the caller.
 * Pure function — no DB access needed.
 */
export function selectLowestPriorPrice(
  history: PriceEntry[],
): { lowestPrice: number; currency: string; effectiveFrom: Date } | null {
  if (!history || history.length === 0) {
    return null;
  }

  // The current reduction = the most recent price period.
  const currentFrom = history.reduce(
    (max, entry) =>
      new Date(entry.effective_from).getTime() > new Date(max).getTime()
        ? entry.effective_from
        : max,
    history[0].effective_from,
  );

  const effectivePriceOf = (entry: PriceEntry): number => {
    const regular = parseFloat(entry.price);
    // Current period: exclude the announced sale, reference only the regular price.
    if (entry.effective_from === currentFrom) {
      return regular;
    }
    // Past periods: the price that genuinely applied (incl. any past sale).
    return entry.sale_price
      ? Math.min(regular, parseFloat(entry.sale_price))
      : regular;
  };

  let bestEntry = history[0];
  let bestPrice = effectivePriceOf(history[0]);
  for (const entry of history) {
    const price = effectivePriceOf(entry);
    if (price < bestPrice) {
      bestPrice = price;
      bestEntry = entry;
    }
  }

  return {
    lowestPrice: bestPrice,
    currency: bestEntry.currency,
    effectiveFrom: new Date(bestEntry.effective_from),
  };
}

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

  // Query the public Omnibus surface — narrowed projection over
  // public.product_price_history limited to active+listed products.
  const { data: history, error } = await client
    .from('omnibus_price_history')
    .select('price, sale_price, currency, effective_from')
    .eq('product_id', productId)
    .gte('effective_from', thirtyDaysAgo.toISOString())
    .order('effective_from', { ascending: false });

  if (error || !history || history.length === 0) {
    return null;
  }

  // The lowest price in the 30 days BEFORE the current reduction (Omnibus): the
  // currently-announced sale is excluded so it can't become its own reference.
  return selectLowestPriorPrice(history);
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
 * Resolve the unit price a buyer should actually be charged: the active sale
 * price when a sale is running, otherwise the regular catalog price.
 *
 * This is the single source of truth shared by every charge layer (checkout
 * session line items, payment-intent totals, client cart total) so the price
 * shown, the price charged, and the price the DB validates can never diverge.
 * Pure function — no DB access needed.
 */
export function getEffectiveUnitPrice(product: {
  price: number;
  sale_price?: number | null;
  sale_price_until?: string | null;
  sale_quantity_limit?: number | null;
  sale_quantity_sold?: number | null;
}): number {
  return isSalePriceActive(
    product.sale_price ?? null,
    product.sale_price_until ?? null,
    product.sale_quantity_limit ?? null,
    product.sale_quantity_sold ?? null,
  )
    ? (product.sale_price as number)
    : product.price;
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
