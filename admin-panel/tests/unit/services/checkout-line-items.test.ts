import { describe, it, expect } from 'vitest';
import { buildCheckoutLineSpecs, buildStripeLineItems, type CheckoutLineProduct } from '@/lib/services/checkout-line-items';
import { calculatePricing } from '@/hooks/usePricing';
import type { CouponPricingInput } from '@/lib/pricing/coupon-allocation';

const main: CheckoutLineProduct = { id: 'main', name: 'Course', currency: 'PLN', vatRate: 23, priceIncludesVat: false };
const bumpA: CheckoutLineProduct = { id: 'bumpA', name: 'Toolkit', currency: 'PLN', vatRate: 23, priceIncludesVat: false };
const bumpB: CheckoutLineProduct = { id: 'bumpB', name: 'Templates', currency: 'PLN', vatRate: 8, priceIncludesVat: false };

interface Scenario {
  name: string;
  productPrice: number;
  customAmount?: number;
  bumps: Array<{ product: CheckoutLineProduct; price: number }>;
  coupon: CouponPricingInput | null;
}

const scenarios: Scenario[] = [
  { name: 'main only', productPrice: 100, bumps: [], coupon: null },
  { name: 'main + 1 bump', productPrice: 100, bumps: [{ product: bumpA, price: 50 }], coupon: null },
  { name: 'main + 2 bumps', productPrice: 100, bumps: [{ product: bumpA, price: 50 }, { product: bumpB, price: 30 }], coupon: null },
  { name: '10% coupon over main+bump', productPrice: 100, bumps: [{ product: bumpA, price: 50 }], coupon: { discount_type: 'percentage', discount_value: 10, code: 'X' } },
  { name: 'fixed 40 coupon over 2 bumps', productPrice: 100, bumps: [{ product: bumpA, price: 50 }, { product: bumpB, price: 30 }], coupon: { discount_type: 'fixed', discount_value: 40, code: 'Y' } },
  { name: 'PWYW custom 25', productPrice: 100, customAmount: 25, bumps: [], coupon: null },
  { name: 'PWYW + bump + 15% coupon', productPrice: 100, customAmount: 70, bumps: [{ product: bumpA, price: 50 }], coupon: { discount_type: 'percentage', discount_value: 15, code: 'Z' } },
  { name: 'odd amounts + 33% (rounding/remainder)', productPrice: 99.99, bumps: [{ product: bumpA, price: 49.99 }], coupon: { discount_type: 'percentage', discount_value: 33, code: 'R' } },
  { name: 'coupon excludes order bumps', productPrice: 100, bumps: [{ product: bumpA, price: 50 }], coupon: { discount_type: 'percentage', discount_value: 20, code: 'NOBUMP', exclude_order_bumps: true } },
  { name: 'coupon scoped to main (allowed_product_ids)', productPrice: 100, bumps: [{ product: bumpA, price: 50 }], coupon: { discount_type: 'percentage', discount_value: 30, code: 'MAINONLY', allowed_product_ids: ['main'] } },
  { name: 'minimum floor (90% off a small price)', productPrice: 3, bumps: [], coupon: { discount_type: 'percentage', discount_value: 90, code: 'BIG' } },
  { name: 'fixed coupon larger than subtotal (clamped)', productPrice: 40, bumps: [], coupon: { discount_type: 'fixed', discount_value: 999, code: 'HUGE' } },
];

function expectedTotalCents(s: Scenario): number {
  const p = calculatePricing({
    baseProductId: 'main',
    productPrice: s.productPrice,
    productCurrency: 'PLN',
    customAmount: s.customAmount,
    bumps: s.bumps.map((b) => ({ id: b.product.id, price: b.price, selected: true })),
    coupon: s.coupon,
  });
  return Math.round(p.totalGross * 100);
}

function resolvedBasePrice(s: Scenario): number {
  return s.customAmount !== undefined && s.customAmount > 0 ? s.customAmount : s.productPrice;
}

