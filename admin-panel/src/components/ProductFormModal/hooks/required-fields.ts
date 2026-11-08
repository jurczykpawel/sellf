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

import { moneyAmountError } from '@/lib/currency/parse-money-input';
import { minimumChargeAmount } from '@/lib/currency/minor-units';
import { licenseDurationError, validateName, validateSlug, validatePrice, isValidLicenseTier, hasInvalidPricePresets } from '@/lib/validations/product';
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
  currency?: string;
  custom_price_min?: number | null;
  ux_product_type?: UxProductType;
  issue_license_on_purchase?: boolean;
  license_duration_days?: number | null;
  license_tier?: string | null;
  trial_days?: number | null;
  show_price_presets?: boolean;
  custom_price_presets?: number[];
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
    } else if (!validatePrice(formData.recurring_price).isValid || moneyAmountError(Number(formData.recurring_price), formData.currency ?? '')) {
      errors.recurring_price = 'invalid';
    }
    return errors;
  }

  if (formData.allow_custom_price || uxType === 'tip-jar' || uxType === 'lead-magnet') {
    if (formData.allow_custom_price && moneyAmountError(formData.custom_price_min, formData.currency ?? '')) {
      errors.custom_price_min = 'invalid';
    }
    return errors;
  }

  // standard (or unspecified ux_product_type — preserves legacy behavior)
  if (priceDisplayValue === '' || formData.price <= 0) {
    errors.price = 'required';
  } else if (!validatePrice(formData.price).isValid) {
    errors.price = 'invalid';
  } else if (formData.price < minimumChargeAmount(formData.currency ?? '')) {
    errors.price = 'below_minimum';
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
  else if (!validateName(formData.name).isValid) errors.name = 'invalid';
  if (!formData.slug?.trim()) errors.slug = 'required';
  else if (!validateSlug(formData.slug).isValid) errors.slug = 'invalid';
  if (formData.product_type === 'subscription' && formData.trial_days != null && (!Number.isInteger(formData.trial_days) || formData.trial_days < 0 || formData.trial_days > 730)) errors.trial_days = 'invalid';
  if (hasInvalidPricePresets({ ...formData })) errors.custom_price_presets = 'invalid';
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
  if (formData.issue_license_on_purchase && !isValidLicenseTier(formData.license_tier)) errors.license_tier = 'invalid';
  if (formData.issue_license_on_purchase && licenseDurationError(formData.license_duration_days)) errors.license_duration_days = 'license_duration';
  return errors;
}

/** Field codes for API validation details (`{ field: string[] }`), so a server rejection shows at the field. */
function serverFieldCode(field: string, messages: string[]): string {
  if (field === 'license_duration_days') return 'license_duration';
  return field === 'price' && messages.some(message => /at least|minimum/i.test(message)) ? 'below_minimum' : 'invalid';
}
export function serverFieldErrors(details: Record<string, string[]> | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  const fields = ['name', 'slug', 'price', 'recurring_price', 'trial_days', 'license_tier', 'license_duration_days', 'custom_price_presets'];
  for (const key of fields) if (details?.[key]) errors[key] = serverFieldCode(key, details[key]);
  for (const message of details?._errors ?? []) {
    const field = fields.find(key => message.toLowerCase().startsWith(key));
    if (field) errors[field] = serverFieldCode(field, [message]);
  }
  return errors;
}
