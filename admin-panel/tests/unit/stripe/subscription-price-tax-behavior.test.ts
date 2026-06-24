import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { priceMatchesProduct } from '@/lib/stripe/product-price';

/**
 * The subscription Price now carries tax_behavior (brutto=inclusive / netto=exclusive)
 * so Stripe Tax treats the recurring price correctly. tax_behavior is immutable on a
 * Price, so priceMatchesProduct must treat a brutto↔netto change — or a legacy Price
 * created without it ('unspecified') — as stale and roll to a new Price.
 */
const baseProduct = {
  id: 'p1',
  name: 'Sub',
  currency: 'PLN',
  recurring_price: 100,
  billing_interval: 'month' as const,
  billing_interval_count: 1,
  stripe_price_id: 'price_1',
  price_includes_vat: true, // brutto → inclusive
};

function fakePrice(overrides: Partial<Stripe.Price>): Stripe.Price {
  return {
    active: true,
    unit_amount: 10000,
    currency: 'pln',
    recurring: { interval: 'month', interval_count: 1 },
    tax_behavior: 'inclusive',
    ...overrides,
  } as unknown as Stripe.Price;
}

describe('priceMatchesProduct — tax_behavior', () => {
  it('brutto product + inclusive price → match', () => {
    expect(priceMatchesProduct(fakePrice({ tax_behavior: 'inclusive' }), baseProduct)).toBe(true);
  });

  it('brutto product + exclusive price → stale (roll)', () => {
    expect(priceMatchesProduct(fakePrice({ tax_behavior: 'exclusive' }), baseProduct)).toBe(false);
  });

  it('legacy price with unspecified tax_behavior → stale (roll)', () => {
    expect(priceMatchesProduct(fakePrice({ tax_behavior: 'unspecified' }), baseProduct)).toBe(false);
  });

  it('netto product + exclusive price → match', () => {
    const netto = { ...baseProduct, price_includes_vat: false };
    expect(priceMatchesProduct(fakePrice({ tax_behavior: 'exclusive' }), netto)).toBe(true);
  });

  it('netto product + inclusive price → stale (roll)', () => {
    const netto = { ...baseProduct, price_includes_vat: false };
    expect(priceMatchesProduct(fakePrice({ tax_behavior: 'inclusive' }), netto)).toBe(false);
  });

  it('still rejects on a non-tax field (amount) regardless of tax_behavior', () => {
    expect(priceMatchesProduct(fakePrice({ unit_amount: 9999, tax_behavior: 'inclusive' }), baseProduct)).toBe(false);
  });
});
