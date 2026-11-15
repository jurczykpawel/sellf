/**
 * Every Stripe object Sellf creates for a payment carries metadata.sellf_instance, so installations
 * sharing one Stripe account can tell their own webhook events apart.
 * @see src/lib/stripe/instance-marker.ts
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const identity = vi.hoisted(() => ({ readInstanceId: vi.fn(async () => 'a3c1f0de-0000-4000-8000-00000000c0de') }));
vi.mock('@/lib/telemetry/identity', () => identity);
vi.mock('@/lib/stripe/checkout-config', () => ({ getCheckoutConfig: vi.fn(async () => CONFIG) }));
vi.mock('@/lib/stripe/tax-rate-manager', () => ({ getOrCreateStripeTaxRate: vi.fn(), resolveLocalSubscriptionTaxRateId: vi.fn() }));
vi.mock('@/lib/stripe/customer', () => ({ getOrCreateStripeCustomer: vi.fn(async () => 'cus_1') }));
vi.mock('@/lib/stripe/product-price', () => ({ getOrCreateStripePriceForProduct: vi.fn(async () => 'price_1') }));
vi.mock('@/lib/stripe/server', () => ({ getStripeServer: vi.fn() }));

import { getStripeInstanceId, readStripeInstanceMarker, STRIPE_INSTANCE_METADATA_KEY } from '@/lib/stripe/instance-marker';
import { buildSubscriptionSessionConfig } from '@/lib/stripe/subscription-checkout';
import { createSubscriptionWithDynamicPrice } from '@/lib/stripe/subscription-dynamic-price';
import { createQuickPaySession } from '@/lib/orders/quick-pay';
import { CheckoutService } from '@/lib/services/checkout';
import type { CheckoutConfig } from '@/lib/stripe/checkout-config';
import type { ProductForCheckout } from '@/types/checkout';

const CONFIG = {
  tax_mode: 'local', automatic_tax: { enabled: false }, tax_id_collection: { enabled: false }, billing_address_collection: 'auto',
  expires_hours: 24, collect_terms_of_service: false, paymentMethodMode: 'automatic', payment_method_types: ['card'],
} as unknown as CheckoutConfig;
const EXPECTED = createHash('sha256').update('sellf-stripe-instance:a3c1f0de-0000-4000-8000-00000000c0de').digest('hex').slice(0, 32);
const PRODUCT = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'course', name: 'Course', description: null, price: 100, currency: 'PLN',
  is_active: true, available_from: null, available_until: null, vat_rate: 23, price_includes_vat: true,
} as unknown as ProductForCheckout;
const SUB = { ...PRODUCT, product_type: 'subscription', recurring_price: 10, billing_interval: 'month', billing_interval_count: 1 } as unknown as ProductForCheckout;

beforeEach(() => vi.clearAllMocks());

describe('instance id', () => {
  it('is a 32-hex hash of the installation id, not the raw telemetry id', async () => {
    const id = await getStripeInstanceId();
    expect(id).toBe(EXPECTED);
    expect(id).not.toContain('a3c1f0de-');
  });

  it('reads the marker from metadata and from a subscription invoice snapshot', () => {
    expect(readStripeInstanceMarker({ metadata: { sellf_instance: 'x1' } })).toBe('x1');
    expect(readStripeInstanceMarker({ metadata: {}, parent: { subscription_details: { metadata: { sellf_instance: 'x2' } } } })).toBe('x2');
    expect(readStripeInstanceMarker({ metadata: { sellf_instance: '' } })).toBeNull();
    expect(readStripeInstanceMarker(null)).toBeNull();
  });
});

describe('creation paths carry the marker', () => {
  it('subscription Checkout Session: session and subscription metadata', () => {
    const config = buildSubscriptionSessionConfig({ product: SUB as never, stripePriceId: 'price_1', returnUrl: 'https://shop.example/r', checkoutConfig: CONFIG, instanceId: EXPECTED }) as {
      metadata: Record<string, string>; subscription_data: { metadata: Record<string, string> };
    };
    expect(config.metadata[STRIPE_INSTANCE_METADATA_KEY]).toBe(EXPECTED);
    expect(config.subscription_data.metadata[STRIPE_INSTANCE_METADATA_KEY]).toBe(EXPECTED);
  });

  it('pay-what-you-want subscription (subscriptions.create)', async () => {
    const create = vi.fn(async () => ({ id: 'sub_1', latest_invoice: { id: 'in_1', confirmation_secret: { client_secret: 'pi_1_secret' } } }));
    await createSubscriptionWithDynamicPrice({
      stripe: { subscriptions: { create } } as unknown as Stripe, amount: 10, currency: 'PLN', customer: 'cus_1', stripeProductId: 'prod_1',
      productId: PRODUCT.id, productSlug: 'course', interval: 'month', intervalCount: 1, priceIncludesVat: true, instanceId: EXPECTED,
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ [STRIPE_INSTANCE_METADATA_KEY]: EXPECTED }) }));
  });

  it('online payment of a transfer order: session and its PaymentIntent', async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === 'open_order_payment_attempt' ? { id: 'att_1', reused: false, status: 'opening' } : null, error: null }));
    const create = vi.fn(async () => ({ id: 'cs_q', url: 'https://checkout.stripe.com/c/pay/cs_q' }));
    await createQuickPaySession({ rpc } as unknown as SupabaseClient<Database>, { checkout: { sessions: { create } } } as unknown as Stripe,
      { id: 'o1', payment_provider: 'bank_transfer', status: 'awaiting_payment', amount: 8000, currency: 'PLN', product_id: 'p1', coupon_id: null, order_number: 1, customer_email: 'b@example.com' },
      { mode: 'settle', amount: 8000, currency: 'PLN' }, { baseUrl: 'https://shop.example', returnUrl: 'https://shop.example/r', now: new Date(), productName: 'Course' });
    const params = (create.mock.calls[0] as unknown as [Stripe.Checkout.SessionCreateParams])[0];
    expect(params.metadata?.[STRIPE_INSTANCE_METADATA_KEY]).toBe(EXPECTED);
    expect(params.payment_intent_data?.metadata?.[STRIPE_INSTANCE_METADATA_KEY]).toBe(EXPECTED);
  });

  it.each([
    ['one-time (embedded and embed checkout)', PRODUCT],
    ['subscription (embedded and embed checkout)', SUB],
  ])('CheckoutService %s', async (_label, product) => {
    const create = vi.fn(async () => ({ id: 'cs_1', client_secret: 'cs_1_secret' }));
    const service = new CheckoutService();
    (service as unknown as { stripe: unknown }).stripe = { checkout: { sessions: { create } } };
    await service.createStripeSession({ product, returnUrl: 'https://shop.example/r', email: 'b@example.com' });
    const params = (create.mock.calls[0] as unknown as [Stripe.Checkout.SessionCreateParams])[0];
    expect(params.metadata?.[STRIPE_INSTANCE_METADATA_KEY]).toBe(EXPECTED);
    const child = product === SUB ? params.subscription_data?.metadata : params.payment_intent_data?.metadata;
    expect(child?.[STRIPE_INSTANCE_METADATA_KEY]).toBe(EXPECTED);
  });
});

describe('no unmarked creation path', () => {
  const CREATE = /\.(checkout\.sessions|paymentIntents|subscriptions|refunds|invoices|paymentLinks)\.create\(/;
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : /\.tsx?$/.test(name) ? [full] : [];
    });
  }
  it('every source file creating a payment object in Stripe applies the marker', () => {
    const src = path.resolve(__dirname, '../../../src');
    const offenders = files(src)
      .filter((file) => CREATE.test(readFileSync(file, 'utf8')))
      .filter((file) => !/stripeInstanceMetadata|getStripeInstanceId|instanceId/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(src, file));
    expect(offenders).toEqual([]);
  });
});
