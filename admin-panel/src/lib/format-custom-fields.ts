/**
 * Resolve the JSONB `custom_field_values` on a transaction (or webhook payload)
 * against the product's `custom_checkout_fields` definitions so consumers (admin
 * UI, API responses, webhooks) can render label + value without re-implementing
 * the lookup each time.
 *
 * Drops values for unknown ids (backwards-compat when a seller removed a field
 * after the sale) and empty / whitespace-only values. Returned order follows
 * the definitions array, not the JSONB key order.
 */

import type { CustomFieldDefinition, CustomFieldType } from '@/lib/validations/custom-checkout-fields';

export interface DisplayCustomField {
  id: string;
  label: string;
  value: string;
  type: CustomFieldType;
}

function resolveLabel(label: CustomFieldDefinition['label'], locale: string): string {
  if (typeof label === 'string') return label;
  if (locale.startsWith('pl')) return label.pl || label.en;
  return label.en || label.pl;
}

export function formatCustomFieldsForDisplay(
  values: Record<string, unknown> | null | undefined,
  definitions: CustomFieldDefinition[] | null | undefined,
  locale: string,
): DisplayCustomField[] {
  if (!values || !definitions || definitions.length === 0) return [];

  const result: DisplayCustomField[] = [];
  for (const def of definitions) {
    const raw = values[def.id];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (value.length === 0) continue;

    result.push({
      id: def.id,
      label: resolveLabel(def.label, locale),
      value,
      type: def.type,
    });
  }
  return result;
}
