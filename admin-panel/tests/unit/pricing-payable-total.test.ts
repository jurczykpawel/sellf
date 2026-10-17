/**
 * The amount on the pay button must be what the buyer is charged.
 * Net prices (price_includes_vat = false) get VAT added on top at checkout,
 * so the displayed payable total includes it; gross prices are shown as-is.
 */
import { describe, it, expect } from 'vitest';
import { calculatePricing } from '@/hooks/usePricing';

describe('calculatePricing: payable total', () => {
  it('gross price: payable equals the shown price', () => {
    const p = calculatePricing({ productPrice: 100, productCurrency: 'PLN', productVatRate: 23, priceIncludesVat: true });
    expect(p.totalPayable).toBe(100);
    expect(p.totalNet).toBeCloseTo(81.3, 1);
  });

  it('net price: VAT is added on top of the price', () => {
    const p = calculatePricing({ productPrice: 100, productCurrency: 'PLN', productVatRate: 23, priceIncludesVat: false });
    expect(p.totalNet).toBe(100);
    expect(p.vatAmount).toBe(23);
    expect(p.totalPayable).toBe(123);
  });

  it('net price with a coupon: VAT applies to the discounted net', () => {
    const p = calculatePricing({
      productPrice: 100, productCurrency: 'PLN', productVatRate: 23, priceIncludesVat: false,
      coupon: { discount_type: 'percentage', discount_value: 50, code: 'HALF' },
    });
    expect(p.totalNet).toBe(50);
    expect(p.totalPayable).toBe(61.5);
  });

  it('net price without a rate: nothing added', () => {
    const p = calculatePricing({ productPrice: 100, productCurrency: 'PLN', priceIncludesVat: false });
    expect(p.totalPayable).toBe(100);
  });

  it('rounds the payable total to cents', () => {
    const p = calculatePricing({ productPrice: 9.99, productCurrency: 'PLN', productVatRate: 23, priceIncludesVat: false });
    expect(p.totalPayable).toBe(12.29);
  });

  it('totalGross stays the discounted sum the server charges as the base amount', () => {
    const p = calculatePricing({ productPrice: 100, productCurrency: 'PLN', productVatRate: 23, priceIncludesVat: false });
    expect(p.totalGross).toBe(100);
  });
});
