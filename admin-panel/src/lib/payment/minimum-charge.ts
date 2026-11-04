/**
 * Stripe minimum-charge rules shared by checkout, coupons and the coupon editor.
 * A paid total below the minimum is raised to it by allocateCouponDiscount (floor);
 * these helpers explain that to buyers and sellers and catch Stripe's own refusal.
 * @see src/lib/pricing/coupon-allocation.ts, src/lib/currency/minor-units.ts
 */
import { minimumChargeAmount, toMinorUnits } from '@/lib/currency/minor-units';

export type CouponDiscountType = 'percentage' | 'fixed' | 'set_price';

/** Stripe's refusal for a total under the minimum (code `amount_too_small`). */
export function isStripeAmountTooSmall(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'amount_too_small';
}

/** True when the coupon leaves this price paid but under the Stripe minimum (100% stays free). */
export function discountedBelowMinimum(price: number, currency: string, type: CouponDiscountType, value: number): boolean {
  const priceMinor = toMinorUnits(price, currency);
  if (priceMinor <= 0) return false;
  const valueMinor = toMinorUnits(value, currency);
  const finalMinor = type === 'percentage' ? priceMinor - Math.min(priceMinor, Math.round(priceMinor * (value / 100)))
    : type === 'fixed' ? Math.max(0, priceMinor - valueMinor)
      : Math.min(priceMinor, valueMinor);
  return finalMinor > 0 && finalMinor < toMinorUnits(minimumChargeAmount(currency), currency);
}

interface CouponScope { discount_type: CouponDiscountType; discount_value: number; currency?: string | null; allowed_product_ids?: string[] | null }
interface PricedProduct { id: string; name: string; price: number; currency: string }

/** Names of products where this coupon leaves a paid price under the Stripe minimum (shown to the seller as a warning). */
export function productsBelowMinimumWithCoupon(products: readonly PricedProduct[], coupon: CouponScope): string[] {
  const scope = coupon.allowed_product_ids ?? [];
  return products.filter(p => (scope.length === 0 || scope.includes(p.id))
    // Amount coupons apply only in their own currency.
    && (coupon.discount_type === 'percentage' || !coupon.currency || coupon.currency === p.currency)
    && discountedBelowMinimum(p.price, p.currency, coupon.discount_type, coupon.discount_value)).map(p => p.name);
}
