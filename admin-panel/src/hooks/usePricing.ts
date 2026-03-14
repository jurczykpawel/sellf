/**
 * Centralized pricing calculation hook for checkout
 * Single source of truth for all price calculations (frontend + backend)
 */

import { STRIPE_MINIMUM_AMOUNT } from '@/lib/constants';

// Re-export for backward compatibility
export { STRIPE_MINIMUM_AMOUNT };

export interface BumpPricingItem {
  price: number;
  selected: boolean;
}

export interface PricingInput {
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
    customAmount,
    bumpPrice = 0,
    bumpSelected = false,
    bumps,
    coupon,
  } = input;

  // Determine base price (PWYW or regular)
  const isPwyw = customAmount !== undefined && customAmount > 0;
  const basePrice = isPwyw ? customAmount : productPrice;

  // Calculate bump amount: bumps[] takes precedence over legacy bumpPrice/bumpSelected
  let bumpAmount: number;
  if (bumps !== undefined) {
    bumpAmount = bumps.reduce((sum, b) => sum + (b.selected ? b.price : 0), 0);
  } else {
    bumpAmount = bumpSelected ? bumpPrice : 0;
  }
  const subtotal = basePrice + bumpAmount;

  // Apply coupon discount
  // If exclude_order_bumps is true, discount applies only to basePrice (not bump)
  let discountAmount = 0;
  if (coupon) {
    const discountBase = coupon.exclude_order_bumps ? basePrice : subtotal;
    if (coupon.discount_type === 'percentage') {
      discountAmount = discountBase * (coupon.discount_value / 100);
    } else {
      discountAmount = Math.min(coupon.discount_value, discountBase);
    }
  }

  // Calculate totals
  // When a coupon covers the full price, total is genuinely $0 — don't floor to Stripe minimum
  const rawTotal = subtotal - discountAmount;
  const isFreeWithCoupon = coupon !== null && coupon !== undefined && rawTotal <= 0;
  const totalGross = isFreeWithCoupon ? 0 : Math.max(rawTotal, STRIPE_MINIMUM_AMOUNT);

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
