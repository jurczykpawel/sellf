/**
 * Stripe Webhook Handler
 *
 * SECURITY CRITICAL: This endpoint receives webhooks from Stripe.
 * - Always verify webhook signatures before processing
 * - Handle events idempotently (same event may be delivered multiple times)
 * - Return 200 quickly to avoid retries
 *
 * Handled Events:
 * - checkout.session.completed: Process successful checkout payments
 * - payment_intent.succeeded: Process successful direct payments
 * - charge.refunded: Revoke access when refund is processed externally
 * - charge.dispute.created: Revoke access when chargeback is initiated
 * - account.updated: Sync Stripe Connect onboarding status (marketplace)
 * - account.application.deauthorized: Handle seller disconnecting their Stripe account (marketplace)
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { verifyWebhookSignature, getStripeServer } from '@/lib/stripe/server';
import { WebhookService } from '@/lib/services/webhook-service';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import { trackServerSideConversion, generatePurchaseEventId } from '@/lib/tracking';
import { handleAccountUpdated, handleAccountDeauthorized } from '@/lib/stripe/connect';

// Supabase service client for database operations
const getServiceClient = (schema?: string) => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    ...(schema && { db: { schema } }),
  });
};

/**
 * Process successful payment from checkout session.
 * For marketplace payments (metadata.is_marketplace='true'), uses the seller's schema.
 */
async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  supabase: ReturnType<typeof getServiceClient>
): Promise<{ processed: boolean; message: string }> {
  const sessionId = session.id;
  const productId = session.metadata?.product_id;
  const customerEmail = session.customer_details?.email || session.customer_email;

  // Marketplace: route to seller's schema if present
  const sellerSchema = session.metadata?.seller_schema;
  if (sellerSchema && session.metadata?.is_marketplace === 'true') {
    supabase = getServiceClient(sellerSchema);
  }

  if (!productId || !customerEmail) {
    return { processed: false, message: 'Missing product_id or customer_email in session' };
  }

  // Idempotency check: Skip if already processed
  const { data: existingTransaction } = await supabase
    .from('payment_transactions')
    .select('id, status')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (existingTransaction) {
    return { processed: true, message: `Already processed: ${existingTransaction.id}` };
  }

  // Extract metadata
  const bumpProductIdsStr = session.metadata?.bump_product_ids || '';
  const bumpProductId = session.metadata?.bump_product_id || null;
  const hasBump = session.metadata?.has_bump === 'true';
  const couponId = session.metadata?.coupon_id || null;
  const hasCoupon = session.metadata?.has_coupon === 'true';
  const discountAmount = parseFloat(session.metadata?.discount_amount || '0') || 0;
  const userId = session.metadata?.user_id || null;

  // Parse bump IDs: prefer comma-separated bump_product_ids, fallback to single bump_product_id
  const bumpProductIds: string[] = bumpProductIdsStr
    ? bumpProductIdsStr.split(',').filter((id: string) => id.length > 0)
    : (hasBump && bumpProductId ? [bumpProductId] : []);

  // Get payment intent ID
  const stripePaymentIntentId = typeof session.payment_intent === 'object'
    ? session.payment_intent?.id
    : session.payment_intent;

  // Process payment using database function (multi-bump aware)
  const { data: result, error } = await supabase.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: sessionId,
    product_id_param: productId,
    customer_email_param: customerEmail,
    amount_total: session.amount_total || 0,
    currency_param: session.currency || 'usd',
    stripe_payment_intent_id: stripePaymentIntentId || null,
    user_id_param: userId && userId !== '' ? userId : null,
    bump_product_ids_param: bumpProductIds.length > 0 ? bumpProductIds : null,
    coupon_id_param: hasCoupon && couponId ? couponId : null,
  });

  if (error) {
    console.error(
      '[stripe-webhook] PAYMENT_DB_FAILURE | session=%s | product=%s | email=%s | coupon_id=%s | amount=%d cents | error=%s (code=%s)',
      sessionId, productId, customerEmail, couponId ?? 'none',
      session.amount_total, error.message, error.code
    );
    return { processed: false, message: 'Payment processing failed' };
  }

  if (!result?.success) {
    console.error(
      '[stripe-webhook] PAYMENT_DB_REJECTED | session=%s | product=%s | email=%s | coupon_id=%s | amount=%d cents | reason=%s',
      sessionId, productId, customerEmail, couponId ?? 'none',
      session.amount_total, result?.error ?? 'unknown'
    );
    return { processed: false, message: result?.error || 'Payment processing failed' };
  }

  // Trigger internal webhook for purchase.completed
  if (!result.already_had_access) {
    // Fetch detailed product info for webhook
    const { data: productDetails } = await supabase
      .from('products')
      .select('id, name, slug, price, currency, icon')
      .eq('id', productId)
      .single();

    // Fetch bump product info for all purchased bumps
    const bumpProductDetailsList: Array<{ id: string; name: string; slug: string; price: number; currency: string; icon: string | null }> = [];
    for (const bumpId of bumpProductIds) {
      const { data: bump } = await supabase
        .from('products')
        .select('id, name, slug, price, currency, icon')
        .eq('id', bumpId)
        .single();
      if (bump) bumpProductDetailsList.push(bump);
    }
    // Legacy compat: first bump for webhook payload
    const bumpProductDetails = bumpProductDetailsList[0] || null;

    // Server-side Purchase tracking via Facebook CAPI
    // Uses deterministic event_id for dedup with client-side (PaymentStatusView)
    const baseUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
    trackServerSideConversion({
      eventName: 'Purchase',
      eventId: generatePurchaseEventId(sessionId),
      eventSourceUrl: productDetails?.slug ? `${baseUrl}/p/${productDetails.slug}` : baseUrl,
      value: (session.amount_total || 0) / 100,
      currency: (session.currency || 'usd').toUpperCase(),
      items: [{
        item_id: productId,
        item_name: productDetails?.name || 'Unknown Product',
        price: (session.amount_total || 0) / 100,
        quantity: 1,
      }],
      orderId: sessionId,
      userEmail: customerEmail,
    }).catch(err => console.error('[Stripe Webhook] FB CAPI Purchase tracking error:', err));

    WebhookService.trigger('purchase.completed', {
      customer: {
        email: customerEmail,
        firstName: session.metadata?.first_name || null,
        lastName: session.metadata?.last_name || null,
        userId: userId
      },
      product: productDetails ? {
         id: productDetails.id,
         name: productDetails.name,
         slug: productDetails.slug,
         price: productDetails.price,
         currency: productDetails.currency,
         icon: productDetails.icon
      } : { id: productId },
      bumpProduct: bumpProductDetails ? {
         id: bumpProductDetails.id,
         name: bumpProductDetails.name,
         slug: bumpProductDetails.slug,
         price: bumpProductDetails.price,
         currency: bumpProductDetails.currency,
         icon: bumpProductDetails.icon
      } : null,
      bumpProducts: bumpProductDetailsList.length > 0 ? bumpProductDetailsList : null,
      order: {
        amount: session.amount_total,
        currency: session.currency,
        sessionId: sessionId,
        paymentIntentId: stripePaymentIntentId,
        couponId: hasCoupon && couponId ? couponId : null,
        isGuest: result.is_guest_purchase
      },
      source: 'stripe_webhook'
    }).catch(err => console.error('[Stripe Webhook] Internal webhook error:', err));
  }

  return { processed: true, message: `Payment processed: ${result.scenario}` };
}

