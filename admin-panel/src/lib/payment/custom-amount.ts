import { STRIPE_MAX_AMOUNT } from '@/lib/constants';
import { currencyExponent, minimumChargeAmount } from '@/lib/currency/minor-units';

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
  const minPrice = product.custom_price_min ?? minimumChargeAmount(product.currency);
  if (amount < minPrice) {
    return { ok: false, error: `Amount must be at least ${minPrice} ${product.currency}` };
  }
  if (amount > STRIPE_MAX_AMOUNT) {
    return { ok: false, error: `Amount must be no more than ${STRIPE_MAX_AMOUNT} ${product.currency}` };
  }
  return { ok: true };
}

/** Parse a buyer-entered display amount without rounding fractional digits. */
export function parseCustomAmountInput(raw: string, currency: string): number | null {
  const text = raw.trim();
  const pattern = currencyExponent(currency) === 0 ? /^\d+$/ : /^\d+(?:[.,]\d{0,2})?$/;
  if (!pattern.test(text)) return null;
  const amount = Number(text.replace(',', '.'));
  return Number.isFinite(amount) ? amount : null;
}

/** Display only amounts that can be selected for this product and currency. */
export function getPayablePricePresets(product: CustomAmountProductLike & { custom_price_presets?: number[] | null }): number[] {
  const minimum = product.custom_price_min ?? minimumChargeAmount(product.currency);
  return (product.custom_price_presets ?? []).filter(amount =>
    amount === 0 ? minimum === 0 : Number.isFinite(amount)
      && amount >= Math.max(minimum, minimumChargeAmount(product.currency))
      && amount <= STRIPE_MAX_AMOUNT
      && parseCustomAmountInput(String(amount), product.currency) !== null);
}
