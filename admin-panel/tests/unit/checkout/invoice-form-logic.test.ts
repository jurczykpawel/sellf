import { describe, it, expect } from 'vitest';
import {
  hasValidTaxId,
  shouldRequestInvoice,
  shouldShowCompanyFields,
  shouldCollectBuyerCountry,
  shouldForwardTaxIdentityToStripe,
} from '@/lib/checkout/invoice-form-logic';

describe('hasValidTaxId / shouldRequestInvoice (NIP optional; invoice requested iff valid tax id)', () => {
  it('valid 10-digit PL NIP → true', () => {
    expect(hasValidTaxId('1181697228')).toBe(true);
    expect(shouldRequestInvoice('1181697228')).toBe(true);
  });
  it('empty / whitespace / null / undefined → false (no faktura requested)', () => {
    expect(hasValidTaxId('')).toBe(false);
    expect(hasValidTaxId('   ')).toBe(false);
    expect(hasValidTaxId(null)).toBe(false);
    expect(hasValidTaxId(undefined)).toBe(false);
    expect(shouldRequestInvoice('')).toBe(false);
  });
  it('too short (< 8 chars) → false', () => {
    expect(hasValidTaxId('123')).toBe(false);
    expect(hasValidTaxId('1181')).toBe(false);
  });
  it('foreign VAT id (country code + 8+ chars) → true (validator accepts EU VAT, not just PL)', () => {
    expect(hasValidTaxId('DE123456789')).toBe(true);
  });
});

describe('shouldShowCompanyFields (company/address group visibility)', () => {
  it('full 10-char NIP → show', () => {
    expect(shouldShowCompanyFields({ nip: '1181697228' })).toBe(true);
  });
  it('GUS data present → show (even with short/empty NIP)', () => {
    expect(shouldShowCompanyFields({ nip: '11', hasGusData: true })).toBe(true);
  });
  it('company name already present → show', () => {
    expect(shouldShowCompanyFields({ nip: '', companyName: 'Firma Sp. z o.o.' })).toBe(true);
  });
  it('short NIP, no GUS, no company → hidden', () => {
    expect(shouldShowCompanyFields({ nip: '118' })).toBe(false);
    expect(shouldShowCompanyFields({})).toBe(false);
    expect(shouldShowCompanyFields({ nip: null, hasGusData: false, companyName: null })).toBe(false);
  });
});

describe('shouldCollectBuyerCountry / shouldForwardTaxIdentityToStripe (country + Stripe routing)', () => {
  it('stripe_tax → country selector shown AND tax identity forwarded to Stripe', () => {
    expect(shouldCollectBuyerCountry('stripe_tax')).toBe(true);
    expect(shouldForwardTaxIdentityToStripe('stripe_tax')).toBe(true);
  });
  it('local (fixed rate) → no country selector, nothing sent to Stripe for tax', () => {
    expect(shouldCollectBuyerCountry('local')).toBe(false);
    expect(shouldForwardTaxIdentityToStripe('local')).toBe(false);
  });
  it('undefined/null tax mode → treated as not stripe_tax (safe default)', () => {
    expect(shouldCollectBuyerCountry(null)).toBe(false);
    expect(shouldCollectBuyerCountry(undefined)).toBe(false);
    expect(shouldForwardTaxIdentityToStripe(undefined)).toBe(false);
  });
});
