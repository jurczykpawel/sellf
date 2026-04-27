import { STRIPE_MAX_AMOUNT, STRIPE_MINIMUM_AMOUNT } from '@/lib/constants';

export type CustomAmountValidation =
  | { ok: true }
  | { ok: false; error: string };

interface CustomAmountProductLike {
  allow_custom_price?: boolean | null;
  custom_price_min?: number | null;
  currency: string;
}

/**
 * Single source of truth for "is this customAmount acceptable for this product?".
 * Called from /api/create-payment-intent and CheckoutService.createCheckoutSession.
 */
export function validateCustomAmount(
  amount: unknown,
  product: CustomAmountProductLike
): CustomAmountValidation {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return { ok: false, error: 'Custom amount must be a valid number' };
  }
  if (amount <= 0) {
    return { ok: false, error: 'Custom amount must be a positive number' };
  }
  if (!product.allow_custom_price) {
    return { ok: false, error: 'This product does not allow custom pricing' };
  }
  const minPrice = product.custom_price_min ?? STRIPE_MINIMUM_AMOUNT;
  if (amount < minPrice) {
    return { ok: false, error: `Amount must be at least ${minPrice} ${product.currency}` };
  }
  if (amount > STRIPE_MAX_AMOUNT) {
    return { ok: false, error: `Amount must be no more than ${STRIPE_MAX_AMOUNT} ${product.currency}` };
  }
  return { ok: true };
}
