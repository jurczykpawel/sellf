import { formatPrice } from '@/lib/constants';
import { formatRecurringProductPrice } from '@/lib/product-pricing-display';
import type { ProductFormData } from '../types';

export interface HeaderPriceBadge {
  label: string;
  free: boolean;
}

export function headerPriceBadge(
  formData: Pick<
    ProductFormData,
    'price' | 'currency' | 'product_type' | 'recurring_price' | 'billing_interval' | 'billing_interval_count' | 'allow_custom_price'
  >,
  priceDisplayValue: string,
  freeLabel: string,
  locale: string,
): HeaderPriceBadge | null {
  if (formData.product_type === 'subscription') {
    const label = formatRecurringProductPrice(formData, locale);
    return label ? { label, free: false } : null;
  }
  if (priceDisplayValue === '' && formData.price === 0) return null;
  if (formData.price === 0) return formData.allow_custom_price ? null : { label: freeLabel, free: true };
  return { label: formatPrice(formData.price, formData.currency, locale), free: false };
}
