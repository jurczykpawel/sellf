/**
 * Pure form-state → API-payload mapping for webhook payload customization.
 * Kept IO-free so it is unit-testable without the modal.
 */

/** Selectable top-level keys of the purchase.completed payload (PurchaseWebhookData). */
export const PAYLOAD_TOP_LEVEL_KEYS = [
  'customer', 'product', 'order', 'orderDetails', 'customFields', 'bumpProduct', 'bumpProducts', 'bundleComponents', 'invoice', 'licenses', 'source',
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

export function isValidCustomHeader(name: string, value: unknown): boolean {
  return name.length <= 64 && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
    && !name.toLowerCase().startsWith('x-sellf-')
    && !['host','content-type','content-length','content-encoding','connection','transfer-encoding','te','trailer','upgrade','expect'].includes(name.toLowerCase())
    && typeof value === 'string' && value.length <= 2048 && /^[\t\x20-\x7e\x80-\xff]*$/.test(value);
}

export function validateCustomHeaderRows(rows: { key: string; value: unknown }[]): boolean {
  const names = new Set<string>();
  return rows.length <= 20 && rows.every(({ key, value }) => {
    const name = key.toLowerCase();
    if (names.has(name) || !isValidCustomHeader(key, value)) return false;
    names.add(name);
    return true;
  });
}

export function validateCustomHeaders(headers: unknown): boolean {
  return headers == null || (typeof headers === 'object' && !Array.isArray(headers)
    && validateCustomHeaderRows(Object.entries(headers).map(([key, value]) => ({ key, value }))));
}

export const WEBHOOK_URL_REASONS = [
  'https_required',
  'localhost',
  'internal_service',
  'private_ip',
  'loopback',
  'link_local',
  'unspecified',
  'reserved_ipv4',
  'ipv4_mapped_ipv6',
  'private_ipv6',
  'invalid_format',
  'unresolvable',
  'no_dns_records',
  'resolves_private',
] as const;

export type WebhookUrlReason = typeof WEBHOOK_URL_REASONS[number];
