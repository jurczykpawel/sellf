/**
  * pure helper for the wizard's required-field validation.
 *
 * Subscription products use `recurring_price` instead of the one-time `price`
 * field. The form hides the one-time input entirely, so requiring it would
 * deadlock submission.
 */

import type { TaxMode } from '@/lib/actions/shop-config';

interface FormDataForValidation {
  name: string;
  slug: string;
  description: string;
  price: number;
  vat_rate?: number | null;
  price_includes_vat: boolean;
  allow_custom_price: boolean;
  product_type?: 'one_time' | 'subscription';
  recurring_price?: number | null;
}

export function collectRequiredFieldErrors(
  formData: FormDataForValidation,
  priceDisplayValue: string,
  taxMode: TaxMode | undefined
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!formData.name?.trim()) errors.name = 'required';
  if (!formData.slug?.trim()) errors.slug = 'required';
  if (!formData.description?.trim()) errors.description = 'required';

  const isSubscription = formData.product_type === 'subscription';

  if (isSubscription) {
    if (formData.recurring_price == null || Number(formData.recurring_price) <= 0) {
      errors.recurring_price = 'required';
    }
  } else {
    if (priceDisplayValue === '') errors.price = 'required';
  }

  // Local tax mode: VAT rate is required when no shop default is set, for any
  // paid product. For subscriptions this means the recurring price > 0.
  const isPaid = isSubscription
    ? (formData.recurring_price ?? 0) > 0
    : formData.price > 0 || formData.allow_custom_price;

  if (taxMode === 'local' && isPaid && formData.price_includes_vat && formData.vat_rate == null) {
    errors.vat_rate = 'required';
  }

  return errors;
}
