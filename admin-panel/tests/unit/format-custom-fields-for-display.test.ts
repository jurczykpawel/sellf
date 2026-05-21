import { describe, it, expect } from 'vitest';
import { formatCustomFieldsForDisplay } from '@/lib/format-custom-fields';
import type { CustomFieldDefinition } from '@/lib/validations/custom-checkout-fields';

const defs: CustomFieldDefinition[] = [
  { id: 'imie_certyfikat', type: 'text', label: 'Imię na certyfikacie', required: true, max_length: 100 },
  { id: 'note', type: 'textarea', label: 'Wiadomość', required: false, max_length: 500 },
  { id: 'company_email', type: 'email', label: { pl: 'E-mail firmowy', en: 'Company email' }, required: false, max_length: 100 },
];

describe('formatCustomFieldsForDisplay', () => {
  it('returns empty array when no values', () => {
    expect(formatCustomFieldsForDisplay({}, defs, 'pl')).toEqual([]);
  });

  it('returns empty array when no definitions', () => {
    expect(formatCustomFieldsForDisplay({ note: 'hello' }, [], 'pl')).toEqual([]);
  });

  it('resolves label + type for each value, preserves field order from definitions', () => {
    const result = formatCustomFieldsForDisplay(
      { note: 'hello world', imie_certyfikat: 'Jan Kowalski' },
      defs,
      'pl',
    );
    expect(result).toEqual([
      { id: 'imie_certyfikat', label: 'Imię na certyfikacie', value: 'Jan Kowalski', type: 'text' },
      { id: 'note', label: 'Wiadomość', value: 'hello world', type: 'textarea' },
    ]);
  });

  it('drops empty / null / whitespace-only values', () => {
    const result = formatCustomFieldsForDisplay(
      { note: '   ', imie_certyfikat: 'Anna', company_email: '' },
      defs,
      'pl',
    );
    expect(result).toEqual([
      { id: 'imie_certyfikat', label: 'Imię na certyfikacie', value: 'Anna', type: 'text' },
    ]);
  });

  it('drops values whose id is not in definitions (backwards-compat after a field was removed)', () => {
    const result = formatCustomFieldsForDisplay(
      { stale_field: 'leftover', imie_certyfikat: 'Anna' },
      defs,
      'pl',
    );
    expect(result.map((r) => r.id)).toEqual(['imie_certyfikat']);
  });

  it('resolves multilang label via locale (pl) — falls back to en if pl missing', () => {
    const result = formatCustomFieldsForDisplay({ company_email: 'biuro@x.com' }, defs, 'pl');
    expect(result[0].label).toBe('E-mail firmowy');
  });

  it('resolves multilang label via locale (en)', () => {
    const result = formatCustomFieldsForDisplay({ company_email: 'biuro@x.com' }, defs, 'en');
    expect(result[0].label).toBe('Company email');
  });

  it('coerces non-string values to string (defensive — DB JSONB tolerates anything)', () => {
    const result = formatCustomFieldsForDisplay(
      { imie_certyfikat: 42 as unknown as string },
      defs,
      'pl',
    );
    expect(result[0].value).toBe('42');
  });

  it('returns empty array for null / undefined input', () => {
    expect(formatCustomFieldsForDisplay(null, defs, 'pl')).toEqual([]);
    expect(formatCustomFieldsForDisplay(undefined, defs, 'pl')).toEqual([]);
  });
});
