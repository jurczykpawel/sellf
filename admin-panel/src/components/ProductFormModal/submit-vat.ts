import type { ProductFormData } from './types';

type VatSubmitInput = Pick<
  ProductFormData,
  'product_type' | 'price' | 'allow_custom_price' | 'recurring_price' | 'vat_rate' | 'price_includes_vat'
>;

/**
 * VAT-related fields sent when the product form is submitted.
 *
 * A subscription is a paid product: it keeps its VAT rate and gross/net choice like a
 * one-time product (its one-time `price` is hidden, so it is forced to 0). Only a
 * genuinely free product (price 0, not pay-what-you-want) cannot be "price includes VAT";
 * it keeps its stored rate, which the storefront does not display at price 0.
 */
export function resolveSubmitVatFields(
  formData: VatSubmitInput,
): Pick<ProductFormData, 'price' | 'vat_rate' | 'price_includes_vat'> {
  const isSubscription = formData.product_type === 'subscription';
  const isFree = !isSubscription && formData.price === 0 && !formData.allow_custom_price;
  return {
    price: isSubscription ? 0 : formData.price,
    vat_rate: formData.vat_rate ?? null,
    price_includes_vat: isFree ? false : formData.price_includes_vat,
  };
}