/**
 * Process successful payment from payment intent (direct payment flow).
 * For marketplace payments (metadata.is_marketplace='true'), uses the seller's schema.
 */
async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  supabase: ReturnType<typeof getServiceClient>
): Promise<{ processed: boolean; message: string }> {
  const productId = paymentIntent.metadata?.product_id;
  const customerEmail = paymentIntent.receipt_email || paymentIntent.metadata?.email;

  // Marketplace: route to seller's schema if present
  const sellerSchema = paymentIntent.metadata?.seller_schema;
  if (sellerSchema && paymentIntent.metadata?.is_marketplace === 'true') {
    supabase = getServiceClient(sellerSchema);
  }

  if (!productId || !customerEmail) {
    return { processed: false, message: 'Missing product_id or email in payment intent' };
  }

  // Idempotency check: Skip only if already completed (not pending)
  // A pending row exists when the PI was created but not yet paid - the webhook
  // must still process it to convert it to completed.
  const { data: existingTransaction } = await supabase
    .from('payment_transactions')
    .select('id, status')
    .eq('session_id', paymentIntent.id)
    .maybeSingle();

  if (existingTransaction?.status === 'completed') {
    return { processed: true, message: `Already processed: ${existingTransaction.id}` };
  }

  // Extract metadata (multi-bump aware)
  const bumpProductIdsStr = paymentIntent.metadata?.bump_product_ids || '';
  const bumpProductId = paymentIntent.metadata?.bump_product_id || null;
  const hasBump = paymentIntent.metadata?.has_bump === 'true';
  const couponId = paymentIntent.metadata?.coupon_id || null;
  const userId = paymentIntent.metadata?.user_id || null;

  // Parse bump IDs: prefer comma-separated bump_product_ids, fallback to single bump_product_id
  const bumpProductIds: string[] = bumpProductIdsStr
    ? bumpProductIdsStr.split(',').filter((id: string) => id.length > 0)
    : (hasBump && bumpProductId ? [bumpProductId] : []);

  // Process payment using database function (multi-bump aware)
  const { data: result, error } = await supabase.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: paymentIntent.id,
    product_id_param: productId,
    customer_email_param: customerEmail,
    amount_total: paymentIntent.amount,
    currency_param: paymentIntent.currency,
    stripe_payment_intent_id: paymentIntent.id,
    user_id_param: userId && userId !== '' ? userId : null,
    bump_product_ids_param: bumpProductIds.length > 0 ? bumpProductIds : null,
    coupon_id_param: couponId || null,
  });

  if (error) {
    console.error(
      '[stripe-webhook] PAYMENT_DB_FAILURE | pi=%s | product=%s | email=%s | coupon_id=%s | amount=%d cents | error=%s (code=%s)',
      paymentIntent.id, productId, customerEmail, couponId ?? 'none',
      paymentIntent.amount, error.message, error.code
    );
    return { processed: false, message: 'Payment processing failed' };
  }

  if (!result?.success) {
    console.error(
      '[stripe-webhook] PAYMENT_DB_REJECTED | pi=%s | product=%s | email=%s | coupon_id=%s | amount=%d cents | reason=%s',
      paymentIntent.id, productId, customerEmail, couponId ?? 'none',
      paymentIntent.amount, result?.error ?? 'unknown'
    );
    return { processed: false, message: result?.error || 'Payment processing failed' };
  }

  // Trigger internal webhook for purchase.completed
  if (!result.already_had_access) {
    // Fetch detailed product info for webhook
    const { data: productDetails } = await supabase
      .from('products')
      .select('id, name, slug, price, currency, icon')
      .eq('id', productId)
      .single();

    // Fetch bump product info for all purchased bumps
    const bumpProductDetailsList: Array<{ id: string; name: string; slug: string; price: number; currency: string; icon: string | null }> = [];
    for (const bumpId of bumpProductIds) {
      const { data: bump } = await supabase
        .from('products')
        .select('id, name, slug, price, currency, icon')
        .eq('id', bumpId)
        .single();
      if (bump) bumpProductDetailsList.push(bump);
    }
    const bumpProductDetails = bumpProductDetailsList[0] || null;

    // Server-side Purchase tracking via Facebook CAPI
    const baseUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
    trackServerSideConversion({
      eventName: 'Purchase',
      eventId: generatePurchaseEventId(paymentIntent.id),
      eventSourceUrl: productDetails?.slug ? `${baseUrl}/p/${productDetails.slug}` : baseUrl,
      value: (paymentIntent.amount || 0) / 100,
      currency: (paymentIntent.currency || 'usd').toUpperCase(),
      items: [{
        item_id: productId,
        item_name: productDetails?.name || 'Unknown Product',
        price: (paymentIntent.amount || 0) / 100,
        quantity: 1,
      }],
      orderId: paymentIntent.id,
      userEmail: customerEmail,
    }).catch(err => console.error('[Stripe Webhook] FB CAPI Purchase tracking error:', err));

    WebhookService.trigger('purchase.completed', {
      customer: {
        email: customerEmail,
        firstName: paymentIntent.metadata?.first_name || null,
        lastName: paymentIntent.metadata?.last_name || null,
        userId: userId
      },
      product: productDetails ? {
         id: productDetails.id,
         name: productDetails.name,
         slug: productDetails.slug,
         price: productDetails.price,
         currency: productDetails.currency,
         icon: productDetails.icon
      } : { id: productId },
      bumpProduct: bumpProductDetails ? {
         id: bumpProductDetails.id,
         name: bumpProductDetails.name,
         slug: bumpProductDetails.slug,
         price: bumpProductDetails.price,
         currency: bumpProductDetails.currency,
         icon: bumpProductDetails.icon
      } : null,
      bumpProducts: bumpProductDetailsList.length > 0 ? bumpProductDetailsList : null,
      order: {
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        paymentIntentId: paymentIntent.id,
        couponId: couponId || null,
        isGuest: result.is_guest_purchase
      },
      source: 'stripe_webhook'
    }).catch(err => console.error('[Stripe Webhook] Internal webhook error:', err));
  }

  return { processed: true, message: `Payment processed: ${result.scenario}` };
}

