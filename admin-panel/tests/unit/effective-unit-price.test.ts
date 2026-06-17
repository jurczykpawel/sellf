import { describe, it, expect } from 'vitest';
import { getEffectiveUnitPrice } from '@/lib/services/omnibus';

describe('getEffectiveUnitPrice', () => {
  it('returns regular price when no sale price is set', () => {
    expect(getEffectiveUnitPrice({ price: 499 })).toBe(499);
    expect(getEffectiveUnitPrice({ price: 499, sale_price: null })).toBe(499);
  });

  it('returns the sale price when an indefinite sale is active', () => {
    expect(
      getEffectiveUnitPrice({ price: 499, sale_price: 349, sale_price_until: null }),
    ).toBe(349);
  });

  it('returns the sale price when the sale has a future expiry', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(
      getEffectiveUnitPrice({ price: 499, sale_price: 349, sale_price_until: future }),
    ).toBe(349);
  });

  it('ignores an expired sale and returns the regular price', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(
      getEffectiveUnitPrice({ price: 499, sale_price: 349, sale_price_until: past }),
    ).toBe(499);
  });

  it('ignores a sale whose quantity limit is exhausted', () => {
    expect(
      getEffectiveUnitPrice({
        price: 499,
        sale_price: 349,
        sale_quantity_limit: 10,
        sale_quantity_sold: 10,
      }),
    ).toBe(499);
  });

  it('honours a sale that still has quantity remaining', () => {
    expect(
      getEffectiveUnitPrice({
        price: 499,
        sale_price: 349,
        sale_quantity_limit: 10,
        sale_quantity_sold: 9,
      }),
    ).toBe(349);
  });

  it('ignores a zero or negative sale price', () => {
    expect(getEffectiveUnitPrice({ price: 499, sale_price: 0 })).toBe(499);
    expect(getEffectiveUnitPrice({ price: 499, sale_price: -5 })).toBe(499);
  });
});
