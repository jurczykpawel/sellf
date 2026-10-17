/**
 * VAT handling when the product form is submitted.
 * Subscriptions are paid products: their VAT settings are kept and edited like a
 * one-time product's. Only genuinely free products drop the "price includes VAT" flag.
 */
import { describe, it, expect } from 'vitest';
import { resolveSubmitVatFields } from '@/components/ProductFormModal/submit-vat';

const base = {
  product_type: 'one_time' as const,
  price: 49,
  allow_custom_price: false,
  recurring_price: null as number | null,
  vat_rate: 23 as number | null,
  price_includes_vat: true,
};

describe('resolveSubmitVatFields', () => {
  it('keeps VAT settings of a paid one-time product', () => {
    expect(resolveSubmitVatFields(base)).toEqual({ price: 49, vat_rate: 23, price_includes_vat: true });
  });

  it('keeps VAT settings of a subscription (create and edit): rate and gross flag survive', () => {
    const sub = { ...base, product_type: 'subscription' as const, price: 0, recurring_price: 29 };
    expect(resolveSubmitVatFields(sub)).toEqual({ price: 0, vat_rate: 23, price_includes_vat: true });
  });

  it('keeps an explicit net subscription as chosen by the seller', () => {
    const sub = { ...base, product_type: 'subscription' as const, price: 0, recurring_price: 29, price_includes_vat: false };
    expect(resolveSubmitVatFields(sub)).toMatchObject({ vat_rate: 23, price_includes_vat: false });
  });

  it('forces the one-time price of a subscription to 0', () => {
    const sub = { ...base, product_type: 'subscription' as const, price: 15, recurring_price: 29 };
    expect(resolveSubmitVatFields(sub).price).toBe(0);
  });

  it('free product keeps its stored rate but is never "price includes VAT"', () => {
    const free = { ...base, price: 0 };
    expect(resolveSubmitVatFields(free)).toEqual({ price: 0, vat_rate: 23, price_includes_vat: false });
  });

  it('pay-what-you-want product with price 0 is not free', () => {
    const pwyw = { ...base, price: 0, allow_custom_price: true };
    expect(resolveSubmitVatFields(pwyw)).toEqual({ price: 0, vat_rate: 23, price_includes_vat: true });
  });
});
