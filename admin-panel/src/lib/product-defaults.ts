import type { ProductFormData } from '@/components/ProductFormModal/types';
import { getTipJarDefaultCustomFields } from '@/lib/checkout-templates/tip-jar';

export type UxProductType =
  | 'standard'
  | 'subscription'
  | 'installments'
  | 'tip-jar'
  | 'lead-magnet';

export const UX_PRODUCT_TYPES_AVAILABLE: ReadonlyArray<UxProductType> = [
  'standard',
  'subscription',
  'tip-jar',
  'lead-magnet',
];

export const UX_PRODUCT_TYPES_DISABLED: ReadonlyArray<UxProductType> = ['installments'];

type FormForInference = Pick<
  ProductFormData,
  'checkout_template' | 'product_type' | 'allow_custom_price' | 'price'
>;

export function applyProductTypeDefaults(
  prev: ProductFormData,
  type: UxProductType,
): ProductFormData {
  switch (type) {
    case 'standard':
      return {
        ...prev,
        checkout_template: 'default',
        product_type: 'one_time',
        allow_custom_price: false,
        billing_interval: null,
        billing_interval_count: null,
        recurring_price: null,
        trial_days: null,
      };
    case 'subscription':
      return {
        ...prev,
        checkout_template: 'default',
        product_type: 'subscription',
        allow_custom_price: false,
        billing_interval: prev.billing_interval ?? 'month',
        billing_interval_count: prev.billing_interval_count ?? 1,
        trial_days: prev.trial_days ?? null,
      };
    case 'tip-jar':
      return {
        ...prev,
        checkout_template: 'tip-jar',
        product_type: 'one_time',
        allow_custom_price: true,
        billing_interval: null,
        billing_interval_count: null,
        recurring_price: null,
        custom_checkout_fields:
          prev.custom_checkout_fields.length === 0
            ? getTipJarDefaultCustomFields()
            : prev.custom_checkout_fields,
      };
    case 'lead-magnet':
      return {
        ...prev,
        checkout_template: 'default',
        product_type: 'one_time',
        allow_custom_price: false,
        price: 0,
        recurring_price: null,
        billing_interval: null,
        billing_interval_count: null,
      };
    case 'installments':
      return prev;
  }
}

export function inferProductTypeFromForm(formData: FormForInference): UxProductType {
  if (formData.checkout_template === 'tip-jar') return 'tip-jar';
  if (formData.product_type === 'subscription') return 'subscription';
  if (formData.price === 0 && !formData.allow_custom_price) return 'lead-magnet';
  return 'standard';
}
