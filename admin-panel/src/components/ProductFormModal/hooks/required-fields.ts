/**
 * Pure helpers for the wizard's required-field validation.
 *
 * The wizard surfaces five UX product types via `ux_product_type` on the
 * form. Price requirements differ per type:
 *  - standard      → priceDisplayValue non-empty AND price > 0
 *  - subscription  → recurring_price > 0 (price input is hidden)
 *  - tip-jar       → PWYW; no price required (suggested amounts are optional)
 *  - lead-magnet   → free by design; no price required
 *
 * `collectRequiredFieldErrors` returns ALL required-field errors (used at
 * submit time). `collectStep1FieldErrors` returns only step-1 fields, which
 * the wizard's "Dalej" button uses so it doesn't surface description errors
 * (description lives on step 2).
 */

import type { TaxMode } from '@/lib/actions/shop-config';
import type { UxProductType } from '@/lib/product-defaults';

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
  ux_product_type?: UxProductType;
}

function collectPriceErrors(
  formData: FormDataForValidation,
  priceDisplayValue: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const uxType = formData.ux_product_type;
  const isSubscription = uxType === 'subscription' || formData.product_type === 'subscription';

  if (isSubscription) {
    if (formData.recurring_price == null || Number(formData.recurring_price) <= 0) {
      errors.recurring_price = 'required';
    }
    return errors;
  }

  if (uxType === 'tip-jar' || uxType === 'lead-magnet') {
    return errors;
  }

  // standard (or unspecified ux_product_type — preserves legacy behavior)
  if (priceDisplayValue === '' || formData.price <= 0) {
    errors.price = 'required';
  }
  return errors;
}

function collectVatErrors(formData: FormDataForValidation, taxMode: TaxMode | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  const isSubscription = formData.ux_product_type === 'subscription' || formData.product_type === 'subscription';
  const isPaid = isSubscription
    ? (formData.recurring_price ?? 0) > 0
    : formData.price > 0 || formData.allow_custom_price;

  if (taxMode === 'local' && isPaid && formData.price_includes_vat && formData.vat_rate == null) {
    errors.vat_rate = 'required';
  }
  return errors;
}

export function collectStep1FieldErrors(
  formData: FormDataForValidation,
  priceDisplayValue: string,
  taxMode: TaxMode | undefined,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!formData.name?.trim()) errors.name = 'required';
  if (!formData.slug?.trim()) errors.slug = 'required';
  Object.assign(errors, collectPriceErrors(formData, priceDisplayValue));
  Object.assign(errors, collectVatErrors(formData, taxMode));
  return errors;
}

export function collectRequiredFieldErrors(
  formData: FormDataForValidation,
  priceDisplayValue: string,
  taxMode: TaxMode | undefined,
): Record<string, string> {
  const errors = collectStep1FieldErrors(formData, priceDisplayValue, taxMode);
  if (!formData.description?.trim()) errors.description = 'required';
  return errors;
}
