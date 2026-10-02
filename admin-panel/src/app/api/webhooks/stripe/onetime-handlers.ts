/**
 * One-time payment webhook handlers, extracted from route.ts (Option A).
 *
 * handleCheckoutSessionCompleted + handlePaymentIntentSucceeded live here so they are independently importable and
 * testable. route.ts imports them and dispatches from POST; the behavioral suite tests/unit/webhooks/onetime-payment-handlers.behavioral
 * is the regression net for it.
 *
 * @see src/app/api/webhooks/stripe/route.ts
 */

import { getStripeServer } from '@/lib/stripe/server';
import { fulfillPaidOrder } from '@/lib/services/fulfill-paid-order';
import type { createAdminClient } from '@/lib/supabase/admin';
import { redactEmail } from '@/lib/logger';
import type Stripe from 'stripe';

/**
 * Process successful payment from checkout session.
 */
export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ processed: boolean; message: string }> {
  // Subscription checkouts are handled end-to-end by the
  // customer.subscription.created + invoice.paid handlers in
  // subscription-handlers.ts. This handler stays scoped to the
  // one-time-payment surface.
  if (session.mode === 'subscription') {
    return { processed: true, message: 'Skipped: subscription mode (handled by invoice.paid)' };
  }

  const sessionId = session.id;
  const productId = session.metadata?.product_id;
  const customerEmail = session.customer_details?.email || session.customer_email;

  if (!productId || !customerEmail) {
    return { processed: false, message: 'Missing product_id or customer_email in session' };
  }

  const userId = session.metadata?.user_id || null;

  // Read the pending row only for metadata recovery; the RPC owns reconciliation.
  const { data: existingTransaction } = await supabase
    .from('payment_transactions')
    .select('id, status, stripe_payment_intent_id, custom_field_values')
    .eq('session_id', sessionId)
    .maybeSingle();

  // Extract metadata
  const bumpProductIdsStr = session.metadata?.bump_product_ids || '';
  const bumpProductId = session.metadata?.bump_product_id || null;
  const hasBump = session.metadata?.has_bump === 'true';
  const couponId = session.metadata?.coupon_id || null;
  const hasCoupon = session.metadata?.has_coupon === 'true';

  // Parse bump IDs: prefer comma-separated bump_product_ids, fallback to single bump_product_id
  let bumpProductIds: string[] = bumpProductIdsStr
    ? bumpProductIdsStr.split(',').filter((id: string) => id.length > 0)
    : (hasBump && bumpProductId ? [bumpProductId] : []);

  // Get payment intent ID
  const stripePaymentIntentId = typeof session.payment_intent === 'object'
    ? session.payment_intent?.id
    : session.payment_intent;

  // Detect metadata truncation: bump_count tells us how many bumps were selected
  const expectedBumpCount = parseInt(session.metadata?.bump_count || '0', 10);
  if (expectedBumpCount > 0 && bumpProductIds.length < expectedBumpCount) {
    console.warn(
      '[stripe-webhook] BUMP_METADATA_TRUNCATED | session=%s | expected=%d | got=%d — fetching line items from Stripe',
      sessionId, expectedBumpCount, bumpProductIds.length
    );
    try {
      const stripe = await getStripeServer();
      const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
        limit: 100,
        expand: ['data.price.product'],
      });
      const recoveredIds: string[] = [];
      for (const li of lineItems.data) {
        const product = li.price?.product;
        if (typeof product === 'object' && product && 'metadata' in product) {
          const meta = (product as Stripe.Product).metadata;
          if (meta?.is_bump === 'true' && meta?.product_id) {
            recoveredIds.push(meta.product_id);
          }
        }
      }
      if (recoveredIds.length >= expectedBumpCount) {
        bumpProductIds = recoveredIds;
        console.info('[stripe-webhook] Recovered %d bump IDs from Stripe line items', recoveredIds.length);
      }
    } catch (lineItemErr) {
      console.error('[stripe-webhook] Failed to recover bump IDs from Stripe line items:', lineItemErr);
    }

    if (bumpProductIds.length < expectedBumpCount && existingTransaction) {
      const { data: pendingTx } = await supabase
        .from('payment_transactions')
        .select('metadata')
        .eq('id', existingTransaction.id)
        .single();
      const fullBumpIds = (pendingTx?.metadata as Record<string, unknown>)?.bump_product_ids_full;
      if (Array.isArray(fullBumpIds) && fullBumpIds.length >= expectedBumpCount) {
        bumpProductIds = fullBumpIds as string[];
        console.info('[stripe-webhook] Recovered %d bump IDs from pending Checkout Session metadata', fullBumpIds.length);
      }
    }
  }

  // Process payment using database function (multi-bump aware)
  const { data: rawResult, error } = await supabase.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: sessionId,
    product_id_param: productId,
    customer_email_param: customerEmail,
    amount_total: session.amount_total || 0,
    currency_param: session.currency || 'usd',
    stripe_payment_intent_id: stripePaymentIntentId || undefined,
    user_id_param: userId && userId !== '' ? userId : undefined,
    bump_product_ids_param: bumpProductIds.length > 0 ? bumpProductIds : undefined,
    coupon_id_param: hasCoupon && couponId ? couponId : undefined,
    // Net subtotal: net-priced products validate the NET amount, not the gross.
    amount_subtotal_param: session.amount_subtotal ?? undefined,
  });
  const result = rawResult as Record<string, unknown> | null;

  if (error) {
    console.error(
      '[stripe-webhook] PAYMENT_DB_FAILURE | session=%s | product=%s | email=%s | coupon_id=%s | amount=%d cents | error=%s (code=%s)',
      sessionId, productId, redactEmail(customerEmail), couponId ?? 'none',
      session.amount_total, error.message, error.code
    );
    return { processed: false, message: 'Payment processing failed' };
  }

  if (!result?.success) {
    console.error(
      '[stripe-webhook] PAYMENT_DB_REJECTED | session=%s | product=%s | email=%s | coupon_id=%s | amount=%d cents | reason=%s',
      sessionId, productId, redactEmail(customerEmail), couponId ?? 'none',
      session.amount_total, result?.error ?? 'unknown'
    );
    return { processed: false, message: (result?.error as string) || 'Payment processing failed' };
  }

  await fulfillPaidOrder({
    source: 'stripe_webhook', supabase, stripe: await getStripeServer(), transactionId: result.transaction_id as string,
    sessionId, paymentIntentId: stripePaymentIntentId, productId,
    customerEmail, amount: session.amount_total || 0, currency: session.currency || 'usd',
    metadata: session.metadata, customerDetails: session.customer_details,
    isGuest: result.is_guest_purchase as boolean, couponId: hasCoupon ? couponId : null,
  });
  return { processed: true, message: `Payment processed: ${result.scenario}` };
}

