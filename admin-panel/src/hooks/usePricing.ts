/**
 * Centralized pricing calculation hook for checkout
 * Single source of truth for all price calculations (frontend + backend)
 */

export const STRIPE_MINIMUM_AMOUNT = 0.50;

export interface PricingInput {
  productPrice: number;
  productCurrency: string;
  productVatRate?: number;
  priceIncludesVat?: boolean;
  customAmount?: number;
  bumpPrice?: number;
  bumpSelected?: boolean;
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
    coupon,
  } = input;

  // Determine base price (PWYW or regular)
  const isPwyw = customAmount !== undefined && customAmount > 0;
  const basePrice = isPwyw ? customAmount : productPrice;

  // Add bump if selected
  const bumpAmount = bumpSelected ? bumpPrice : 0;
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
  const totalGross = Math.max(subtotal - discountAmount, STRIPE_MINIMUM_AMOUNT);

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
    hasBump: bumpSelected && bumpPrice > 0,
    hasDiscount: discountAmount > 0,
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
