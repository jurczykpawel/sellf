/**
 * Per-code throttle for coupon checks, shared by the storefront verify route and the
 * embed checkout. Only rejected codes spend the budget: a valid code re-checked on
 * every page load never locks a buyer out (W148-11), while probing one code (guesses,
 * other e-mails) stays limited. The per-client limit of each caller still caps every attempt.
 *
 * @see src/app/api/coupons/verify/route.ts
 * @see src/app/api/embed/checkout-session/route.ts
 */
import { checkRateLimitForIdentifier, getRateLimitIdentifier } from '@/lib/rate-limiting';
import { normalizeCouponCode } from '@/lib/coupons/normalize-code';

export const COUPON_REJECTED_CODE = 'COUPON_REJECTED';

/** Records one rejected attempt on `code`; false when this client spent its budget for it. */
export async function recordRejectedCouponAttempt(code: string): Promise<boolean> {
  return checkRateLimitForIdentifier(
    'coupon_verify_code',
    5,
    60,
    `code:${normalizeCouponCode(code)}:${await getRateLimitIdentifier()}`,
  );
}
