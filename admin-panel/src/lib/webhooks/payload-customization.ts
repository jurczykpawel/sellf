/**
 * Pure (no IO) helpers that shape a webhook body per endpoint:
 * field selection over the standard `data` object, and extra top-level fields
 * with {{placeholder}} substitution. Substitution happens only at JSON string
 * leaves, so a field value can never break out of its position.
 */

export type PlaceholderContext = Record<string, string>;

export interface PayloadCustomization {
  payload_field_selection?: string[] | null;
  custom_payload_fields?: Record<string, unknown> | null;
}

/**
 * Top-level keys of the outbound envelope (see `buildEndpointBody`). A seller-defined
 * custom field sharing one of these names must never be able to replace the real
 * value — `buildEndpointBody` drops colliding custom fields, and
 * `validateCustomPayloadFields` (lib/validations/webhook.ts) rejects them at save time.
 */
export const RESERVED_ENVELOPE_KEYS = ['id', 'event', 'timestamp', 'data'] as const;

/** Keep only whitelisted keys of `data`; null selection = identity. */
export function selectDataFields(
  data: Record<string, unknown>,
  selection: string[] | null | undefined,
): Record<string, unknown> {
  if (!selection) return data;
  const allowed = new Set(selection);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}

/** Resolve {{key}} tokens in string leaves from ctx; unknown -> ''. Recurses objects/arrays. */
export function renderTemplate(fields: unknown, ctx: PlaceholderContext): unknown {
  if (typeof fields === 'string') {
    return fields.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => ctx[key] ?? '');
  }
  if (Array.isArray(fields)) return fields.map((f) => renderTemplate(f, ctx));
  if (fields && typeof fields === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
      out[k] = renderTemplate(v, ctx);
    }
    return out;
  }
  return fields;
}

/** Compose the per-endpoint body: envelope with selected data + rendered extra fields. */
export function buildEndpointBody(
  baseEnvelope: { event: string; timestamp: string; data: Record<string, unknown> },
  customization: PayloadCustomization,
  ctx: PlaceholderContext,
): Record<string, unknown> {
  const data = selectDataFields(baseEnvelope.data, customization.payload_field_selection);
  const rendered = customization.custom_payload_fields
    ? (renderTemplate(customization.custom_payload_fields, ctx) as Record<string, unknown>)
    : {};
  // Reserved keys are also rejected at save time (validateCustomPayloadFields);
  // here the real envelope value always wins, so a
  // field saved before that check existed (or written directly in the DB) can never
  // silently replace the event type, timestamp, or data object.
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rendered)) {
    if ((RESERVED_ENVELOPE_KEYS as readonly string[]).includes(key)) continue;
    extra[key] = value;
  }
  return { event: baseEnvelope.event, timestamp: baseEnvelope.timestamp, data, ...extra };
}
