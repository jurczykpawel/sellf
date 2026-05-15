import { describe, it, expect, vi } from 'vitest';
import { createSubscriptionWithDynamicPrice } from '@/lib/stripe/subscription-dynamic-price';

// Helper builds a Stripe Subscription with inline price_data (so PWYW amounts
// don't accumulate Stripe Price IDs) and returns the PaymentIntent client
// secret embedded in the subscription's first invoice. Same return shape as
// the one-shot path → frontend mounts one PaymentElement either way.

function makeStripeMock(opts: {
  amount: number;
  currency: string;
  customerId: string;
  paymentClientSecret?: string;
}) {
  const subscriptionsCreate = vi.fn(async () => ({
    id: 'sub_test_123',
    customer: opts.customerId,
    // Stripe API 2025+ returns confirmation_secret directly on the
    // subscription's latest_invoice for default_incomplete subscriptions.
    latest_invoice: {
      id: 'in_test_123',
      confirmation_secret: {
        client_secret: opts.paymentClientSecret ?? 'pi_test_123_secret_xyz',
      },
    },
  }));
  return {
    stripe: { subscriptions: { create: subscriptionsCreate } } as unknown as import('stripe').default,
    subscriptionsCreate,
  };
}

describe('createSubscriptionWithDynamicPrice', () => {
  it('returns clientSecret + subscriptionId for a valid input', async () => {
    const { stripe } = makeStripeMock({ amount: 500, currency: 'USD', customerId: 'cus_X' });
    const result = await createSubscriptionWithDynamicPrice({
      stripe,
      amount: 5,
      currency: 'USD',
      customer: 'cus_X',
      stripeProductId: 'prod_stripe_1',
      productId: 'prod_uuid_1',
      productSlug: 'tip-jar-1',
      interval: 'month',
      intervalCount: 1,
    });
    expect(result.subscriptionId).toBe('sub_test_123');
    expect(result.clientSecret).toBe('pi_test_123_secret_xyz');
  });

  it('passes price_data with unit_amount in cents and recurring config', async () => {
    const { stripe, subscriptionsCreate } = makeStripeMock({ amount: 1234, currency: 'PLN', customerId: 'cus_Y' });
    await createSubscriptionWithDynamicPrice({
      stripe,
      amount: 12.34,
      currency: 'PLN',
      customer: 'cus_Y',
      stripeProductId: 'prod_stripe_2',
      productId: 'prod_uuid_2',
      productSlug: 'monthly-support',
      interval: 'month',
      intervalCount: 1,
    });
    expect(subscriptionsCreate).toHaveBeenCalledTimes(1);
    const args = subscriptionsCreate.mock.calls[0][0] as {
      customer: string;
      items: Array<{ price_data: { unit_amount: number; currency: string; recurring: { interval: string; interval_count: number }; product: string } }>;
      payment_behavior: string;
      expand: string[];
      metadata: Record<string, string>;
    };
    expect(args.customer).toBe('cus_Y');
    expect(args.payment_behavior).toBe('default_incomplete');
    // Stripe API 2025+ uses confirmation_secret + invoice.payments. Expand
    // both so the helper can fall through from preferred (confirmation_secret)
    // to fallback (payments.data.payment) without an extra retrieve call.
    expect(args.expand).toContain('latest_invoice.confirmation_secret');
    expect(args.expand).toContain('latest_invoice.payments.data.payment');
    expect(args.metadata.product_id).toBe('prod_uuid_2');
    expect(args.metadata.product_slug).toBe('monthly-support');
    const pd = args.items[0].price_data;
    expect(pd.unit_amount).toBe(1234); // 12.34 PLN → 1234 grosze
    expect(pd.currency).toBe('pln');
    expect(pd.recurring.interval).toBe('month');
    expect(pd.recurring.interval_count).toBe(1);
    expect(pd.product).toBe('prod_stripe_2');
  });

  it('applies the tax rate when provided', async () => {
    const { stripe, subscriptionsCreate } = makeStripeMock({ amount: 100, currency: 'USD', customerId: 'cus_Z' });
    await createSubscriptionWithDynamicPrice({
      stripe,
      amount: 1,
      currency: 'USD',
      customer: 'cus_Z',
      stripeProductId: 'prod_stripe_z',
      productId: 'p',
      productSlug: 's',
      interval: 'month',
      intervalCount: 1,
      taxRateId: 'txr_test_23',
    });
    const args = subscriptionsCreate.mock.calls[0][0] as {
      default_tax_rates?: string[];
    };
    expect(args.default_tax_rates).toEqual(['txr_test_23']);
  });

  it('rejects amount <= 0', async () => {
    const { stripe } = makeStripeMock({ amount: 0, currency: 'USD', customerId: 'cus_W' });
    await expect(
      createSubscriptionWithDynamicPrice({
        stripe,
        amount: 0,
        currency: 'USD',
        customer: 'cus_W',
        productId: 'p',
        productName: 'n',
        productSlug: 's',
        interval: 'month',
        intervalCount: 1,
      }),
    ).rejects.toThrow(/amount/i);
  });

  it('throws if the subscription is missing latest_invoice.payment_intent.client_secret', async () => {
    const stripe = {
      subscriptions: {
        create: async () => ({ id: 'sub_no_pi', latest_invoice: { id: 'in_x' } }),
      },
    } as unknown as import('stripe').default;
    await expect(
      createSubscriptionWithDynamicPrice({
        stripe,
        amount: 5,
        currency: 'USD',
        customer: 'cus_X',
        productId: 'p',
        productName: 'n',
        productSlug: 's',
        interval: 'month',
        intervalCount: 1,
      }),
    ).rejects.toThrow(/client_secret/i);
  });
});
