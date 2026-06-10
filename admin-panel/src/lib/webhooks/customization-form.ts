/**
 * Pure form-state → API-payload mapping for webhook payload customization.
 * Kept IO-free so it is unit-testable without the modal.
 */

/** Selectable top-level keys of the purchase.completed payload (PurchaseWebhookData). */
export const PAYLOAD_TOP_LEVEL_KEYS = [
  'customer', 'product', 'order', 'customFields', 'bumpProduct', 'bumpProducts', 'invoice', 'license', 'source',
] as const;

/** Placeholder tokens available in extra fields (display hint only). */
export const PLACEHOLDER_HINTS = [
  'email', 'first_name', 'last_name', 'amount', 'amount_major', 'currency',
  'product_name', 'product_slug', 'order_id', 'custom_<id>',
] as const;

export interface CustomizationFormState {
  payloadFieldsSelected: string[];
  extraFields: { key: string; value: string }[];
  headerRows: { key: string; value: string }[];
  deleteHeaders: boolean;
  hadHeaders: boolean;
}

export interface CustomizationPayload {
  custom_payload_fields: Record<string, string> | null;
  payload_field_selection: string[] | null;
  custom_headers?: Record<string, string> | null;
}

function rowsToMap(rows: { key: string; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of rows) {
    if (key.trim() !== '') out[key.trim()] = value;
  }
  return out;
}

export function buildCustomizationPayload(s: CustomizationFormState): CustomizationPayload {
  const allChecked = PAYLOAD_TOP_LEVEL_KEYS.every((k) => s.payloadFieldsSelected.includes(k));
  const payload_field_selection = allChecked ? null : [...s.payloadFieldsSelected];

  const extra = rowsToMap(s.extraFields);
  const custom_payload_fields = Object.keys(extra).length > 0 ? extra : null;

  const out: CustomizationPayload = { custom_payload_fields, payload_field_selection };

  const newHeaders = rowsToMap(s.headerRows);
  if (Object.keys(newHeaders).length > 0) {
    out.custom_headers = newHeaders;            // set / replace
  } else if (s.deleteHeaders && s.hadHeaders) {
    out.custom_headers = null;                  // clear
  }                                             // else: omit → unchanged
  return out;
}
