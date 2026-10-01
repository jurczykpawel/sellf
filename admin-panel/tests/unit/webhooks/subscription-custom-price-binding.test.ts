import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * First-event product binding for subscriptions whose product allows a
 * buyer-chosen amount. Such subscriptions carry an ad-hoc Stripe price
 * (price_data) instead of the product's stored stripe_price_id, so they are
 * bound by the Stripe product + a minimum amount rather than by price id.
 */

vi.mock('@/lib/services/webhook-service', () => ({
  WebhookService: { trigger: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/lib/license-keys/issue', () => ({ issueLicense: vi.fn() }));

import { handleSubscriptionCreated } from '@/app/api/webhooks/stripe/subscription-handlers';

interface Write {
  table: string;
  op: 'upsert' | 'insert' | 'update';
  value: Record<string, unknown>;
}

const BASE_PRODUCT = {
  id: 'product-1',
  name: 'Support',
  slug: 'support',
  currency: 'PLN',
  recurring_price: 49,
  billing_interval: 'month',
  billing_interval_count: 1,
  stripe_price_id: 'price_fixed',
  stripe_product_id: 'prod_stripe_1',
  allow_custom_price: true,
  custom_price_min: 10,
};

let product: Record<string, unknown>;
let writes: Write[];

function makeDb() {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const self = () => q;
      Object.assign(q, {
        select: self,
        eq: self,
        neq: self,
        in: self,
        order: self,
        limit: self,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({
          data: table === 'products' ? product : { id: 'subscription-row' },
          error: null,
        }),
        upsert: (value: Record<string, unknown>) => {
          writes.push({ table, op: 'upsert', value });
          return q;
        },
        insert: (value: Record<string, unknown>) => {
          writes.push({ table, op: 'insert', value });
          return q;
        },
        update: (value: Record<string, unknown>) => {
          writes.push({ table, op: 'update', value });
          return q;
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      });
      return q;
    },
  };
}

const platform = {
  rpc: vi.fn(async () => ({ data: 'buyer-1', error: null })),
};

function makeSub(price: Record<string, unknown>) {
  return {
    id: 'sub_1',
    customer: { id: 'cus_1', email: 'buyer@example.com' },
    status: 'active',
    metadata: { product_id: 'product-1' },
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    latest_invoice: null,
    items: {
      data: [
        {
          price: {
            id: 'price_adhoc',
            unit_amount: 1500,
            currency: 'pln',
            product: 'prod_stripe_1',
            recurring: { interval: 'month', interval_count: 1 },
            ...price,
          },
          current_period_start: 1700000000,
          current_period_end: 1702600000,
        },
      ],
    },
  };
}

async function run(price: Record<string, unknown> = {}) {
  return handleSubscriptionCreated(
    makeSub(price) as never,
    makeDb() as never,
    platform as never,
    {} as never,
  );
}

function accessGrants() {
  return writes.filter((w) => w.table === 'user_product_access');
}

beforeEach(() => {
  product = { ...BASE_PRODUCT };
  writes = [];
});

describe('subscription binding for buyer-chosen amounts', () => {
  it('binds and grants access for an amount at or above the minimum', async () => {
    const result = await run();

    expect(result.processed).toBe(true);
    expect(writes.find((w) => w.table === 'subscriptions')?.value).toMatchObject({
      product_id: 'product-1',
      stripe_price_id: 'price_adhoc',
    });
    expect(accessGrants()[0]?.value).toMatchObject({ user_id: 'buyer-1', product_id: 'product-1' });
  });

  it('rejects an amount below the product minimum', async () => {
    const result = await run({ unit_amount: 900 });

    expect(result.processed).toBe(false);
    expect(accessGrants()).toEqual([]);
  });

  it('rejects a price attached to a different Stripe product', async () => {
    const result = await run({ product: 'prod_stripe_other' });

    expect(result.processed).toBe(false);
    expect(accessGrants()).toEqual([]);
  });

  it('rejects a currency or interval that differs from the product', async () => {
    expect((await run({ currency: 'eur' })).processed).toBe(false);
    expect((await run({ recurring: { interval: 'year', interval_count: 1 } })).processed).toBe(false);
    expect(accessGrants()).toEqual([]);
  });

  it('keeps requiring the stored price id when the product has a fixed price', async () => {
    product = { ...BASE_PRODUCT, allow_custom_price: false };

    const result = await run();

    expect(result.processed).toBe(false);
    expect(accessGrants()).toEqual([]);
  });

  it('still accepts the fixed stored price on a product that also allows custom amounts', async () => {
    const result = await run({ id: 'price_fixed', unit_amount: 4900 });

    expect(result.processed).toBe(true);
    expect(accessGrants()).toHaveLength(1);
  });
});
