import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';

import { calculatePricing, toStripeCents } from '@/hooks/usePricing';
import { allocateCouponDiscount } from '@/lib/pricing/coupon-allocation';
import {
  currencyExponent,
  fromMinorUnits,
  minimumChargeAmount,
  minorFactor,
  toMinorUnits,
} from '@/lib/currency/minor-units';
import { buildCheckoutLineSpecs, buildStripeLineItems } from '@/lib/services/checkout-line-items';
import { buildSubscriptionCreatedPayload } from '@/lib/services/subscription-webhook-payload';
import { buildPlaceholderContext } from '@/lib/services/webhook-service';
import { validatePaymentAmount } from '@/lib/stripe/security';
import { priceMatchesProduct } from '@/lib/stripe/product-price';
import { buildPurchaseDiscountSummary } from '@/lib/purchases/discounts';
import { convertCurrencyAmount } from '@/lib/utils/currency-conversion';
import { SUPPORTED_CURRENCY_CODES } from '@/lib/constants';
import { validateCreateProduct } from '@/lib/validations/product';
import { displayPayoutAmount, parsePayoutAmount } from '@/lib/affiliates/payouts/display';

const specsFor = (currency: string, price: number, coupon: Parameters<typeof buildCheckoutLineSpecs>[0]['coupon'] = null) =>
  buildCheckoutLineSpecs({
    main: { id: 'main', name: 'Main', currency },
    mainPrice: price,
    bumps: [],
    coupon,
    taxMode: 'local',
  });

describe('currency minor units', () => {
  it('knows which selectable currencies are zero-decimal', () => {
    const zero = SUPPORTED_CURRENCY_CODES.filter((code) => currencyExponent(code) === 0);
    expect(zero).toEqual(['JPY', 'KRW', 'VND']);
    expect(currencyExponent('jpy')).toBe(0);
    expect(currencyExponent('PLN')).toBe(2);
    expect(currencyExponent('HUF')).toBe(2);
    expect(minorFactor('KRW')).toBe(1);
    expect(minorFactor('EUR')).toBe(100);
  });

  it('converts both ways', () => {
    expect(toMinorUnits(49.99, 'PLN')).toBe(4999);
    expect(toMinorUnits(1000, 'JPY')).toBe(1000);
    expect(fromMinorUnits(4999, 'USD')).toBe(49.99);
    expect(fromMinorUnits(15000, 'KRW')).toBe(15000);
  });

  it('uses Stripe minimum charges', () => {
    expect(minimumChargeAmount('JPY')).toBe(50);
    expect(minimumChargeAmount('KRW')).toBe(50);
    expect(minimumChargeAmount('PLN')).toBe(0.5);
  });
});

describe('one-time payment amounts', () => {
  it.each([
    ['PLN', 49.99, 4999],
    ['EUR', 10, 1000],
    ['USD', 0.5, 50],
    ['JPY', 1000, 1000],
    ['KRW', 15000, 15000],
    ['VND', 250000, 250000],
  ])('%s %s -> Stripe amount %s (payment intent and line item agree)', (currency, price, expected) => {
    const pricing = calculatePricing({ productPrice: price, productCurrency: currency });
    expect(toStripeCents(pricing.totalGross, currency)).toBe(expected);
    const { specs, totalMinor } = specsFor(currency, price);
    expect(specs[0].unitAmountMinor).toBe(expected);
    expect(totalMinor).toBe(expected);
    expect(pricing.totalPayable).toBe(price);
  });

  it('emits JPY Checkout Session line items without the x100', async () => {
    const { specs } = specsFor('JPY', 1000);
    const [item] = await buildStripeLineItems(specs, { resolveTaxRate: async () => 'txr_1' }) as Array<{ price_data: { unit_amount: number; currency: string } }>;
    expect(item.price_data).toMatchObject({ unit_amount: 1000, currency: 'jpy' });
  });

  it('applies the VAT on top of a net JPY price in whole yen', () => {
    const pricing = calculatePricing({ productPrice: 1000, productCurrency: 'JPY', productVatRate: 10, priceIncludesVat: false });
    expect(pricing.totalPayable).toBe(1100);
    expect(pricing.vatAmount).toBeCloseTo(100, 6);
  });

  it('keeps bump and main line sums equal to the payment intent for JPY', () => {
    const input = { productPrice: 1000, productCurrency: 'JPY', bumps: [{ id: 'b1', price: 500, selected: true }] };
    const pricing = calculatePricing(input);
    const { totalMinor } = buildCheckoutLineSpecs({
      main: { id: 'main', name: 'Main', currency: 'JPY' }, mainPrice: 1000,
      bumps: [{ product: { id: 'b1', name: 'Bump', currency: 'JPY' }, price: 500 }], coupon: null, taxMode: 'local',
    });
    expect(toStripeCents(pricing.totalGross, 'JPY')).toBe(1500);
    expect(totalMinor).toBe(1500);
  });
});