describe('buildCheckoutLineSpecs — total invariant (NEVER change the charged amount)', () => {
  for (const s of scenarios) {
    it(`sum of line amounts === calculatePricing total: ${s.name}`, () => {
      const { specs } = buildCheckoutLineSpecs({
        main,
        mainPrice: resolvedBasePrice(s),
        bumps: s.bumps,
        coupon: s.coupon,
        taxMode: 'local',
      });
      const sum = specs.reduce((acc, l) => acc + l.unitAmountMinor, 0);
      // The critical guarantee: splitting into per-line items keeps the exact total.
      expect(sum).toBe(expectedTotalCents(s));
      // one spec per product, main first, bumps in order, correct metadata flags
      expect(specs).toHaveLength(1 + s.bumps.length);
      expect(specs[0]).toMatchObject({ productId: 'main', isBump: false });
      s.bumps.forEach((b, i) => expect(specs[i + 1]).toMatchObject({ productId: b.product.id, isBump: true }));
      // no negative or NaN amounts
      specs.forEach((l) => expect(Number.isInteger(l.unitAmountMinor) && l.unitAmountMinor >= 0).toBe(true));
    });
  }
});

describe('buildCheckoutLineSpecs — tax behavior + rate', () => {
  it('local mode, vat 23 exclusive → rate 23, behavior exclusive', () => {
    const { specs: [m] } = buildCheckoutLineSpecs({ main, mainPrice: 100, bumps: [], coupon: null, taxMode: 'local' });
    expect(m.vatRate).toBe(23);
    expect(m.taxBehavior).toBe('exclusive');
  });
  it('local mode, inclusive → behavior inclusive', () => {
    const inc = { ...main, priceIncludesVat: true };
    const { specs: [m] } = buildCheckoutLineSpecs({ main: inc, mainPrice: 100, bumps: [], coupon: null, taxMode: 'local' });
    expect(m.taxBehavior).toBe('inclusive');
  });
  it('local mode, vat_exempt → no rate, no behavior (distinct from 0%)', () => {
    const ex = { ...main, vatExempt: true };
    const { specs: [m] } = buildCheckoutLineSpecs({ main: ex, mainPrice: 100, bumps: [], coupon: null, taxMode: 'local' });
    expect(m.vatRate).toBeNull();
    expect(m.taxBehavior).toBeNull();
  });
  it('local mode, vat 0 → no rate', () => {
    const zero = { ...main, vatRate: 0 };
    const { specs: [m] } = buildCheckoutLineSpecs({ main: zero, mainPrice: 100, bumps: [], coupon: null, taxMode: 'local' });
    expect(m.vatRate).toBeNull();
  });
  it('stripe_tax mode → no manual rate, behavior always set (Stripe computes)', () => {
    const { specs: [m] } = buildCheckoutLineSpecs({ main, mainPrice: 100, bumps: [], coupon: null, taxMode: 'stripe_tax' });
    expect(m.vatRate).toBeNull();
    expect(m.taxBehavior).toBe('exclusive');
  });
  it('per-bump rate differs from main (mixed rates)', () => {
    const { specs } = buildCheckoutLineSpecs({ main, mainPrice: 100, bumps: [{ product: bumpB, price: 30 }], coupon: null, taxMode: 'local' });
    expect(specs[0].vatRate).toBe(23);
    expect(specs[1].vatRate).toBe(8);
  });
});

describe('buildCheckoutLineSpecs — isFree (coupon covers full price, pre-floor)', () => {
  it('100% coupon → isFree true', () => {
    const { isFree } = buildCheckoutLineSpecs({
      main, mainPrice: 100, bumps: [],
      coupon: { discount_type: 'percentage', discount_value: 100, code: 'FREE' }, taxMode: 'local',
    });
    expect(isFree).toBe(true);
  });
  it('50% coupon → isFree false, totalMinor reflects discount', () => {
    const { isFree, totalMinor } = buildCheckoutLineSpecs({
      main, mainPrice: 100, bumps: [],
      coupon: { discount_type: 'percentage', discount_value: 50, code: 'HALF' }, taxMode: 'local',
    });
    expect(isFree).toBe(false);
    expect(totalMinor).toBe(5000);
  });
});

type StripeLineItemShape = {
  price_data: {
    currency: string;
    unit_amount: number;
    tax_behavior?: string;
    product_data: { name: string; description?: string; metadata: Record<string, string> };
  };
  tax_rates?: string[];
  quantity: number;
};

