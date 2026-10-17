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

// Per-line VAT: expected values come from the SERVER's own line builder.
import { buildCheckoutLineSpecs, computePayableMinor } from '@/lib/services/checkout-line-items';

describe('calculatePricing: per-line VAT equals the server charge', () => {
  type L = { vat: number | null; incl: boolean; exempt?: boolean };
  const run = (main: L, bump: L, taxMode: 'local' | 'stripe_tax', coupon: Parameters<typeof calculatePricing>[0]['coupon'] = null) => {
    const client = calculatePricing({
      baseProductId: 'm', productPrice: 100, productCurrency: 'PLN',
      productVatRate: main.vat ?? undefined, priceIncludesVat: main.incl, vatExempt: main.exempt, taxMode,
      bumps: [{ id: 'b', price: 40, selected: true, vatRate: bump.vat, priceIncludesVat: bump.incl, vatExempt: bump.exempt }],
      coupon,
    });
    const server = buildCheckoutLineSpecs({
      main: { id: 'm', name: 'm', currency: 'PLN', vatRate: main.vat, priceIncludesVat: main.incl, vatExempt: main.exempt },
      mainPrice: 100,
      bumps: [{ product: { id: 'b', name: 'b', currency: 'PLN', vatRate: bump.vat, priceIncludesVat: bump.incl, vatExempt: bump.exempt }, price: 40 }],
      coupon, taxMode,
    });
    return { client, serverMinor: computePayableMinor(server.specs) };
  };

  it('main gross 23% + bump net 8%', () => {
    const { client, serverMinor } = run({ vat: 23, incl: true }, { vat: 8, incl: false }, 'local');
    expect(Math.round(client.totalPayable * 100)).toBe(serverMinor);
    expect(client.totalPayable).toBe(143.2);
  });
  it('main net 23% + bump gross 8%', () => {
    const { client, serverMinor } = run({ vat: 23, incl: false }, { vat: 8, incl: true }, 'local');
    expect(Math.round(client.totalPayable * 100)).toBe(serverMinor);
    expect(client.totalPayable).toBe(163);
  });
  it('exempt bump gets no VAT even when net', () => {
    const { client, serverMinor } = run({ vat: 23, incl: false }, { vat: 8, incl: false, exempt: true }, 'local');
    expect(Math.round(client.totalPayable * 100)).toBe(serverMinor);
    expect(client.totalPayable).toBe(163);
  });
  it('Stripe Tax mode adds no local VAT', () => {
    const { client, serverMinor } = run({ vat: 23, incl: false }, { vat: 8, incl: false }, 'stripe_tax');
    expect(Math.round(client.totalPayable * 100)).toBe(serverMinor);
    expect(client.totalPayable).toBe(140);
  });
  it('coupon is applied before tax, as on the server', () => {
    const coupon = { discount_type: 'percentage' as const, discount_value: 10, code: 'TEN' };
    const { client, serverMinor } = run({ vat: 23, incl: false }, { vat: 8, incl: false }, 'local', coupon);
    expect(Math.round(client.totalPayable * 100)).toBe(serverMinor);
    expect(client.totalPayable).toBe(Math.round((90 * 1.23 + 36 * 1.08) * 100) / 100);
  });
});
