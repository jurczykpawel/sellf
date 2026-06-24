import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { createSubscriptionWithDynamicPrice } from '@/lib/stripe/subscription-dynamic-price';

/**
 * PWYW subscriptions create the Stripe subscription directly (no Checkout Session),
 * so they must set tax themselves: tax_behavior on price_data (brutto/netto) and
 * automatic_tax in stripe_tax mode (otherwise Stripe Tax wouldn't compute VAT).
 */
function fakeStripe(capture: { arg?: Record<string, unknown> }) {
  return {
    subscriptions: {
      create: async (arg: Record<string, unknown>) => {
        capture.arg = arg;
        return { id: 'sub_1', latest_invoice: { id: 'in_1', confirmation_secret: { client_secret: 'cs_x' } } };
      },
    },
  } as unknown as Stripe;
}

const base = {
  amount: 50,
  currency: 'PLN',
  customer: 'cus_1',
  stripeProductId: 'prod_1',
  productId: 'p1',
  productSlug: 'p1',
  interval: 'month' as const,
  intervalCount: 1,
};

describe('createSubscriptionWithDynamicPrice — tax', () => {
  it('stripe_tax + netto: sets automatic_tax + exclusive tax_behavior, no manual rate', async () => {
    const cap: { arg?: Record<string, unknown> } = {};
    const res = await createSubscriptionWithDynamicPrice({
      stripe: fakeStripe(cap), ...base, priceIncludesVat: false, automaticTax: { enabled: true },
    });
    expect(res.clientSecret).toBe('cs_x');
    const arg = cap.arg!;
    expect(arg.automatic_tax).toEqual({ enabled: true });
    expect((arg.items as Array<{ price_data: { tax_behavior: string } }>)[0].price_data.tax_behavior).toBe('exclusive');
    expect(arg.default_tax_rates).toBeUndefined();
  });

  it('local + brutto: inclusive tax_behavior + manual rate, no automatic_tax', async () => {
    const cap: { arg?: Record<string, unknown> } = {};
    await createSubscriptionWithDynamicPrice({
      stripe: fakeStripe(cap), ...base, priceIncludesVat: true, taxRateId: 'txr_23', automaticTax: { enabled: false },
    });
    const arg = cap.arg!;
    // automaticTax enabled:false is still passed through (subscription with automatic_tax disabled)
    expect(arg.automatic_tax).toEqual({ enabled: false });
    expect((arg.items as Array<{ price_data: { tax_behavior: string } }>)[0].price_data.tax_behavior).toBe('inclusive');
    expect(arg.default_tax_rates).toEqual(['txr_23']);
  });
});
