import { describe, expect, it } from 'vitest';
import { classifyTaxId, taxIdTypeForCountry } from '@/lib/validation/tax-id';
import { validateTaxId } from '@/lib/validation/nip';

describe('tax id type follows the company country', () => {
  it.each([
    ['PL', 'pl_nip'], ['DE', 'eu_vat'], ['GR', 'eu_vat'], ['US', 'other'], ['GB', 'other'], ['', 'other'],
  ])('%s -> %s', (country, type) => expect(taxIdTypeForCountry(country)).toBe(type));
});

describe('EU VAT numbers are checked against the format of their country', () => {
  it.each([
    ['AT', 'ATU12345678'], ['BE', 'BE0123456789'], ['BG', 'BG123456789'], ['CY', 'CY12345678X'],
    ['CZ', 'CZ12345678'], ['DE', 'DE123456789'], ['DK', 'DK12345678'], ['EE', 'EE123456789'],
    ['GR', 'EL123456789'], ['ES', 'ESX1234567X'], ['FI', 'FI12345678'], ['FR', 'FRAB123456789'],
    ['HR', 'HR12345678901'], ['HU', 'HU12345678'], ['IE', 'IE1234567WA'], ['IT', 'IT12345678901'],
    ['LT', 'LT123456789'], ['LU', 'LU12345678'], ['LV', 'LV12345678901'], ['MT', 'MT12345678'],
    ['NL', 'NL123456789B01'], ['PT', 'PT123456789'], ['RO', 'RO1234'], ['SE', 'SE123456789001'],
    ['SI', 'SI12345678'], ['SK', 'SK1234567890'],
  ])('%s accepts %s', (country, value) => {
    expect(classifyTaxId(value, country)).toMatchObject({ valid: true, type: 'eu_vat', country, normalized: value });
  });

  it.each([
    ['DE', 'DE12345678'], ['DE', 'DE1234567890'], ['AT', 'AT12345678'], ['NL', 'NL123456789'],
    ['FR', 'FR12345678'], ['SE', 'SE1234567890'], ['DE', 'FR123456789'], ['GR', 'GR123456789'], ['DE', ''],
  ])('%s rejects %s', (country, value) => {
    expect(classifyTaxId(value, country)).toMatchObject({ valid: false, type: 'eu_vat' });
  });

  it('adds the missing country prefix and drops spaces and dashes', () => {
    expect(classifyTaxId('123 456-789', 'DE')).toMatchObject({ valid: true, normalized: 'DE123456789' });
    expect(classifyTaxId('123456789', 'GR')).toMatchObject({ valid: true, normalized: 'EL123456789' });
  });
});

describe('Polish NIP keeps the checksum', () => {
  it('accepts a valid NIP with or without the PL prefix', () => {
    expect(classifyTaxId('PL 525-224-84-81', 'PL')).toMatchObject({ valid: true, type: 'pl_nip', normalized: '5252248481' });
  });
  it('rejects a wrong checksum', () => expect(classifyTaxId('1234567890', 'PL').valid).toBe(false));
});

describe('identifiers outside the EU are accepted without a format', () => {
  it.each(['12-3456789', 'GB 123 4567 89', 'ABN 51 824 753 556', '123/456.789', ''])('US accepts %s', value => {
    expect(classifyTaxId(value, 'US')).toMatchObject({ valid: true, type: 'other', country: 'US', normalized: value.trim() });
  });
  it.each(['<script>', 'a'.repeat(41), 'x\u0000y'])('still rejects unsafe or oversized input %s', value => {
    expect(classifyTaxId(value, 'US').valid).toBe(false);
  });
});

describe('validateTaxId with a country uses the per-country rules', () => {
  it('rejects a German number with the wrong length that the old prefix check accepted', () => {
    expect(validateTaxId('DE12345', true, 'DE').isValid).toBe(false);
  });
  it('accepts a US EIN with a space', () => expect(validateTaxId('EIN 12-3456789', true, 'US').isValid).toBe(true));
});
