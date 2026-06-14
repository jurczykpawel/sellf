import { describe, it, expect } from 'vitest';
import {
  createPredefinedCustomField,
  customFieldClaimName,
  PREDEFINED_CUSTOM_FIELDS,
  validateCustomFieldDefinitions,
  validateCustomFieldValues,
  CUSTOM_FIELD_MAX_PER_PRODUCT,
  CUSTOM_FIELD_MAX_VALUE_LENGTH,
  CUSTOM_FIELDS_VALUES_MAX_BYTES,
  type CustomFieldDefinition,
} from '@/lib/validations/custom-checkout-fields';

// SINGLE SOURCE OF TRUTH walidator dla custom checkout fields. Używany przez:
//  - admin UI (live validation w editor)
//  - API /create-payment-intent (server-side, source of truth)
//  - DB level: JSONB shape pilnowany przez tę funkcję, w bazie tylko TYPE
//
// Forward-compat naming:
//  - label przyjmuje string LUB {en,pl} dict (na razie używamy string; dict
//    przyjdzie gdy multi-language wsparcie zostanie dodane jako rozszerzenie).
//  - Dodanie nowego typu pola = nowy variant w discriminated union + nowy case
//    w walidatorze; istniejące dane pozostają zgodne.

describe('validateCustomFieldDefinitions', () => {
  const minimalText: CustomFieldDefinition = {
    id: 'message',
    type: 'text',
    label: 'Wiadomość',
    required: false,
    max_length: 200,
  };

  it('accepts an empty definitions array', () => {
    const r = validateCustomFieldDefinitions([]);
    expect(r.ok).toBe(true);
  });

  it('accepts a minimal text field', () => {
    const r = validateCustomFieldDefinitions([minimalText]);
    expect(r.ok).toBe(true);
  });

  it('accepts textarea and email types with valid shape', () => {
    const fields: CustomFieldDefinition[] = [
      { id: 'note', type: 'textarea', label: 'Notka', required: false, max_length: 500 },
      { id: 'contact', type: 'email', label: 'Email', required: true, max_length: 200 },
    ];
    expect(validateCustomFieldDefinitions(fields).ok).toBe(true);
  });

  it('accepts the registered license-domain field', () => {
    const field = createPredefinedCustomField('license_domain');
    expect(field).toMatchObject({ id: '_sellf_license_domain', type: 'domain' });
    expect(validateCustomFieldDefinitions([field]).ok).toBe(true);
  });

  it('rejects unknown identifiers in the reserved namespace', () => {
    const r = validateCustomFieldDefinitions([{ ...minimalText, id: '_sellf_tier' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors['0']).toMatch(/reserved/i);
  });

  it('rejects repurposing a predefined identifier with another type', () => {
    const r = validateCustomFieldDefinitions([
      { ...minimalText, id: PREDEFINED_CUSTOM_FIELDS.license_domain.id, type: 'text' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors['0']).toMatch(/domain/i);
  });

  it('rejects custom ids whose normalized claim names collide', () => {
    const r = validateCustomFieldDefinitions([
      minimalText,
      { ...minimalText, id: 'company-name' },
      { ...minimalText, id: 'company_name' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.errors)).toMatch(/claim|collision/i);
  });

  it('derives namespaced claims only for ordinary fields', () => {
    expect(customFieldClaimName('company-name')).toBe('custom_company_name');
    expect(customFieldClaimName('_sellf_license_domain')).toBeNull();
  });

  it('accepts a label given as multi-language dict (forward-compat shape)', () => {
    const r = validateCustomFieldDefinitions([
      { ...minimalText, label: { en: 'Message', pl: 'Wiadomość' } },
    ]);
    expect(r.ok).toBe(true);
  });

  it('rejects unknown type', () => {
    const r = validateCustomFieldDefinitions([
      // intentional cast — runtime payload could come from anywhere
      { ...minimalText, type: 'evil' as unknown as 'text' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toMatchObject({ '0': expect.stringMatching(/type/i) });
    }
  });

  it('rejects missing id', () => {
    const r = validateCustomFieldDefinitions([
      { ...minimalText, id: '' },
    ]);
    expect(r.ok).toBe(false);
  });

  it('rejects id with characters outside [a-z0-9_-] (so JSON keys stay safe)', () => {
    const r = validateCustomFieldDefinitions([
      { ...minimalText, id: 'My Field!' },
    ]);
    expect(r.ok).toBe(false);
  });

  it.each(['__proto__', 'prototype', 'constructor'])('rejects unsafe object key %s', (id) => {
    expect(validateCustomFieldDefinitions([{ ...minimalText, id }]).ok).toBe(false);
  });

  it('limits field ids and labels', () => {
    expect(validateCustomFieldDefinitions([{ ...minimalText, id: 'a'.repeat(65) }]).ok).toBe(false);
    expect(validateCustomFieldDefinitions([{ ...minimalText, label: 'a'.repeat(201) }]).ok).toBe(false);
  });

  it('rejects duplicate ids', () => {
    const r = validateCustomFieldDefinitions([
      minimalText,
      { ...minimalText, label: 'inna etykieta' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(JSON.stringify(r.errors)).toMatch(/duplicate|duplikat/i);
    }
  });

  it('rejects empty label string', () => {
    const r = validateCustomFieldDefinitions([
      { ...minimalText, label: '' },
    ]);
    expect(r.ok).toBe(false);
  });

  it('rejects multi-lang label without `pl` and `en` keys', () => {
    const r = validateCustomFieldDefinitions([
      // intentional cast for invalid runtime shape
      { ...minimalText, label: { en: 'Message' } as unknown as { en: string; pl: string } },
    ]);
    expect(r.ok).toBe(false);
  });

  it('enforces max_length within [1, CUSTOM_FIELD_MAX_VALUE_LENGTH]', () => {
    expect(validateCustomFieldDefinitions([{ ...minimalText, max_length: 0 }]).ok).toBe(false);
    expect(
      validateCustomFieldDefinitions([{ ...minimalText, max_length: CUSTOM_FIELD_MAX_VALUE_LENGTH + 1 }]).ok,
    ).toBe(false);
    expect(
      validateCustomFieldDefinitions([{ ...minimalText, max_length: CUSTOM_FIELD_MAX_VALUE_LENGTH }]).ok,
    ).toBe(true);
  });

  it('rejects more than CUSTOM_FIELD_MAX_PER_PRODUCT fields', () => {
    const tooMany = Array.from({ length: CUSTOM_FIELD_MAX_PER_PRODUCT + 1 }, (_, i) => ({
      ...minimalText,
      id: `f${i}`,
    }));
    expect(validateCustomFieldDefinitions(tooMany).ok).toBe(false);
  });

  it('accepts an optional placeholder string up to 200 chars', () => {
    expect(
      validateCustomFieldDefinitions([{ ...minimalText, placeholder: 'Powiedz coś miłego…' }]).ok,
    ).toBe(true);
    expect(
      validateCustomFieldDefinitions([{ ...minimalText, placeholder: 'x'.repeat(201) }]).ok,
    ).toBe(false);
  });
});

describe('validateCustomFieldValues', () => {
  const fields: CustomFieldDefinition[] = [
    { id: 'message', type: 'textarea', label: 'Wiadomość', required: false, max_length: 500 },
    { id: 'domain', type: 'text', label: 'Domena', required: true, max_length: 200 },
    { id: 'contact', type: 'email', label: 'Email', required: false, max_length: 200 },
  ];

  it('accepts an empty values object when no fields are required', () => {
    const r = validateCustomFieldValues([fields[0]], {});
    expect(r.ok).toBe(true);
  });

  it('rejects missing required field', () => {
    const r = validateCustomFieldValues(fields, { message: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveProperty('domain');
  });

  it('accepts when required field has a value', () => {
    const r = validateCustomFieldValues(fields, { domain: 'example.com' });
    expect(r.ok).toBe(true);
  });

  it('rejects values longer than the field max_length', () => {
    const r = validateCustomFieldValues(fields, {
      domain: 'a'.repeat(201),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveProperty('domain');
  });

  it('rejects invalid email format on email type', () => {
    const r = validateCustomFieldValues(fields, {
      domain: 'example.com',
      contact: 'not-an-email',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveProperty('contact');
  });

  it('rejects values for unknown field ids (buyer cannot inject new fields)', () => {
    const r = validateCustomFieldValues(fields, {
      domain: 'example.com',
      sneaky: 'attempt to inject',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.errors)).toMatch(/sneaky|unknown/i);
  });

  it('rejects non-string values', () => {
    const r = validateCustomFieldValues(fields, {
      // intentional cast — payload from JSON can carry anything
      domain: 42 as unknown as string,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects total JSONB serialized size larger than CUSTOM_FIELDS_VALUES_MAX_BYTES', () => {
    // Build a single value just under per-field cap but pad enough fields to bust the global limit
    const bigFields: CustomFieldDefinition[] = Array.from({ length: 10 }, (_, i) => ({
      id: `f${i}`,
      type: 'textarea',
      label: `Pole ${i}`,
      required: false,
      max_length: 500,
    }));
    const values: Record<string, string> = {};
    for (const f of bigFields) values[f.id] = 'x'.repeat(f.max_length);
    const totalBytes = Buffer.byteLength(JSON.stringify(values), 'utf-8');
    if (totalBytes <= CUSTOM_FIELDS_VALUES_MAX_BYTES) {
      // Lock the assumption — if limits change so much that 10×500 fits, this test must be updated.
      throw new Error(
        `Test premise broken: 10×500-char values (${totalBytes} bytes) fit under CUSTOM_FIELDS_VALUES_MAX_BYTES (${CUSTOM_FIELDS_VALUES_MAX_BYTES}).`,
      );
    }
    const r = validateCustomFieldValues(bigFields, values);
    expect(r.ok).toBe(false);
  });

  it('trims whitespace before length check (no padding bypass)', () => {
    const onlyDomain = fields.filter((f) => f.id === 'domain');
    const r = validateCustomFieldValues(onlyDomain, { domain: '   example.com   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.values.domain).toBe('example.com');
  });

  it('normalizes a valid predefined license domain', () => {
    const domain = createPredefinedCustomField('license_domain');
    const r = validateCustomFieldValues([domain], {
      [domain.id]: 'https://www.Example.com:443/path?x=1',
    });
    expect(r).toEqual({ ok: true, values: { [domain.id]: 'example.com' } });
  });

  it.each([
      'https://user@example.com',
    'example.com/path',
    '127.0.0.1',
    '[::1]',
    'exa mple.com',
    'javascript:alert(1)',
  ])('rejects unsafe or ambiguous domain input: %s', (value) => {
    const domain = createPredefinedCustomField('license_domain');
    const r = validateCustomFieldValues([domain], { [domain.id]: value });
    expect(r.ok).toBe(false);
  });
});
