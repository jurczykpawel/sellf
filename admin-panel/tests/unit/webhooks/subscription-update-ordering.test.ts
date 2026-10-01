import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Subscription events can arrive out of order. Once the stored subscription is
 * in a terminal state, an event snapshot alone must not move it back to a
 * granting state — the live Stripe state decides.
 */

vi.mock('@/lib/services/webhook-service', () => ({
  WebhookService: { trigger: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/lib/license-keys/issue', () => ({ issueLicense: vi.fn() }));

import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
} from '@/app/api/webhooks/stripe/subscription-handlers';

interface Write {
  table: string;
  value: Record<string, unknown>;
}

const PRODUCT = {
  id: 'product-1',
  name: 'Membership',
  slug: 'membership',
  currency: 'PLN',
  recurring_price: 49,
  billing_interval: 'month',
  billing_interval_count: 1,
  stripe_price_id: 'price_1',
  stripe_product_id: 'prod_stripe_1',
  allow_custom_price: false,
  custom_price_min: null,
};

let storedStatus: string | null;
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
        delete: self,
        maybeSingle: async () => ({
          data:
            table === 'subscriptions' && storedStatus
              ? { product_id: 'product-1', stripe_price_id: 'price_1', user_id: 'buyer-1', status: storedStatus }
              : null,
          error: null,
        }),
        single: async () => ({
          data: table === 'products' ? PRODUCT : { id: 'subscription-row' },
          error: null,
        }),
        upsert: (value: Record<string, unknown>) => {
          writes.push({ table, value });
          return q;
        },
        insert: (value: Record<string, unknown>) => {
          writes.push({ table, value });
          return q;
        },
        update: (value: Record<string, unknown>) => {
          writes.push({ table, value });
          return q;
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      });
      return q;
    },
  };
}

const platform = { rpc: vi.fn(async () => ({ data: 'buyer-1', error: null })) };

function makeSub(status: string) {
  return {
    id: 'sub_1',
    customer: { id: 'cus_1', email: 'buyer@example.com' },
    status,
    metadata: { product_id: 'product-1' },
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    latest_invoice: null,
    items: {
      data: [
        {
          price: {
            id: 'price_1',
            unit_amount: 4900,
            currency: 'pln',
            product: 'prod_stripe_1',
            recurring: { interval: 'month', interval_count: 1 },
          },
          current_period_start: 1700000000,
          current_period_end: 1702600000,
        },
      ],
    },
  };
}

const retrieve = vi.fn();
const stripe = { subscriptions: { retrieve } };

function subscriptionStatusWrites() {
  return writes.filter((w) => w.table === 'subscriptions').map((w) => w.value.status);
}

function accessGrants() {
  return writes.filter((w) => w.table === 'user_product_access');
}

beforeEach(() => {
  vi.clearAllMocks();
  storedStatus = null;
  writes = [];
});

describe.each([
  ['customer.subscription.updated', handleSubscriptionUpdated],
  ['customer.subscription.created', handleSubscriptionCreated],
])('%s after the subscription ended', (_event, handler) => {
  it('keeps the stored terminal state and grants nothing for an older active snapshot', async () => {
    storedStatus = 'canceled';
    retrieve.mockResolvedValue(makeSub('canceled'));

    const result = await handler(makeSub('active') as never, makeDb() as never, platform as never, stripe as never);

    expect(result.processed).toBe(true);
    expect(retrieve).toHaveBeenCalledWith('sub_1');
    expect(subscriptionStatusWrites()).toEqual(['canceled']);
    expect(accessGrants()).toEqual([]);
  });

  it('grants again when Stripe confirms the subscription is active', async () => {
    storedStatus = 'unpaid';
    retrieve.mockResolvedValue(makeSub('active'));

    const result = await handler(makeSub('active') as never, makeDb() as never, platform as never, stripe as never);

    expect(result.processed).toBe(true);
    expect(subscriptionStatusWrites()).toEqual(['active']);
    expect(accessGrants()).toHaveLength(1);
  });
});

describe('customer.subscription.updated for a live subscription', () => {
  it('uses the event snapshot without an extra Stripe lookup', async () => {
    storedStatus = 'active';

    const result = await handleSubscriptionUpdated(
      makeSub('active') as never,
      makeDb() as never,
      platform as never,
      stripe as never,
    );

    expect(result.processed).toBe(true);
    expect(retrieve).not.toHaveBeenCalled();
    expect(accessGrants()).toHaveLength(1);
  });
});
