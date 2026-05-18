// Custom checkout fields — product-level concept usable by ANY checkout
// template (default + tip-jar + future Pro/Embed/etc.). Admin defines the
// shape per product; buyer fills values at /checkout/<slug>; server validates
// values against the product's definitions before creating the payment
// intent / subscription.
//
// Hard caps below exist for DoS protection (huge JSONB blobs would slow
// indexing + writes). They are the single source of truth — DB has no
// per-row size check, the API is the gate.

const FIELD_ID_PATTERN = /^[a-z0-9_-]+$/;
const PLACEHOLDER_MAX = 200;

export const CUSTOM_FIELD_MAX_PER_PRODUCT = 10;
export const CUSTOM_FIELD_MAX_VALUE_LENGTH = 500;
export const CUSTOM_FIELDS_VALUES_MAX_BYTES = 5_000;

export type CustomFieldType = 'text' | 'textarea' | 'email';

// Forward-compat: label as string today, dict {en,pl} later when we add
// multi-language support. Walidator handles both shapes from day one so the
// migration to multi-lang is purely additive on the admin UI side.
export type CustomFieldLabel = string | { en: string; pl: string };

export interface CustomFieldDefinition {
  id: string;
  type: CustomFieldType;
  label: CustomFieldLabel;
  required: boolean;
  max_length: number;
  placeholder?: string;
}

export type CustomFieldValues = Record<string, string>;

export type DefinitionsResult =
  | { ok: true; value: CustomFieldDefinition[] }
  | { ok: false; errors: Record<string, string> };

export type ValuesResult =
  | { ok: true; values: CustomFieldValues }
  | { ok: false; errors: Record<string, string> };

const ALLOWED_TYPES: ReadonlySet<CustomFieldType> = new Set(['text', 'textarea', 'email']);

// RFC-5322 lite: enough to reject obvious garbage without locking out odd-but-valid
// TLDs. Server is not the final gate (no SMTP probe here) — Stripe / outbound mail
// will catch the rest.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidLabel(label: unknown): label is CustomFieldLabel {
  if (typeof label === 'string') return label.trim().length > 0;
  if (label && typeof label === 'object') {
    const obj = label as Record<string, unknown>;
    return (
      typeof obj.en === 'string'
      && typeof obj.pl === 'string'
      && obj.en.trim().length > 0
      && obj.pl.trim().length > 0
    );
  }
  return false;
}

export function validateCustomFieldDefinitions(defs: unknown): DefinitionsResult {
  if (!Array.isArray(defs)) {
    return { ok: false, errors: { _: 'Definitions must be an array' } };
  }
  if (defs.length > CUSTOM_FIELD_MAX_PER_PRODUCT) {
    return {
      ok: false,
      errors: { _: `Too many fields (max ${CUSTOM_FIELD_MAX_PER_PRODUCT})` },
    };
  }

  const errors: Record<string, string> = {};
  const seenIds = new Set<string>();
  const out: CustomFieldDefinition[] = [];

  defs.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      errors[String(index)] = 'Field definition must be an object';
      return;
    }
    const f = raw as Record<string, unknown>;

    if (typeof f.id !== 'string' || !FIELD_ID_PATTERN.test(f.id)) {
      errors[String(index)] = 'Invalid id (use [a-z0-9_-])';
      return;
    }
    if (seenIds.has(f.id)) {
      errors[String(index)] = `Duplicate id "${f.id}"`;
      return;
    }
    seenIds.add(f.id);

    if (typeof f.type !== 'string' || !ALLOWED_TYPES.has(f.type as CustomFieldType)) {
      errors[String(index)] = `Invalid type (allowed: ${[...ALLOWED_TYPES].join(', ')})`;
      return;
    }
    if (!isValidLabel(f.label)) {
      errors[String(index)] = 'Invalid label (non-empty string or {en,pl})';
      return;
    }
    if (typeof f.required !== 'boolean') {
      errors[String(index)] = 'required must be boolean';
      return;
    }
    if (
      typeof f.max_length !== 'number'
      || !Number.isInteger(f.max_length)
      || f.max_length < 1
      || f.max_length > CUSTOM_FIELD_MAX_VALUE_LENGTH
    ) {
      errors[String(index)] = `max_length must be 1..${CUSTOM_FIELD_MAX_VALUE_LENGTH}`;
      return;
    }
    if (f.placeholder !== undefined) {
      if (typeof f.placeholder !== 'string' || f.placeholder.length > PLACEHOLDER_MAX) {
        errors[String(index)] = `placeholder must be string up to ${PLACEHOLDER_MAX} chars`;
        return;
      }
    }

    out.push({
      id: f.id,
      type: f.type as CustomFieldType,
      label: f.label as CustomFieldLabel,
      required: f.required,
      max_length: f.max_length,
      ...(typeof f.placeholder === 'string' ? { placeholder: f.placeholder } : {}),
    });
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: out };
}

export interface ValidateValuesOptions {
  /**
   * When true (default — submit-time), missing required values produce errors.
   * When false (mount-time before user has typed), missing values are simply
   * dropped from the result instead of erroring, so the initial pending
   * payment_transactions row can be created with whatever is filled so far.
   */
  requireAll?: boolean;
}

export function validateCustomFieldValues(
  fields: CustomFieldDefinition[],
  values: unknown,
  options: ValidateValuesOptions = {},
): ValuesResult {
  const requireAll = options.requireAll !== false;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return { ok: false, errors: { _: 'Values must be an object' } };
  }
  const input = values as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const known = new Map(fields.map((f) => [f.id, f]));

  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      errors[key] = `Unknown field "${key}"`;
    }
  }

  const out: CustomFieldValues = {};

  for (const field of fields) {
    const raw = input[field.id];
    if (raw === undefined || raw === null || raw === '') {
      if (field.required && requireAll) errors[field.id] = 'Required';
      continue;
    }
    if (typeof raw !== 'string') {
      errors[field.id] = 'Must be a string';
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      if (field.required && requireAll) errors[field.id] = 'Required';
      continue;
    }
    if (trimmed.length > field.max_length) {
      errors[field.id] = `Too long (max ${field.max_length})`;
      continue;
    }
    if (field.type === 'email' && !EMAIL_PATTERN.test(trimmed)) {
      errors[field.id] = 'Invalid email';
      continue;
    }
    out[field.id] = trimmed;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const serialized = JSON.stringify(out);
  if (Buffer.byteLength(serialized, 'utf-8') > CUSTOM_FIELDS_VALUES_MAX_BYTES) {
    return { ok: false, errors: { _: `Total values exceed ${CUSTOM_FIELDS_VALUES_MAX_BYTES} bytes` } };
  }

  return { ok: true, values: out };
}
