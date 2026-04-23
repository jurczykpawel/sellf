/**
 * Centralized pricing calculation hook for checkout
 * Single source of truth for all price calculations (frontend + backend)
 */

import { STRIPE_MINIMUM_AMOUNT } from '@/lib/constants';
import { allocateCouponDiscount } from '@/lib/pricing/coupon-allocation';

// Re-export for backward compatibility
export { STRIPE_MINIMUM_AMOUNT };

export interface BumpPricingItem {
  id?: string;
  price: number;
  selected: boolean;
}

export interface PricingInput {
  baseProductId?: string;
  productPrice: number;
  productCurrency: string;
  productVatRate?: number;
  priceIncludesVat?: boolean;
  customAmount?: number;
  /** @deprecated Use bumps[] instead for multi-bump support */
  bumpPrice?: number;
  /** @deprecated Use bumps[] instead for multi-bump support */
  bumpSelected?: boolean;
  /** Multi-bump: array of bump items with price and selection state. Takes precedence over bumpPrice/bumpSelected. */
  bumps?: BumpPricingItem[];
  coupon?: {
    discount_type: 'percentage' | 'fixed';
    discount_value: number;
    code: string;
    exclude_order_bumps?: boolean;
    allowed_product_ids?: string[];
  } | null;
}

export interface PricingResult {
  basePrice: number;
  bumpAmount: number;
  discountAmount: number;
  subtotal: number;
  totalGross: number;
  totalNet: number;
  vatAmount: number;
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
    items: [
      { kind: 'base', id: baseProductId, price: basePrice },
      ...selectedBumps.map((bump) => ({ kind: 'bump' as const, id: bump.id, price: bump.price })),
    ],
    baseProductId,
    coupon,
    applyMinimumFloor: true,
    minimumAmount: STRIPE_MINIMUM_AMOUNT,
  });

  const bumpAmount = selectedBumps.reduce((sum, bump) => sum + bump.price, 0);
  const subtotal = allocation.subtotal;
  const discountAmount = allocation.discountAmount;
  const isFreeWithCoupon = allocation.isFree;
  const totalGross = allocation.total;

  // VAT calculation
  const vatRate = productVatRate || 0;
  const totalNet = priceIncludesVat && vatRate > 0
    ? totalGross / (1 + vatRate / 100)
    : totalGross;
  const vatAmount = totalGross - totalNet;

  return {
    basePrice,
    bumpAmount,
    discountAmount,
    subtotal,
    totalGross,
    totalNet,
    vatAmount,
    currency: productCurrency,
    vatRate,
    isPwyw,
    hasBump: bumpAmount > 0,
    hasDiscount: discountAmount > 0,
    isFreeWithCoupon,
  };
}

/**
 * React hook wrapper for calculatePricing
 */
export function usePricing(input: PricingInput): PricingResult {
  return calculatePricing(input);
}

/**
 * Convert amount to Stripe cents
 */
export function toStripeCents(amount: number): number {
  return Math.round(amount * 100);
}