describe('buildStripeLineItems', () => {
  const resolve = async ({ percentage, inclusive }: { percentage: number; inclusive: boolean }) =>
    `txr_${percentage}_${inclusive ? 'inc' : 'exc'}`;

  it('builds price_data + per-line metadata + resolved tax_rates', async () => {
    const { specs } = buildCheckoutLineSpecs({
      main, mainPrice: 100, bumps: [{ product: bumpB, price: 30 }], coupon: null, taxMode: 'local',
    });
    const items = await buildStripeLineItems(specs, { resolveTaxRate: resolve });
    expect(items).toHaveLength(2);

    const m = items[0] as unknown as StripeLineItemShape;
    expect(m.price_data.unit_amount).toBe(10000);
    expect(m.price_data.currency).toBe('pln');
    expect(m.price_data.product_data.metadata).toEqual({ product_id: 'main' });
    expect(m.price_data.tax_behavior).toBe('exclusive');
    expect(m.tax_rates).toEqual(['txr_23_exc']);
    expect(m.quantity).toBe(1);

    const b = items[1] as unknown as StripeLineItemShape;
    expect(b.price_data.product_data.metadata).toEqual({ product_id: 'bumpB', is_bump: 'true' });
    expect(b.tax_rates).toEqual(['txr_8_exc']);
  });

  it('exempt line → no tax_rates, no tax_behavior', async () => {
    const ex = { ...main, vatExempt: true };
    const { specs } = buildCheckoutLineSpecs({ main: ex, mainPrice: 100, bumps: [], coupon: null, taxMode: 'local' });
    const items = await buildStripeLineItems(specs, { resolveTaxRate: resolve });
    const m = items[0] as unknown as StripeLineItemShape;
    expect(m.tax_rates).toBeUndefined();
    expect(m.price_data.tax_behavior).toBeUndefined();
  });

  it('inclusive line → tax_behavior inclusive, resolver gets inclusive=true', async () => {
    const inc = { ...main, priceIncludesVat: true };
    const { specs } = buildCheckoutLineSpecs({ main: inc, mainPrice: 100, bumps: [], coupon: null, taxMode: 'local' });
    const items = await buildStripeLineItems(specs, { resolveTaxRate: resolve });
    const m = items[0] as unknown as StripeLineItemShape;
    expect(m.price_data.tax_behavior).toBe('inclusive');
    expect(m.tax_rates).toEqual(['txr_23_inc']);
  });
});

describe('buildCheckoutLineSpecs — coupon scoping per line', () => {
  it('exclude_order_bumps → only main discounted, bump at full price', () => {
    const { specs } = buildCheckoutLineSpecs({
      main, mainPrice: 100, bumps: [{ product: bumpA, price: 50 }],
      coupon: { discount_type: 'percentage', discount_value: 20, code: 'NOBUMP', exclude_order_bumps: true },
      taxMode: 'local',
    });
    expect(specs[0].unitAmountMinor).toBe(8000); // 100 − 20%
    expect(specs[1].unitAmountMinor).toBe(5000); // bump untouched
  });
  it('allowed_product_ids scoped to main → bump at full price', () => {
    const { specs } = buildCheckoutLineSpecs({
      main, mainPrice: 100, bumps: [{ product: bumpA, price: 50 }],
      coupon: { discount_type: 'percentage', discount_value: 30, code: 'MAINONLY', allowed_product_ids: ['main'] },
      taxMode: 'local',
    });
    expect(specs[0].unitAmountMinor).toBe(7000); // 100 − 30%
    expect(specs[1].unitAmountMinor).toBe(5000); // bump excluded (not in allowed list)
  });
  it('100% coupon → isFree, both lines reduce to zero', () => {
    const { specs, isFree, totalMinor } = buildCheckoutLineSpecs({
      main, mainPrice: 100, bumps: [{ product: bumpA, price: 50 }],
      coupon: { discount_type: 'percentage', discount_value: 100, code: 'ALLFREE' },
      taxMode: 'local',
    });
    expect(isFree).toBe(true);
    expect(totalMinor).toBe(0);
    expect(specs.every((s) => s.unitAmountMinor === 0)).toBe(true);
  });
});
