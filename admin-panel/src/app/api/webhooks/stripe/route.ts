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
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { verifyWebhookSignature, getStripeServer } from '@/lib/stripe/server';
import { WebhookService } from '@/lib/services/webhook-service';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';
import { trackServerSideConversion, generatePurchaseEventId } from '@/lib/tracking';

// Supabase service client for database operations
const getServiceClient = () => {
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
  });
};

/**
 * Process successful payment from checkout session
 */
async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  supabase: ReturnType<typeof getServiceClient>
): Promise<{ processed: boolean; message: string }> {
  const sessionId = session.id;
  const productId = session.metadata?.product_id;
  const customerEmail = session.customer_details?.email || session.customer_email;

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
  const bumpProductId = session.metadata?.bump_product_id || null;
  const hasBump = session.metadata?.has_bump === 'true';
  const couponId = session.metadata?.coupon_id || null;
  const hasCoupon = session.metadata?.has_coupon === 'true';
  const discountAmount = parseFloat(session.metadata?.discount_amount || '0') || 0;
  const userId = session.metadata?.user_id || null;

  // Get payment intent ID
  const stripePaymentIntentId = typeof session.payment_intent === 'object'
    ? session.payment_intent?.id
    : session.payment_intent;

  // Process payment using database function
  const { data: result, error } = await supabase.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: sessionId,
    product_id_param: productId,
    customer_email_param: customerEmail,
    amount_total: session.amount_total || 0,
    currency_param: session.currency || 'usd',
    stripe_payment_intent_id: stripePaymentIntentId || null,
    user_id_param: userId && userId !== '' ? userId : null,
    bump_product_id_param: hasBump && bumpProductId ? bumpProductId : null,
    coupon_id_param: hasCoupon && couponId ? couponId : null,
  });

  if (error) {
    console.error('[Stripe Webhook] Payment processing error:', error);
    return { processed: false, message: 'Payment processing failed' };
  }

  if (!result?.success) {
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

    // Fetch bump product info if exists
    let bumpProductDetails = null;
    if (hasBump && bumpProductId) {
       const { data: bump } = await supabase
        .from('products')
        .select('id, name, slug, price, currency, icon')
        .eq('id', bumpProductId)
        .single();
       bumpProductDetails = bump;
    }

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
 * Process successful payment from payment intent (direct payment flow)
 */
async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  supabase: ReturnType<typeof getServiceClient>
): Promise<{ processed: boolean; message: string }> {
  const productId = paymentIntent.metadata?.product_id;
  const customerEmail = paymentIntent.receipt_email || paymentIntent.metadata?.email;

  if (!productId || !customerEmail) {
    return { processed: false, message: 'Missing product_id or email in payment intent' };
  }

  // Idempotency check: Skip if already processed
  const { data: existingTransaction } = await supabase
    .from('payment_transactions')
    .select('id, status')
    .eq('session_id', paymentIntent.id)
    .maybeSingle();

  if (existingTransaction) {
    return { processed: true, message: `Already processed: ${existingTransaction.id}` };
  }

  // Extract metadata
  const bumpProductId = paymentIntent.metadata?.bump_product_id || null;
  const hasBump = paymentIntent.metadata?.has_bump === 'true';
  const couponId = paymentIntent.metadata?.coupon_id || null;
  const hasCoupon = paymentIntent.metadata?.has_coupon === 'true';
  const discountAmount = parseFloat(paymentIntent.metadata?.discount_amount || '0') || 0;
  const userId = paymentIntent.metadata?.user_id || null;

  // Process payment using database function
  const { data: result, error } = await supabase.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: paymentIntent.id,
    product_id_param: productId,
    customer_email_param: customerEmail,
    amount_total: paymentIntent.amount,
    currency_param: paymentIntent.currency,
    stripe_payment_intent_id: paymentIntent.id,
    user_id_param: userId && userId !== '' ? userId : null,
    bump_product_id_param: hasBump && bumpProductId ? bumpProductId : null,
    coupon_id_param: hasCoupon && couponId ? couponId : null,
  });

  if (error) {
    console.error('[Stripe Webhook] Payment intent processing error:', error);
    return { processed: false, message: 'Payment processing failed' };
  }

  if (!result?.success) {
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

    // Fetch bump product info if exists
    let bumpProductDetails = null;
    if (hasBump && bumpProductId) {
       const { data: bump } = await supabase
        .from('products')
        .select('id, name, slug, price, currency, icon')
        .eq('id', bumpProductId)
        .single();
       bumpProductDetails = bump;
    }

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
      order: {
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        paymentIntentId: paymentIntent.id,
        couponId: hasCoupon && couponId ? couponId : null,
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

  // Find transaction by payment intent ID
  const { data: transaction, error: txError } = await supabase
    .from('payment_transactions')
    .select('id, user_id, product_id, status')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (txError || !transaction) {
    // Also try finding by session_id (for payment intent flow)
    const { data: txBySession } = await supabase
      .from('payment_transactions')
      .select('id, user_id, product_id, status')
      .eq('session_id', paymentIntentId)
      .maybeSingle();

    if (!txBySession) {
      return { processed: false, message: 'Transaction not found for refund' };
    }

    // Use the transaction found by session_id
    return await processRefundForTransaction(txBySession, charge, supabase);
  }

  return await processRefundForTransaction(transaction, charge, supabase);
}

async function processRefundForTransaction(
  transaction: { id: string; user_id: string | null; product_id: string; status: string },
  charge: Stripe.Charge,
  supabase: ReturnType<typeof getServiceClient>
): Promise<{ processed: boolean; message: string }> {
  // Idempotency: Skip if already refunded
  if (transaction.status === 'refunded') {
    return { processed: true, message: 'Already refunded' };
  }

  // Update transaction status
  const { error: updateError } = await supabase
    .from('payment_transactions')
    .update({
      status: 'refunded',
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

  // SECURITY: Revoke product access
  if (transaction.user_id && transaction.product_id) {
    const { error: revokeError } = await supabase
      .from('user_product_access')
      .delete()
      .eq('user_id', transaction.user_id)
      .eq('product_id', transaction.product_id);

    if (revokeError) {
      console.error('[Stripe Webhook] Failed to revoke access after refund:', revokeError);
    }
  }

  // Also clean up guest purchases (session-based access)
  if (transaction.id) {
    const { data: txFull } = await supabase
      .from('payment_transactions')
      .select('session_id, product_id')
      .eq('id', transaction.id)
      .single();

    if (txFull?.session_id && txFull?.product_id) {
      const { error: guestRevokeError } = await supabase
        .from('guest_purchases')
        .delete()
        .eq('session_id', txFull.session_id);

      if (guestRevokeError) {
        console.error('[Stripe Webhook] Failed to revoke guest purchase after refund:', guestRevokeError);
      }
    }
  }

  return { processed: true, message: 'Refund processed and access revoked' };
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
  const charge = await stripe.charges.retrieve(chargeId);

  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id;

  if (!paymentIntentId) {
    return { processed: false, message: 'No payment_intent in disputed charge' };
  }

  // Find transaction
  const { data: transaction } = await supabase
    .from('payment_transactions')
    .select('id, user_id, product_id, status')
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

  // SECURITY: Immediately revoke product access on dispute
  if (transaction.user_id && transaction.product_id) {
    const { error: revokeError } = await supabase
      .from('user_product_access')
      .delete()
      .eq('user_id', transaction.user_id)
      .eq('product_id', transaction.product_id);

    if (revokeError) {
      console.error('[Stripe Webhook] Failed to revoke access after dispute:', revokeError);
    }
  }

  return { processed: true, message: 'Dispute recorded and access revoked' };
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

      default:
        // Acknowledge unhandled events without error
        result = { processed: true, message: `Unhandled event type: ${event.type}` };
    }

    console.log(`[Stripe Webhook] ${event.type}: ${result.message}`);

    // Always return 200 for valid webhooks to prevent retries
    return NextResponse.json({
      received: true,
      event_id: event.id,
      event_type: event.type,
      processed: result.processed,
      message: result.message,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Stripe Webhook] Error processing ${event.type}:`, message);

    // Return 200 anyway to prevent infinite retries
    // Stripe will retry on 5xx errors, but if we can't process now,
    // retrying likely won't help
    return NextResponse.json({
      received: true,
      event_id: event.id,
      event_type: event.type,
      processed: false,
      error: 'Internal processing error',
    });
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
