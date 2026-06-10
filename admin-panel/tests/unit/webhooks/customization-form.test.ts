import { describe, it, expect } from 'vitest';
import { buildCustomizationPayload, PAYLOAD_TOP_LEVEL_KEYS } from '@/lib/webhooks/customization-form';

const base = { payloadFieldsSelected: [...PAYLOAD_TOP_LEVEL_KEYS], extraFields: [], headerRows: [], deleteHeaders: false, hadHeaders: false };

describe('buildCustomizationPayload', () => {
  it('all fields checked → payload_field_selection null', () => {
    expect(buildCustomizationPayload(base).payload_field_selection).toBeNull();
  });
  it('subset → the checked keys', () => {
    expect(buildCustomizationPayload({ ...base, payloadFieldsSelected: ['order', 'customer'] }).payload_field_selection)
      .toEqual(['order', 'customer']);
  });
  it('extra fields drop empty keys; all-empty → null', () => {
    expect(buildCustomizationPayload({ ...base, extraFields: [{ key: 'brand', value: 'tsa' }, { key: '', value: 'x' }] }).custom_payload_fields)
      .toEqual({ brand: 'tsa' });
    expect(buildCustomizationPayload({ ...base, extraFields: [{ key: '', value: '' }] }).custom_payload_fields).toBeNull();
  });
  it('new header rows → map (set/replace)', () => {
    expect(buildCustomizationPayload({ ...base, headerRows: [{ key: 'Authorization', value: 'Bearer T' }] }).custom_headers)
      .toEqual({ Authorization: 'Bearer T' });
  });
  it('delete only (had headers, no new rows) → custom_headers null', () => {
    expect(buildCustomizationPayload({ ...base, hadHeaders: true, deleteHeaders: true }).custom_headers).toBeNull();
  });
  it('no header change → custom_headers omitted', () => {
    expect('custom_headers' in buildCustomizationPayload({ ...base, hadHeaders: true })).toBe(false);
  });
});
