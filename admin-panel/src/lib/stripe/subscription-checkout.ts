/**
 * Subscription checkout session builder.
 *
 * Pure helper that produces the Stripe Checkout session-create payload for
 * `mode: 'subscription'`. Both server-action (`actions/checkout.ts`) and the
 * service-layer path (`services/checkout.ts`) call this so the subscription
 * shape lives in exactly one place.
 *
 * Subscriptions intentionally bypass coupons / bumps / Pay-What-You-Want in MVP
 * (recurring discounts use Stripe coupons via `discounts` in Phase 4+).
 *
 * @see https://docs.stripe.com/api/checkout/sessions/create
 */

import type { ValidatedProduct } from '@/lib/services/product-validation';
import type { CheckoutConfig } from '@/lib/stripe/checkout-config';

export interface SubscriptionSessionInput {
  product: ValidatedProduct;
  customerId: string;
  /**
   * durable Stripe Price id pre-created via getOrCreateStripePriceForProduct.
   * The webhook handler verifies sub.items.data[0].price.id matches this exact id
   * (persisted on products.stripe_price_id) to prove product identity.
   */
  stripePriceId: string;
  returnUrl: string;
  email?: string;
  userId?: string;
  checkoutConfig: CheckoutConfig;
  taxRateId?: string;
}

export function buildSubscriptionSessionConfig(
  input: SubscriptionSessionInput
): Record<string, unknown> {
  const { product, customerId, stripePriceId, returnUrl, email, userId, checkoutConfig, taxRateId } = input;

  if (product.product_type !== 'subscription') {
    throw new Error('buildSubscriptionSessionConfig: product is not a subscription');
  }
  if (!product.recurring_price || !product.billing_interval || !product.billing_interval_count) {
    throw new Error('buildSubscriptionSessionConfig: missing recurring fields');
  }
  if (!stripePriceId) {
    throw new Error('buildSubscriptionSessionConfig: stripePriceId is required');
  }

  const sessionConfig: Record<string, unknown> = {
    ui_mode: 'embedded_page' as const,
    mode: 'subscription' as const,
    customer: customerId,
    line_items: [
      {
        // use the persisted Stripe Price id (durable binding) instead
        // of inline price_data, so subscription items have a verifiable price.id.
        price: stripePriceId,
        ...(taxRateId && { tax_rates: [taxRateId] }),
        quantity: 1,
      },
    ],
    return_url: returnUrl,
    redirect_on_completion: 'always' as const,
    metadata: {
      product_id: product.id,
      product_slug: product.slug,
      product_type: 'subscription',
      user_id: userId || null,
    },
    subscription_data: {
      metadata: {
        product_id: product.id,
        product_slug: product.slug,
        user_id: userId || null,
      },
      ...(product.trial_days && product.trial_days > 0
        ? { trial_period_days: product.trial_days }
        : {}),
    },
    expires_at: Math.floor(Date.now() / 1000) + checkoutConfig.expires_hours * 60 * 60,
    automatic_tax: checkoutConfig.automatic_tax,
    tax_id_collection: checkoutConfig.tax_id_collection,
    billing_address_collection: checkoutConfig.billing_address_collection,
  };

  // Stripe rejects customer_email when `customer` is set — Stripe pulls the email from the customer.
  // The email arg is forwarded to getOrCreateStripeCustomer upstream, so it's already on the customer record.
  void email;

  if (checkoutConfig.paymentMethodMode === 'automatic') {
    // Checkout Sessions use Stripe Dynamic Payment Methods by default.
    // Passing automatic_payment_methods is only valid for PaymentIntents.
  } else if (
    checkoutConfig.paymentMethodMode === 'stripe_preset' &&
    checkoutConfig.stripePresetId
  ) {
    sessionConfig.payment_method_configuration = checkoutConfig.stripePresetId;
  } else {
    sessionConfig.payment_method_types = [...checkoutConfig.payment_method_types];
  }

  if (checkoutConfig.collect_terms_of_service) {
    sessionConfig.consent_collection = {
      terms_of_service: 'required',
    };
  }

  return sessionConfig;
}
