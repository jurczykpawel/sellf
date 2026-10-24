/** Shared checkout coupon normalization. @see app/api/coupons/verify/route.ts */
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}