/**
 * Process successful payment from payment intent (direct payment flow).
 */
export async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ processed: boolean; message: string }> {
  const productId = paymentIntent.metadata?.product_id;
  const customerEmail = paymentIntent.receipt_email || paymentIntent.metadata?.email;

  if (!productId || !customerEmail) {
    return { processed: false, message: 'Missing product_id or email in payment intent' };
  }

  const userId = paymentIntent.metadata?.user_id || null;

  const stripe = await getStripeServer();
  const ownerSessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntent.id, limit: 1 });
  const ownerSession = ownerSessions.data[0];
  if (ownerSession?.mode === 'subscription') return { processed: true, message: 'Subscription payment handled by invoice events' };
  const sessionId = ownerSession?.id || paymentIntent.id;

  // Recover pending metadata by either Stripe identifier.
  const { data: byPI } = await supabase
    .from('payment_transactions')
    .select('id, status, custom_field_values')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .maybeSingle();

  // Fallback: direct payment flow where PI id is also used as session_id.
  const { data: existingTransaction } = await supabase
    .from('payment_transactions')
    .select('id, status, custom_field_values')
    .eq('session_id', sessionId)
    .maybeSingle();

  // Extract metadata (multi-bump aware)
  const bumpProductIdsStr = paymentIntent.metadata?.bump_product_ids || '';
  const bumpProductId = paymentIntent.metadata?.bump_product_id || null;
  const hasBump = paymentIntent.metadata?.has_bump === 'true';
  const couponId = paymentIntent.metadata?.coupon_id || null;

  // Parse bump IDs: prefer comma-separated bump_product_ids, fallback to single bump_product_id
  let bumpProductIds: string[] = bumpProductIdsStr
    ? bumpProductIdsStr.split(',').filter((id: string) => id.length > 0)
    : (hasBump && bumpProductId ? [bumpProductId] : []);

  // Detect metadata truncation: bump_count tells us how many bumps were selected
  const expectedBumpCount = parseInt(paymentIntent.metadata?.bump_count || '0', 10);
  if (expectedBumpCount > 0 && bumpProductIds.length < expectedBumpCount) {
    console.warn(
      '[stripe-webhook] BUMP_METADATA_TRUNCATED | pi=%s | expected=%d | got=%d — checking pending transaction',
      paymentIntent.id, expectedBumpCount, bumpProductIds.length
    );
    // byPI covers checkout-session flow (row keyed by cs_xxx, linked via stripe_payment_intent_id);
    // existingTransaction covers direct-payment flow (row keyed by pi_xxx as session_id).
    const pendingTxRef = byPI ?? existingTransaction;
    if (pendingTxRef) {
      const { data: pendingTx } = await supabase
        .from('payment_transactions')
        .select('metadata')
        .eq('id', pendingTxRef.id)
        .single();
      const fullBumpIds = (pendingTx?.metadata as Record<string, unknown>)?.bump_product_ids_full;
      if (Array.isArray(fullBumpIds) && fullBumpIds.length >= expectedBumpCount) {
        bumpProductIds = fullBumpIds as string[];
        console.info('[stripe-webhook] Recovered %d bump IDs from pending transaction metadata', fullBumpIds.length);
      }
    }
  }

  // Net subtotal for the completion validator: net-priced products validate the NET amount,
  // not the gross (Stripe adds VAT on top of exclusive prices, and the gross varies by
  // jurisdiction under Stripe Tax). Resolve the owning Checkout Session for amount_subtotal;
  // fail-safe → null falls back to the legacy gross check. (stripe is reused by capture below.)
  const piAmountSubtotal = ownerSession?.amount_subtotal ?? undefined;

  // Process payment using database function (multi-bump aware)
  const { data: rawResult2, error } = await supabase.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: sessionId,
    product_id_param: productId,
    customer_email_param: customerEmail,
    amount_total: paymentIntent.amount,
    currency_param: paymentIntent.currency,
    stripe_payment_intent_id: paymentIntent.id,
    user_id_param: userId && userId !== '' ? userId : undefined,
    bump_product_ids_param: bumpProductIds.length > 0 ? bumpProductIds : undefined,
    coupon_id_param: couponId || undefined,
    amount_subtotal_param: piAmountSubtotal,
  });
  const result = rawResult2 as Record<string, unknown> | null;

  if (error) {
    console.error(
      '[stripe-webhook] PAYMENT_DB_FAILURE | pi=%s | product=%s | email=%s | coupon_id=%s | amount=%d cents | error=%s (code=%s)',
      paymentIntent.id, productId, redactEmail(customerEmail), couponId ?? 'none',
      paymentIntent.amount, error.message, error.code
    );
    return { processed: false, message: 'Payment processing failed' };
  }

  if (!result?.success) {
    console.error(
      '[stripe-webhook] PAYMENT_DB_REJECTED | pi=%s | product=%s | email=%s | coupon_id=%s | amount=%d cents | reason=%s',
      paymentIntent.id, productId, redactEmail(customerEmail), couponId ?? 'none',
      paymentIntent.amount, result?.error ?? 'unknown'
    );
    return { processed: false, message: (result?.error as string) || 'Payment processing failed' };
  }

  await fulfillPaidOrder({
    source: 'stripe_webhook', supabase, stripe, transactionId: result.transaction_id as string, sessionId,
    paymentIntentId: paymentIntent.id, productId,
    customerEmail, amount: paymentIntent.amount, currency: paymentIntent.currency,
    metadata: ownerSession?.metadata ?? paymentIntent.metadata, customerDetails: ownerSession?.customer_details,
    isGuest: result.is_guest_purchase as boolean, couponId,
  });
  return { processed: true, message: `Payment processed: ${result.scenario}` };
}
