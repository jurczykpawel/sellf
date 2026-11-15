import { describe, it, expect } from 'vitest';
import {
  hasValidTaxId,
  shouldRequestInvoice,
  shouldForwardTaxIdentityToStripe,
  taxIdErrorCode,
} from '@/lib/checkout/invoice-form-logic';

describe('hasValidTaxId / shouldRequestInvoice (NIP optional; invoice requested iff valid tax id)', () => {
  it('valid 10-digit PL NIP → true', () => {
    expect(hasValidTaxId('1181697228', 'PL')).toBe(true);
    expect(shouldRequestInvoice('1181697228', 'PL')).toBe(true);
  });
  it('empty / whitespace / null / undefined → false (no faktura requested)', () => {
    expect(hasValidTaxId('', 'PL')).toBe(false);
    expect(hasValidTaxId('   ', 'PL')).toBe(false);
    expect(hasValidTaxId(null, 'PL')).toBe(false);
    expect(hasValidTaxId(undefined, 'PL')).toBe(false);
    expect(shouldRequestInvoice('', 'US')).toBe(false);
  });
  it('wrong PL checksum → false', () => {
    expect(hasValidTaxId('1234567890', 'PL')).toBe(false);
  });
});

describe('the legacy form validates the tax id by the company country, like the profile checkout', () => {
  it.each([
    ['PL', '1181697228', true], ['PL', 'DE123456789', false],
    ['DE', 'DE123456789', true], ['DE', '123456789', true], ['DE', 'DE12345', false], ['DE', 'FR123456789', false],
    ['GR', 'EL123456789', true],
    ['US', 'EIN 12-3456789', true], ['US', '123', true], ['US', '<x>', false],
  ])('%s %s → %s', (country, nip, valid) => {
    expect(hasValidTaxId(nip, country)).toBe(valid);
  });
  it.each([['PL', 'invalid_nip'], ['DE', 'invalid_eu_vat'], ['US', 'invalid_tax_id']])('%s error code is %s', (country, code) => {
    expect(taxIdErrorCode(country)).toBe(code);
  });
});

describe('shouldForwardTaxIdentityToStripe', () => {
  it('only in stripe_tax mode', () => {
    expect(shouldForwardTaxIdentityToStripe('stripe_tax')).toBe(true);
    expect(shouldForwardTaxIdentityToStripe('local')).toBe(false);
    expect(shouldForwardTaxIdentityToStripe(undefined)).toBe(false);
  });
});