/**
 * Handle refund - revoke product access
 */
async function handleChargeRefunded(
  charge: Stripe.Charge,
  supabase: ReturnType<typeof getServiceClient>
): Promise<{ processed: boolean; message: string }> {
  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id;

  if (!paymentIntentId) {
    return { processed: false, message: 'No payment_intent in charge' };
  }

  // Find transaction by payment intent ID (include session_id for guest cleanup)
  const { data: transaction, error: txError } = await supabase
    .from('payment_transactions')
    .select('id, user_id, product_id, status, session_id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (txError || !transaction) {
    // Also try finding by session_id (for payment intent flow)
    const { data: txBySession } = await supabase
      .from('payment_transactions')
      .select('id, user_id, product_id, status, session_id')
      .eq('session_id', paymentIntentId)
      .maybeSingle();

    if (!txBySession) {
      return { processed: false, message: 'Transaction not found for refund' };
    }

    return await processRefundForTransaction(txBySession, charge, supabase);
  }

  return await processRefundForTransaction(transaction, charge, supabase);
}

async function processRefundForTransaction(
  transaction: { id: string; user_id: string | null; product_id: string; status: string; session_id: string | null },
  charge: Stripe.Charge,
  supabase: ReturnType<typeof getServiceClient>
): Promise<{ processed: boolean; message: string }> {
  // Idempotency: Skip if already refunded
  if (transaction.status === 'refunded') {
    return { processed: true, message: 'Already refunded' };
  }

  // Determine if this is a full or partial refund
  const isFullRefund = charge.amount_refunded >= charge.amount;

  // Update transaction status
  const { error: updateError } = await supabase
    .from('payment_transactions')
    .update({
      status: isFullRefund ? 'refunded' : 'completed',
      refund_id: charge.refunds?.data?.[0]?.id || null,
      refunded_amount: charge.amount_refunded,
      refunded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', transaction.id);

  if (updateError) {
    console.error('[Stripe Webhook] Failed to update refund status:', updateError);
    return { processed: false, message: 'Failed to update transaction status' };
  }

  // Only revoke access on full refund
  if (!isFullRefund) {
    return { processed: true, message: `Partial refund recorded (${charge.amount_refunded}/${charge.amount} cents)` };
  }

  // SECURITY: Revoke all product access (main + bumps, user + guest)
  // session_id already fetched in initial query — no re-fetch needed
  const revocation = await revokeTransactionAccess(supabase, {
    transactionId: transaction.id,
    userId: transaction.user_id,
    productId: transaction.product_id,
    sessionId: transaction.session_id,
  });

  if (revocation.warnings.length > 0) {
    console.error('[Stripe Webhook] Revocation warnings after refund:', revocation.warnings);
  }

  return { processed: true, message: 'Full refund processed and access revoked (main + bumps)' };
}

/**
 * Handle dispute/chargeback - revoke product access immediately
 */
async function handleChargeDisputeCreated(
  dispute: Stripe.Dispute,
  supabase: ReturnType<typeof getServiceClient>
): Promise<{ processed: boolean; message: string }> {
  const chargeId = typeof dispute.charge === 'string'
    ? dispute.charge
    : dispute.charge?.id;

  if (!chargeId) {
    return { processed: false, message: 'No charge in dispute' };
  }

  // Get charge details to find payment intent
  const stripe = await getStripeServer();
  if (!stripe) {
    return { processed: false, message: 'Stripe not configured' };
  }

  let charge: Stripe.Charge;
  try {
    charge = await stripe.charges.retrieve(chargeId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Stripe Webhook] Failed to retrieve charge ${chargeId}:`, msg);
    return { processed: false, message: `Failed to retrieve charge: ${msg}` };
  }

  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id;

  if (!paymentIntentId) {
    return { processed: false, message: 'No payment_intent in disputed charge' };
  }

  // Find transaction (include session_id for guest cleanup)
  const { data: transaction } = await supabase
    .from('payment_transactions')
    .select('id, user_id, product_id, status, session_id')
    .or(`stripe_payment_intent_id.eq.${paymentIntentId},session_id.eq.${paymentIntentId}`)
    .maybeSingle();

  if (!transaction) {
    return { processed: false, message: 'Transaction not found for dispute' };
  }

  // Update transaction status to disputed
  const { error: updateError } = await supabase
    .from('payment_transactions')
    .update({
      status: 'disputed',
      updated_at: new Date().toISOString(),
      metadata: {
        dispute_id: dispute.id,
        dispute_reason: dispute.reason,
        dispute_status: dispute.status,
        dispute_created: new Date(dispute.created * 1000).toISOString(),
      },
    })
    .eq('id', transaction.id);

  if (updateError) {
    console.error('[Stripe Webhook] Failed to update dispute status:', updateError);
  }

  // SECURITY: Immediately revoke all product access (main + bumps, user + guest)
  const revocation = await revokeTransactionAccess(supabase, {
    transactionId: transaction.id,
    userId: transaction.user_id,
    productId: transaction.product_id,
    sessionId: transaction.session_id,
  });

  if (revocation.warnings.length > 0) {
    console.error('[Stripe Webhook] Revocation warnings after dispute:', revocation.warnings);
  }

  return { processed: true, message: 'Dispute recorded and access revoked (main + bumps)' };
}

/**
 * Main webhook handler
 */
export async function POST(request: NextRequest) {
  // Rate limit to prevent webhook endpoint flooding
  const { maxRequests, windowMinutes, actionType } = RATE_LIMITS.STRIPE_WEBHOOK;
  const allowed = await checkRateLimit(actionType, maxRequests, windowMinutes);
  if (!allowed) {
    // 429 tells Stripe to retry with exponential backoff
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let event: Stripe.Event;

  // SECURITY: Get raw body for signature verification
  // The body must not be parsed/modified before verification
  const body = await request.text();

  // Get Stripe signature header
  const headersList = await headers();
  const signature = headersList.get('stripe-signature');

  if (!signature) {
    console.error('[Stripe Webhook] Missing stripe-signature header');
    return NextResponse.json(
      { error: 'Missing signature' },
      { status: 400 }
    );
  }

  // SECURITY: Verify webhook signature
  try {
    event = await verifyWebhookSignature(body, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Stripe Webhook] Signature verification failed:', message);
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }

  // Initialize Supabase client
  let supabase: ReturnType<typeof getServiceClient>;
  try {
    supabase = getServiceClient();
  } catch (err) {
    console.error('[Stripe Webhook] Failed to initialize Supabase:', err);
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  // Log received event (without sensitive data)
  console.log(`[Stripe Webhook] Received: ${event.type} (${event.id})`);

  // Handle events
  let result: { processed: boolean; message: string };

  // Events where failure to process means we MUST retry (access revocation is critical)
  const RETRIABLE_EVENTS = new Set([
    'charge.refunded',
    'charge.dispute.created',
  ]);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        // Only process if payment is complete (not async payment methods)
        if (session.payment_status === 'paid') {
          result = await handleCheckoutSessionCompleted(session, supabase);
        } else {
          result = { processed: true, message: 'Skipped: payment not yet paid' };
        }
        break;
      }

      case 'checkout.session.async_payment_succeeded': {
        // Handle delayed payment methods (bank transfers, etc.)
        const session = event.data.object as Stripe.Checkout.Session;
        result = await handleCheckoutSessionCompleted(session, supabase);
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        result = await handlePaymentIntentSucceeded(paymentIntent, supabase);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        result = await handleChargeRefunded(charge, supabase);
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        result = await handleChargeDisputeCreated(dispute, supabase);
        break;
      }

      // ===== STRIPE CONNECT EVENTS =====

      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        result = await handleAccountUpdated(account);
        break;
      }

      case 'account.application.deauthorized': {
        // event.account contains the connected account ID that deauthorized
        const connectedAccountId = event.account;
        if (connectedAccountId) {
          result = await handleAccountDeauthorized(connectedAccountId);
        } else {
          result = { processed: true, message: 'No account ID in deauthorization event' };
        }
        break;
      }

      default:
        // Acknowledge unhandled events without error
        result = { processed: true, message: `Unhandled event type: ${event.type}` };
    }

    console.log(`[Stripe Webhook] ${event.type}: ${result.message}`);

    // Always return 200 for valid webhooks to prevent retries
    // SECURITY: Minimal response — don't leak event details or internal processing info
    return NextResponse.json({ received: true });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Stripe Webhook] Error processing ${event.type}:`, message);

    // SECURITY: For refund/dispute events, return 500 so Stripe retries.
    // A transient DB outage during revocation could cause permanent access retention.
    if (RETRIABLE_EVENTS.has(event.type)) {
      return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
    }

    // For payment events, return 200 to prevent infinite retries.
    // Payment processing failures are logged and can be reconciled manually.
    return NextResponse.json({ received: true });
  }
}

/**
 * Reject other HTTP methods
 */
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
}
