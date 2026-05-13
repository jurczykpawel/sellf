import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

const supabaseMocks = vi.hoisted(() => ({
  eq: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: supabaseMocks.from,
  }),
}));

import { getOrCreateStripePriceForProduct } from '@/lib/stripe/product-price';

function makeProduct(overrides: Partial<{
  id: string;
  name: string;
  currency: string;
  recurring_price: number | null;
  billing_interval: 'day' | 'week' | 'month' | 'year' | null;
  billing_interval_count: number | null;
  stripe_price_id: string | null;
}> = {}) {
  return {
    id: 'prod_currency_test',
    name: 'Currency Test Subscription',
    currency: 'EUR',
    recurring_price: 49.99,
    billing_interval: 'month' as const,
    billing_interval_count: 1,
    stripe_price_id: null,
    ...overrides,
  };
}

function makeStripeMock() {
  return {
    prices: {
      create: vi.fn(async () => ({ id: 'price_new' })),
      retrieve: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as Stripe;
}

function makeStripePrice(overrides: Partial<Stripe.Price> = {}) {
  return {
    id: 'price_existing',
    object: 'price',
    active: true,
    billing_scheme: 'per_unit',
    created: 1,
    currency: 'eur',
    livemode: false,
    lookup_key: null,
    metadata: {},
    nickname: null,
    product: 'prod_stripe',
    recurring: {
      aggregate_usage: null,
      interval: 'month',
      interval_count: 1,
      meter: null,
      trial_period_days: null,
      usage_type: 'licensed',
    },
    tax_behavior: 'unspecified',
    tiers_mode: null,
    transform_quantity: null,
    type: 'recurring',
    unit_amount: 4999,
    unit_amount_decimal: '4999',
    ...overrides,
  } as Stripe.Price;
}

describe('Stripe subscription price currency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.eq.mockResolvedValue({ error: null });
    supabaseMocks.update.mockReturnValue({ eq: supabaseMocks.eq });
    supabaseMocks.from.mockReturnValue({ update: supabaseMocks.update });
  });

  it('creates Stripe Prices using the product currency in lowercase', async () => {
    const stripe = makeStripeMock();

    const priceId = await getOrCreateStripePriceForProduct(stripe, makeProduct({
      currency: 'USD',
      recurring_price: 19.5,
      billing_interval: 'year',
      billing_interval_count: 1,
    }));

    expect(priceId).toBe('price_new');
    expect(stripe.prices.create).toHaveBeenCalledWith(expect.objectContaining({
      unit_amount: 1950,
      currency: 'usd',
      recurring: {
        interval: 'year',
        interval_count: 1,
      },
    }));
    expect(supabaseMocks.update).toHaveBeenCalledWith({ stripe_price_id: 'price_new' });
    expect(supabaseMocks.eq).toHaveBeenCalledWith('id', 'prod_currency_test');
  });

  it('recreates the Stripe Price when the persisted price has a different currency', async () => {
    const stripe = makeStripeMock();
    vi.mocked(stripe.prices.retrieve).mockResolvedValue(makeStripePrice({ currency: 'pln' }));

    const priceId = await getOrCreateStripePriceForProduct(stripe, makeProduct({
      currency: 'EUR',
      stripe_price_id: 'price_old',
    }));

    expect(priceId).toBe('price_new');
    expect(stripe.prices.update).toHaveBeenCalledWith('price_old', { active: false });
    expect(stripe.prices.create).toHaveBeenCalledWith(expect.objectContaining({
      currency: 'eur',
      unit_amount: 4999,
    }));
  });
});
