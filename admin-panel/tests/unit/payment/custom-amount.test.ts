import { describe, it, expect } from 'vitest';
import { validateCustomAmount } from '@/lib/payment/custom-amount';

const baseProduct = {
  allow_custom_price: true,
  custom_price_min: null,
  currency: 'USD',
};

describe('validateCustomAmount', () => {
  it('accepts a normal positive amount when PWYW is enabled', () => {
    expect(validateCustomAmount(50, baseProduct)).toEqual({ ok: true });
  });

  it('rejects when product does not allow custom pricing', () => {
    expect(
      validateCustomAmount(50, { ...baseProduct, allow_custom_price: false })
    ).toMatchObject({ ok: false, error: expect.stringMatching(/custom pricing/i) });
  });

  it('rejects non-number, NaN, Infinity', () => {
    expect(validateCustomAmount('50' as unknown, baseProduct).ok).toBe(false);
    expect(validateCustomAmount(NaN, baseProduct).ok).toBe(false);
    expect(validateCustomAmount(Infinity, baseProduct).ok).toBe(false);
    expect(validateCustomAmount(-Infinity, baseProduct).ok).toBe(false);
  });

  it('rejects zero or negative', () => {
    expect(validateCustomAmount(0, baseProduct).ok).toBe(false);
    expect(validateCustomAmount(-1, baseProduct).ok).toBe(false);
  });

  it('rejects below product-specific minimum', () => {
    const result = validateCustomAmount(5, { ...baseProduct, custom_price_min: 10 });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('10') });
  });

  it('rejects amounts exceeding the Stripe ceiling', () => {
    expect(validateCustomAmount(1_000_000, baseProduct).ok).toBe(false);
    expect(validateCustomAmount(1e308, baseProduct)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no more than/i),
    });
  });

  it('accepts the exact maximum allowed amount', () => {
    expect(validateCustomAmount(999_999.99, baseProduct)).toEqual({ ok: true });
  });
});