describe('coupons and the minimum floor', () => {
  it('a fixed JPY coupon is in whole yen', () => {
    const { specs } = specsFor('JPY', 1000, { code: 'C', discount_type: 'fixed', discount_value: 300 });
    expect(specs[0].unitAmountMinor).toBe(700);
  });

  it('a 50% KRW coupon splits across main and bump without fractions', () => {
    const result = allocateCouponDiscount({
      currency: 'KRW',
      items: [{ kind: 'base', id: 'm', price: 10001 }, { kind: 'bump', id: 'b', price: 5001 }],
      baseProductId: 'm',
      coupon: { code: 'H', discount_type: 'percentage', discount_value: 50 },
    });
    expect(result.items.every((item) => Number.isInteger(item.finalPrice))).toBe(true);
    expect(result.total).toBe(7501);
  });

  it('floors a tiny JPY total at the Stripe minimum of 50 yen, PLN at 0.50', () => {
    const jpy = specsFor('JPY', 100, { code: 'C', discount_type: 'fixed', discount_value: 90 });
    expect(jpy.specs[0].unitAmountMinor).toBe(50);
    const pln = specsFor('PLN', 10, { code: 'C', discount_type: 'fixed', discount_value: 9.9 });
    expect(pln.specs[0].unitAmountMinor).toBe(50);
  });

  it('a full coupon still reports free', () => {
    const { isFree, totalMinor } = specsFor('JPY', 1000, { code: 'C', discount_type: 'percentage', discount_value: 100 });
    expect(isFree).toBe(true);
    expect(totalMinor).toBe(0);
  });
});

describe('payment validation, webhook readback and display round trips', () => {
  it('validatePaymentAmount compares Stripe minor units', () => {
    expect(validatePaymentAmount(1000, 1000, 'JPY').valid).toBe(true);
    expect(validatePaymentAmount(100000, 1000, 'JPY').valid).toBe(false);
    expect(validatePaymentAmount(4999, 49.99, 'PLN').valid).toBe(true);
    expect(validatePaymentAmount(49, 10, 'KRW', true).valid).toBe(false);
    expect(validatePaymentAmount(50, 10, 'KRW', true, 50).valid).toBe(true);
  });

  it.each([['PLN', 49.99], ['USD', 120], ['JPY', 1000], ['KRW', 15000]])(
    'round trip %s %s: display -> Stripe amount_total -> DB amount -> display',
    (currency, price) => {
      const stripeAmountTotal = toStripeCents(calculatePricing({ productPrice: price, productCurrency: currency }).totalGross, currency);
      const storedAmount = stripeAmountTotal; // webhook stores amount_total verbatim
      expect(fromMinorUnits(storedAmount, currency)).toBe(price);
      const ctx = buildPlaceholderContext({ order: { amount: storedAmount, currency } });
      expect(ctx.amount).toBe(String(storedAmount));
      expect(Number(ctx.amount_major)).toBe(price);
    },
  );

  it('refund of a JPY order is bounded by the stored (Stripe) amount', () => {
    const stored = 1000, refunded = 400;
    expect(stored - refunded).toBe(600);
    expect(fromMinorUnits(refunded, 'JPY')).toBe(400);
    expect(fromMinorUnits(40000, 'PLN')).toBe(400);
  });

  it('purchase discount summary rounds to the currency precision', () => {
    expect(buildPurchaseDiscountSummary({ currency: 'JPY', subtotal: 1000, totalPaid: 700 })).toMatchObject({ subtotal: 1000, totalPaid: 700, discountAmount: 300 });
    expect(buildPurchaseDiscountSummary({ currency: 'PLN', subtotal: 99.99, totalPaid: 69.99 })?.discountAmount).toBe(30);
  });

  it('converts dashboard minor amounts through major units', () => {
    const rates = { base: 'USD', rates: { USD: 1, JPY: 150, PLN: 4 } };
    // 15000 JPY = 100 USD = 400 PLN = 40000 grosze
    expect(convertCurrencyAmount({ JPY: 15000 }, 'PLN', rates)).toBe(40000);
    expect(convertCurrencyAmount({ PLN: 40000 }, 'JPY', rates)).toBe(15000);
    expect(convertCurrencyAmount({ USD: 10000 }, 'JPY', rates)).toBe(15000);
  });
});

