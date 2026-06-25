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
 * submit time). Description is intentionally optional.
 */

import type { TaxMode } from '@/lib/actions/shop-config';
import type { UxProductType } from '@/lib/product-defaults';

interface FormDataForValidation {
  name: string;
  slug: string;
  description: string;
  price: number;
  vat_rate?: number | null;
  vat_exempt?: boolean;
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

  if (formData.allow_custom_price || uxType === 'tip-jar' || uxType === 'lead-magnet') {
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

  // "Zwolniony z VAT (zw.)" means no VAT at all — a rate is not applicable, so don't require one.
  if (taxMode === 'local' && isPaid && !formData.vat_exempt && formData.price_includes_vat && formData.vat_rate == null) {
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
  return collectStep1FieldErrors(formData, priceDisplayValue, taxMode);
}
