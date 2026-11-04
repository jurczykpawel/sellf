/**
 * Centralized pricing calculation hook for checkout
 * Single source of truth for all price calculations (frontend + backend)
 */

import { STRIPE_MINIMUM_AMOUNT } from '@/lib/constants';
import { fromMinorUnits, toMinorUnits } from '@/lib/currency/minor-units';
import { allocateCouponDiscount } from '@/lib/pricing/coupon-allocation';
import { buildCheckoutLineSpecs, computeLinePayableMinor } from '@/lib/services/checkout-line-items';

// Re-export for backward compatibility
export { STRIPE_MINIMUM_AMOUNT };

export interface BumpPricingItem {
  id?: string;
  price: number;
  selected: boolean;
  /** The bump product's own VAT settings (each line is taxed by its own product). */
  vatRate?: number | null;
  priceIncludesVat?: boolean | null;
  vatExempt?: boolean | null;
}

export interface PricingInput {
  baseProductId?: string;
  productPrice: number;
  quantity?: number;
  productCurrency: string;
  productVatRate?: number;
  priceIncludesVat?: boolean;
  vatExempt?: boolean;
  /** 'local' (default) computes VAT here; 'stripe_tax' leaves it to Stripe (nothing added). */
  taxMode?: 'local' | 'stripe_tax';
  customAmount?: number;
  /** @deprecated Use bumps[] instead for multi-bump support */
  bumpPrice?: number;
  /** @deprecated Use bumps[] instead for multi-bump support */
  bumpSelected?: boolean;
  /** Multi-bump: array of bump items with price and selection state. Takes precedence over bumpPrice/bumpSelected. */
  bumps?: BumpPricingItem[];
  coupon?: {
    discount_type: 'percentage' | 'fixed' | 'set_price';
    discount_value: number;
    code: string;
    exclude_order_bumps?: boolean;
    allowed_product_ids?: string[];
  } | null;
}

export interface PricingResult {
  /** The coupon discount was capped so the total meets the Stripe minimum charge. */
  minimumApplied: boolean;
  basePrice: number;
  bumpAmount: number;
  discountAmount: number;
  subtotal: number;
  totalGross: number;
  totalNet: number;
  vatAmount: number;
  /**
   * What the buyer pays including VAT. Equals totalGross for gross prices; for net
   * prices (priceIncludesVat=false) it is totalGross plus the VAT added at checkout.
   * Use this for any amount shown on the page or the pay button.
   */
  totalPayable: number;
  currency: string;
  vatRate: number;
  isPwyw: boolean;
  hasBump: boolean;
  hasDiscount: boolean;
  /** True when a coupon reduces the total to zero — skip Stripe, grant free access */
  isFreeWithCoupon: boolean;
}

/**
 * Pure function for calculating pricing - can be used server-side
 */
// IMPORTANT: The DB function process_stripe_payment_completion_with_bump performs only
// a lenient amount check when coupon_id_param IS NOT NULL (amount > 0 AND amount <= full price).
// It trusts that this function produced the correct discounted amount that ends up in the
// Stripe PaymentIntent. If you change the discount logic here, the DB will accept whatever
// amount Stripe reports — there is no exact re-validation server-side in the DB.
// If you introduce a significant change (new discount type, rounding strategy, minimum floor),
// update the DB function's amount validation block accordingly.
// See: supabase/migrations/20250103000000_features.sql → process_stripe_payment_completion_with_bump
export function calculatePricing(input: PricingInput): PricingResult {
  const {
    productPrice,
    productCurrency,
    productVatRate = 0,
    priceIncludesVat = false,
    baseProductId,
    customAmount,
    bumpPrice = 0,
    bumpSelected = false,
    bumps,
    coupon,
  } = input;

  // Determine base price (PWYW or regular)
  const isPwyw = customAmount !== undefined && customAmount > 0;
  const basePrice = isPwyw ? customAmount : productPrice;
  const selectedBumps: BumpPricingItem[] = bumps !== undefined
    ? bumps.filter((bump) => bump.selected)
    : bumpSelected ? [{ id: undefined, price: bumpPrice, selected: true }] : [];

  const allocation = allocateCouponDiscount({
    currency: productCurrency,
    items: [
      { kind: 'base', id: baseProductId, price: basePrice, quantity: input.quantity },
      ...selectedBumps.map((bump) => ({ kind: 'bump' as const, id: bump.id, price: bump.price })),
    ],
    baseProductId,
    coupon,
    applyMinimumFloor: true,
  });

  const bumpAmount = selectedBumps.reduce((sum, bump) => sum + bump.price, 0);
  const subtotal = allocation.subtotal;
  const discountAmount = allocation.discountAmount;
  const isFreeWithCoupon = allocation.isFree;
  const totalGross = allocation.total;

  // VAT per line, using the SAME spec builder the server uses for Stripe line items:
  // each line follows its own product's rate / gross-net flag / exemption.
  const lineSpecs = buildCheckoutLineSpecs({
    main: {
      id: baseProductId ?? 'main', name: '', currency: productCurrency,
      vatRate: productVatRate, priceIncludesVat, vatExempt: input.vatExempt,
    },
    mainPrice: basePrice / (input.quantity ?? 1),
    quantity: input.quantity,
    bumps: selectedBumps.map((bump, i) => ({
      product: {
        id: bump.id ?? `bump-${i}`, name: '', currency: productCurrency,
        // Bump without its own VAT data (undefined) follows the main product's settings.
        ...(bump.vatRate === undefined
          ? { vatRate: productVatRate, priceIncludesVat, vatExempt: input.vatExempt }
          : { vatRate: bump.vatRate, priceIncludesVat: bump.priceIncludesVat ?? undefined, vatExempt: bump.vatExempt ?? undefined }),
      },
      price: bump.price,
    })),
    coupon: coupon ?? null,
    taxMode: input.taxMode ?? 'local',
  }).specs;
  const vatRate = productVatRate || 0;
  const totalPayable = fromMinorUnits(lineSpecs.reduce((sum, spec) => sum + computeLinePayableMinor(spec), 0), productCurrency);
  const totalNet = lineSpecs.reduce((sum, spec) => {
    const unit = fromMinorUnits(spec.unitAmountMinor, productCurrency);
    return sum + (spec.vatRate && spec.priceIncludesVat ? unit / (1 + spec.vatRate / 100) : unit);
  }, 0);
  const vatAmount = totalPayable - totalNet;

  return {
    basePrice,
    bumpAmount,
    discountAmount,
    subtotal,
    totalGross,
    totalNet,
    vatAmount,
    totalPayable,
    currency: productCurrency,
    vatRate,
    isPwyw,
    hasBump: bumpAmount > 0,
    hasDiscount: discountAmount > 0,
    isFreeWithCoupon,
    minimumApplied: allocation.minimumApplied,
  };
}

/**
 * React hook wrapper for calculatePricing
 */
export function usePricing(input: PricingInput): PricingResult {
  return calculatePricing(input);
}

/**
 * Convert a display amount to Stripe minor units (cents; whole units for zero-decimal currencies like JPY).
 */
export function toStripeCents(amount: number, currency: string): number {
  return toMinorUnits(amount, currency);
}