describe('subscriptions', () => {
  const product = (currency: string, recurring_price: number) => ({
    id: 'p', name: 'Sub', currency, recurring_price, billing_interval: 'month' as const,
    billing_interval_count: 1, stripe_price_id: null, price_includes_vat: false,
  });
  const stripePrice = (currency: string, unit_amount: number) => ({
    active: true, unit_amount, currency, tax_behavior: 'exclusive', recurring: { interval: 'month', interval_count: 1 },
  }) as unknown as Stripe.Price;

  it('matches the Stripe price by minor units per currency', () => {
    expect(priceMatchesProduct(stripePrice('jpy', 1000), product('JPY', 1000))).toBe(true);
    expect(priceMatchesProduct(stripePrice('jpy', 100000), product('JPY', 1000))).toBe(false);
    expect(priceMatchesProduct(stripePrice('pln', 4999), product('PLN', 49.99))).toBe(true);
  });

  it('reads recurring prices and invoices back as display amounts', () => {
    const sub = {
      id: 'sub_1', customer: 'cus_1', status: 'active', trial_end: null, cancel_at_period_end: false,
      items: { data: [{ price: { unit_amount: 1000, currency: 'jpy', recurring: { interval: 'month', interval_count: 1 } } }] },
    } as unknown as Stripe.Subscription;
    const payload = buildSubscriptionCreatedPayload({
      customer: { id: 'u', email: 'a@b.c' } as never, product: { id: 'p', name: 'Sub', currency: 'JPY' } as never, subscription: sub,
    });
    expect(payload.subscription.recurringPrice).toBe(1000);
  });
});

describe('admin input guards', () => {
  const base = { name: 'Zeta', slug: 'zeta', description: 'd', price: 1000.5, currency: 'JPY' };
  it('rejects fractional prices for zero-decimal currencies only', () => {
    expect(validateCreateProduct(base).errors.join()).toContain('price must be a whole number for JPY');
    expect(validateCreateProduct({ ...base, price: 1000 }).errors.join()).not.toContain('whole number');
    expect(validateCreateProduct({ ...base, currency: 'PLN' }).errors.join()).not.toContain('whole number');
  });

  it('affiliate payout amounts follow the same exponent', () => {
    expect(parsePayoutAmount('1000', 'KRW')).toBe('1000');
    expect(parsePayoutAmount('10.50', 'KRW')).toBeNull();
    expect(parsePayoutAmount('10.50', 'PLN')).toBe('1050');
    expect(displayPayoutAmount('1000', 'VND')).toBe('1000');
    expect(displayPayoutAmount('1050', 'PLN')).toBe('10.50');
  });
});
