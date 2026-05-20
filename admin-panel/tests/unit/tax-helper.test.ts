import { describe, it, expect } from 'vitest';
import { computeTaxHelperMessage } from '@/components/ProductFormModal/sections/TaxHelper';

describe('computeTaxHelperMessage', () => {
  it('returns null when tax_mode is not local', () => {
    expect(
      computeTaxHelperMessage({
        taxMode: 'stripe_tax',
        price: 49,
        vatRate: 23,
        priceIncludesVat: true,
        currency: 'PLN',
      }),
    ).toBeNull();
  });

  it('returns null when price is 0', () => {
    expect(
      computeTaxHelperMessage({
        taxMode: 'local',
        price: 0,
        vatRate: 23,
        priceIncludesVat: true,
        currency: 'PLN',
      }),
    ).toBeNull();
  });

  it('returns null when vat_rate is unset', () => {
    expect(
      computeTaxHelperMessage({
        taxMode: 'local',
        price: 49,
        vatRate: null,
        priceIncludesVat: true,
        currency: 'PLN',
      }),
    ).toBeNull();
  });

  it('inclusive VAT: communicates the buyer paying the full price', () => {
    const msg = computeTaxHelperMessage({
      taxMode: 'local',
      price: 49,
      vatRate: 23,
      priceIncludesVat: true,
      currency: 'PLN',
    });
    expect(msg).toEqual({ kind: 'gross', amount: '49.00', currency: 'PLN' });
  });

  it('exclusive VAT: shows gross calculation (net 100 + 23% = 123)', () => {
    const msg = computeTaxHelperMessage({
      taxMode: 'local',
      price: 100,
      vatRate: 23,
      priceIncludesVat: false,
      currency: 'PLN',
    });
    expect(msg).toEqual({ kind: 'net-to-gross', net: '100.00', gross: '123.00', currency: 'PLN' });
  });

  it('exclusive VAT: handles non-integer percentages', () => {
    const msg = computeTaxHelperMessage({
      taxMode: 'local',
      price: 100,
      vatRate: 8,
      priceIncludesVat: false,
      currency: 'EUR',
    });
    expect(msg).toEqual({ kind: 'net-to-gross', net: '100.00', gross: '108.00', currency: 'EUR' });
  });

  it('zero VAT rate (0%) inclusive: still shows the gross-equals-net message', () => {
    const msg = computeTaxHelperMessage({
      taxMode: 'local',
      price: 49,
      vatRate: 0,
      priceIncludesVat: true,
      currency: 'PLN',
    });
    expect(msg).toEqual({ kind: 'gross', amount: '49.00', currency: 'PLN' });
  });
});
