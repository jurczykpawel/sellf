import type Stripe from 'stripe';

export interface CreateDynamicSubscriptionInput {
  stripe: Stripe;
  /** Buyer-chosen amount in major currency units (e.g. 12.34 PLN, not grosze). */
  amount: number;
  /** ISO 4217 code, will be lowercased before sending to Stripe. */
  currency: string;
  customer: string;
  /**
   * Pre-existing Stripe Product ID. Must be ensured by the caller (use
   * ensureStripeProduct from `@/lib/stripe/ensure-product`) because Stripe
   * rejects inline product_data inside subscriptions.create.items.price_data.
   */
  stripeProductId: string;
  /** Sellf product id — pinned in subscription.metadata so the webhook can bind. */
  productId: string;
  productSlug: string;
  interval: 'day' | 'week' | 'month' | 'year';
  intervalCount: number;
  taxRateId?: string;
}

export interface CreateDynamicSubscriptionResult {
  subscriptionId: string;
  clientSecret: string;
}

// Reusable helper for both tip-jar monthly toggle (Phase 3c) and any future
// PWYW subscription product (admin sets allow_custom_price=true on a
// subscription product → buyer picks monthly amount).
//
// Uses `price_data` so we don't accumulate one Stripe Price per donation
// amount, and `payment_behavior: default_incomplete` + expand so we get back
// a PaymentIntent client_secret usable by inline <PaymentElement> — same
// mount path as the one-shot checkout flow, no Stripe Embedded Checkout.
export async function createSubscriptionWithDynamicPrice(
  input: CreateDynamicSubscriptionInput,
): Promise<CreateDynamicSubscriptionResult> {
  if (!(input.amount > 0)) {
    throw new Error('createSubscriptionWithDynamicPrice: amount must be > 0');
  }

  const unitAmount = Math.round(input.amount * 100);
  // Stripe API 2025+ removed Invoice.payment_intent — the PaymentIntent is
  // now under invoice.payments[].payment.payment_intent. We also have to
  // explicitly request a PaymentIntent via payment_settings so Stripe builds
  // one for the first invoice when no default payment method is attached yet.
  const subscription = (await input.stripe.subscriptions.create({
    customer: input.customer,
    payment_behavior: 'default_incomplete',
    items: [
      {
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: unitAmount,
          recurring: {
            interval: input.interval,
            interval_count: input.intervalCount,
          },
          product: input.stripeProductId,
        },
      },
    ],
    metadata: {
      product_id: input.productId,
      product_slug: input.productSlug,
    },
    payment_settings: {
      payment_method_types: ['card'],
      save_default_payment_method: 'on_subscription',
    },
    expand: ['latest_invoice.confirmation_secret', 'latest_invoice.payments.data.payment'],
    ...(input.taxRateId ? { default_tax_rates: [input.taxRateId] } : {}),
  } as unknown as Parameters<Stripe['subscriptions']['create']>[0])) as unknown as {
    id: string;
    latest_invoice: {
      id: string;
      confirmation_secret?: { client_secret?: string } | null;
      payments?: {
        data: Array<{
          payment?: {
            payment_intent?: string | { id: string; client_secret?: string };
          };
        }>;
      };
    } | null;
  };

  const invoice = subscription.latest_invoice;

  // Preferred: new Stripe API 2025+ exposes a confirmation_secret directly
  // for default_incomplete subscriptions — single field, works with PE.
  const fromConfirmation = invoice?.confirmation_secret?.client_secret;
  if (fromConfirmation) {
    return { subscriptionId: subscription.id, clientSecret: fromConfirmation };
  }

  // Fallback: traverse invoice.payments → payment_intent. Requires a
  // separate retrieve call if the inner payment_intent came back as just an
  // id (Stripe doesn't always deeply expand under invoice.payments).
  const firstPaymentNode = invoice?.payments?.data?.[0]?.payment?.payment_intent;
  if (firstPaymentNode) {
    if (typeof firstPaymentNode === 'object' && firstPaymentNode.client_secret) {
      return { subscriptionId: subscription.id, clientSecret: firstPaymentNode.client_secret };
    }
    const piId = typeof firstPaymentNode === 'string' ? firstPaymentNode : firstPaymentNode.id;
    if (piId) {
      const pi = await input.stripe.paymentIntents.retrieve(piId);
      if (pi.client_secret) {
        return { subscriptionId: subscription.id, clientSecret: pi.client_secret };
      }
    }
  }

  console.error(
    '[createSubscriptionWithDynamicPrice] could not resolve client_secret. subscription shape:',
    JSON.stringify({ id: subscription.id, latest_invoice: invoice }),
  );
  throw new Error(
    'createSubscriptionWithDynamicPrice: missing latest_invoice.payment_intent.client_secret',
  );
}
