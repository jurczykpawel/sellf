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

/** An extra payload field row; `original` is the stored value, which may be any JSON type. */
export interface ExtraFieldRow {
  key: string;
  value: string;
  original?: unknown;
}

export interface CustomizationFormState {
  payloadFieldsSelected: string[];
  extraFields: ExtraFieldRow[];
  headerRows: { key: string; value: string }[];
  deleteHeaders: boolean;
  hadHeaders: boolean;
  /** Stored state when editing: parts left unchanged are omitted from the payload (kept as stored). */
  initial?: Pick<CustomizationFormState, 'payloadFieldsSelected' | 'extraFields'>;
}

export interface CustomizationPayload {
  custom_payload_fields?: Record<string, unknown> | null;
  payload_field_selection?: string[] | null;
  custom_headers?: Record<string, string> | null;
}

/** Text shown for a stored extra-field value; non-text JSON values are shown as JSON. */
export function extraFieldText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function extraFieldsToMap(rows: ExtraFieldRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, value, original } of rows) {
    if (key.trim() === '') continue;
    // An untouched non-text value keeps its stored JSON type.
    out[key.trim()] = original !== undefined && typeof original !== 'string' && value === extraFieldText(original) ? original : value;
  }
  return out;
}

const sameRows = (a: ExtraFieldRow[], b: ExtraFieldRow[]): boolean =>
  a.length === b.length && a.every((row, i) => row.key === b[i].key && row.value === b[i].value);

const sameSelection = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every(key => b.includes(key));

function rowsToMap(rows: { key: string; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of rows) {
    if (key.trim() !== '') out[key.trim()] = value;
  }
  return out;
}

export function buildCustomizationPayload(s: CustomizationFormState): CustomizationPayload {
  const out: CustomizationPayload = {};

  if (!s.initial || !sameSelection(s.payloadFieldsSelected, s.initial.payloadFieldsSelected)) {
    const allChecked = PAYLOAD_TOP_LEVEL_KEYS.every((k) => s.payloadFieldsSelected.includes(k));
    out.payload_field_selection = allChecked ? null : [...s.payloadFieldsSelected];
  }

  if (!s.initial || !sameRows(s.extraFields, s.initial.extraFields)) {
    const extra = extraFieldsToMap(s.extraFields);
    out.custom_payload_fields = Object.keys(extra).length > 0 ? extra : null;
  }

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
