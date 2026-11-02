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
 * - refund.created / refund.updated: Revoke access when dashboard refunds
 *   are created or changed externally
 * - charge.dispute.created: Revoke access when chargeback is initiated
 *
 * NOTE: the one-time payment handlers (checkout.session.completed,
 * payment_intent.succeeded) live in ./onetime-handlers.ts; POST dispatches to them.
 * Dispute and subscription handlers live in sibling modules. Refund reconciliation stays here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { abandonPendingCheckoutSession } from '@/lib/stripe/checkout-expiration';
import { verifyWebhookSignature, getStripeServer } from '@/lib/stripe/server';
import { revokeLicensesForOrder } from '@/lib/license-keys/revoke';
import { emitRefundIssuedWebhook } from '@/lib/services/refund-webhook-payload';
import { pendingPaymentResult } from '@/lib/stripe/pending-payment';
import { getPaymentRefundStatus } from '@/lib/refunds/payment-status';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import { scheduleSubscriptionCancelAfterFullRefund } from '@/lib/services/subscription-refund-cancel';
import { findTransactionByOrderId } from '@/lib/services/transaction-lookup';
import { createAdminClient, createPlatformClient } from '@/lib/supabase/admin';
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleSubscriptionTrialWillEnd,
  handleInvoiceUpcoming,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
} from './subscription-handlers';
import { RETRIABLE_EVENTS, TERMINAL_FAILURE_REASONS } from './retriable-events';
import { handleChargeDispute } from './dispute-handlers';
import { handleCheckoutSessionCompleted, handlePaymentIntentSucceeded } from './onetime-handlers';
import { readBodyWithByteLimit, ApiPayloadTooLargeError, DEFAULT_MAX_BODY_BYTES } from '@/lib/api/body-limit';

// Stripe events — particularly ones with many expanded line items, invoices,
// or subscription phases — can run larger than a typical API JSON body.
// This keeps a generous multiple of the default cap so those still go
// through, while still bounding how much is read into memory before the
// signature check runs.
const STRIPE_WEBHOOK_MAX_BODY_BYTES = DEFAULT_MAX_BODY_BYTES * 5;

/**
 * Handle refund - revoke product access
 */
async function handleChargeRefunded(
  charge: Stripe.Charge,
  supabase: ReturnType<typeof createAdminClient>,
  stripe: Stripe,
  eventCreated: number,
  eventRefund?: Stripe.Refund,
  initialRefundStatus?: string | null,
): Promise<{ processed: boolean; message: string }> {
  if (!eventRefund && charge.amount_refunded === 0) {
    return { processed: true, message: 'No refund activity in charge, skipping' };
  }
  const currentCharge = eventRefund ? charge : await stripe.charges.retrieve(charge.id);
  let intent = currentCharge.payment_intent ?? eventRefund?.payment_intent;
  if (!intent) {
    const refunds = await stripe.refunds.list({ charge: currentCharge.id, limit: 1 });
    intent = refunds.data[0]?.payment_intent ?? null;
  }
  const paymentIntentId = typeof intent === 'string' ? intent : intent?.id;
  if (!paymentIntentId) {
    return { processed: true, message: 'No payment_intent in charge, skipping' };
  }

  // Find transaction by payment intent id or session id (include session_id for guest cleanup)
  const transaction = await findTransactionByOrderId<Parameters<typeof processRefundForTransaction>[0]>(
    supabase,
    paymentIntentId,
    'id, user_id, product_id, status, session_id, stripe_payment_intent_id, amount, currency, customer_email, refunded_amount, refund_id, refund_status, subscription_id',
  );

  if (!transaction) {
    return pendingPaymentResult(supabase, stripe, paymentIntentId);
  }

  if (transaction.status === 'pending') return { processed: false, message: 'Payment awaiting completion' };

  return await processRefundForTransaction(transaction, currentCharge, stripe, supabase, eventCreated, eventRefund, initialRefundStatus);
}

/**
 * Handle Stripe refund objects by resolving the underlying charge and
 * delegating to the charge-based refund processor.
 */
async function handleRefundEvent(
  refund: Stripe.Refund,
  stripe: Stripe,
  supabase: ReturnType<typeof createAdminClient>,
  eventCreated: number,
  created = false,
): Promise<{ processed: boolean; message: string }> {
  const currentRefund = await stripe.refunds.retrieve(refund.id);
  let chargeId = typeof currentRefund.charge === 'string'
    ? currentRefund.charge
    : currentRefund.charge?.id;

  if (!chargeId && currentRefund.payment_intent) {
    const intentId = typeof currentRefund.payment_intent === 'string'
      ? currentRefund.payment_intent : currentRefund.payment_intent.id;
    const intent = await stripe.paymentIntents.retrieve(intentId);
    chargeId = typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id;
    if (!chargeId) return { processed: false, message: 'Refund charge unavailable' };
  }
  if (!chargeId) {
    return { processed: true, message: 'No charge in refund event, skipping' };
  }

  const charge = await stripe.charges.retrieve(chargeId);
  return handleChargeRefunded(charge, supabase, stripe, eventCreated, currentRefund, created ? refund.status : undefined);
}

async function processRefundForTransaction(
  transaction: {
    id: string;
    user_id: string | null;
    product_id: string;
    status: string;
    session_id: string | null;
    stripe_payment_intent_id: string | null;
    amount: number;
    currency: string;
    customer_email: string | null;
    refunded_amount: number | null;
    refund_id?: string | null;
    refund_status?: string | null;
    subscription_id?: string | null;
  },
  charge: Stripe.Charge,
  stripe: Stripe,
  supabase: ReturnType<typeof createAdminClient>,
  eventCreated: number,
  eventRefund?: Stripe.Refund,
  initialRefundStatus?: string | null,
): Promise<{ processed: boolean; message: string }> {
  // Determine if this is a full or partial refund
  const isFullRefund = charge.amount_refunded >= charge.amount;
  const previousRefundedAmount = transaction.refunded_amount || 0;
  const nextStatus = getPaymentRefundStatus(charge.amount_refunded, charge.amount);
  const refundedAt = new Date().toISOString();
  let latestRefund = eventRefund ?? charge.refunds?.data
    ?.filter((refund) => refund.created <= eventCreated)
    .sort((a, b) => b.created - a.created)[0];
  if (!latestRefund?.id || !latestRefund.status) {
    const refunds = await stripe.refunds.list({
      charge: charge.id, created: { lte: eventCreated }, limit: 1,
    });
    latestRefund = refunds.data[0];
  }
  if (!latestRefund?.id || !latestRefund.status) {
    return { processed: false, message: 'Refund details unavailable' };
  }

  // Update transaction status
  const refundUpdate = supabase
    .from('payment_transactions')
    .update({
      status: nextStatus,
      refund_id: latestRefund.id,
      refund_status: latestRefund.status,
      refunded_amount: charge.amount_refunded,
      refunded_at: refundedAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', transaction.id)
    .eq('refunded_amount', previousRefundedAmount);
  const matchRefund = transaction.refund_id
    ? refundUpdate.eq('refund_id', transaction.refund_id) : refundUpdate.is('refund_id', null);
  const matchStatus = transaction.refund_status
    ? matchRefund.eq('refund_status', transaction.refund_status) : matchRefund.is('refund_status', null);
  const { data: updatedRows, error: updateError } = await matchStatus.select('id');

  if (updateError) {
    console.error('[Stripe Webhook] Failed to update refund status:', updateError);
    return { processed: false, message: 'Failed to update transaction status' };
  }

  if (!updatedRows?.length) return { processed: false, message: 'Refund state changed; retry required' };

  // Only revoke access on full refund. Revoke BEFORE notifying receivers, so a receiver that
  // reacts to a confirmed full refund never observes access that is still granted.
  if (isFullRefund) {
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
  }

  await emitRefundIssuedWebhook({
    supabaseClient: supabase,
    transaction,
    stripeRefundId: latestRefund.id,
    initialRefundStatus,
    refundAmount: latestRefund.amount,
    refundCurrency: latestRefund?.currency || charge.currency,
    refundReason: latestRefund?.reason || null,
    refundStatus: latestRefund?.status || null,
    previousRefundedAmount,
    totalRefunded: charge.amount_refunded,
    isFullRefund,
    statusBefore: transaction.status,
    statusAfter: nextStatus,
    refundedAt,
    source: 'stripe_webhook',
  });

  if (!isFullRefund) {
    return { processed: true, message: `Partial refund recorded (${charge.amount_refunded}/${charge.amount} cents)` };
  }

  // Revoke any offline license issued for this order so a refunded token stops working.
  await revokeLicensesForOrder(supabase, {
    productId: transaction.product_id,
    orderIds: [transaction.stripe_payment_intent_id, transaction.session_id],
  });
  const cancelResult = await scheduleSubscriptionCancelAfterFullRefund({
    supabase: supabase as never,
    stripe,
    transaction,
  });
  if (!cancelResult.ok) {
    console.error('[Stripe Webhook] Subscription cancel scheduling failed:', cancelResult.reason);
    return { processed: false, message: cancelResult.reason };
  }

  return { processed: true, message: 'Full refund processed and access revoked (main + bumps)' };
}

/**
 * Main webhook handler
 */
export async function POST(request: NextRequest) {
  let event: Stripe.Event;

  // SECURITY: Get raw body for signature verification
  // The body must not be parsed/modified before verification
  let body: string;
  try {
    body = await readBodyWithByteLimit(request, STRIPE_WEBHOOK_MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof ApiPayloadTooLargeError) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    throw err;
  }

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

  // SECURITY: Verify webhook signature BEFORE rate limiting.
  // Rate limiting after signature verification ensures only legitimate Stripe requests
  // consume rate limit quota — unauthenticated flood attempts are rejected first (400),
  // preventing DoS that would block real Stripe webhooks from being processed.
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

  // Rate limit AFTER signature verification — only legitimate Stripe events count.
  const { maxRequests, windowMinutes, actionType } = RATE_LIMITS.STRIPE_WEBHOOK;
  const allowed = await checkRateLimit(actionType, maxRequests, windowMinutes);
  if (!allowed) {
    // 429 tells Stripe to retry with exponential backoff
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  // Initialize Supabase client
  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
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
      case 'checkout.session.expired': {
        const session = event.data.object as Stripe.Checkout.Session;
        const expiration = await abandonPendingCheckoutSession(supabase, session.id);
        result = { processed: expiration.success, message: expiration.error ?? 'Pending checkout session abandoned' };
        break;
      }

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

      case 'charge.updated':
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const stripe = await getStripeServer();
        result = await handleChargeRefunded(charge, supabase, stripe, event.created);
        break;
      }

      case 'refund.created':
      case 'refund.failed':
      case 'charge.refund.updated':
      case 'refund.updated': {
        const refund = event.data.object as Stripe.Refund;
        const stripe = await getStripeServer();
        result = await handleRefundEvent(refund, stripe, supabase, event.created, event.type === 'refund.created');
        break;
      }

      case 'charge.dispute.closed':
      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        const stripe = await getStripeServer();
        result = await handleChargeDispute(dispute, supabase, stripe, event.type === 'charge.dispute.closed');
        break;
      }

      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription;
        const stripe = await getStripeServer();
        result = await handleSubscriptionCreated(sub, supabase, createPlatformClient(), stripe);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const stripe = await getStripeServer();
        const previousAttributes =
          (event.data.previous_attributes as Partial<Stripe.Subscription>) ?? undefined;
        result = await handleSubscriptionUpdated(
          sub,
          supabase,
          createPlatformClient(),
          stripe,
          previousAttributes
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const stripe = await getStripeServer();
        result = await handleSubscriptionDeleted(sub, supabase, createPlatformClient(), stripe);
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object as Stripe.Subscription;
        const stripe = await getStripeServer();
        result = await handleSubscriptionTrialWillEnd(
          sub,
          supabase,
          createPlatformClient(),
          stripe
        );
        break;
      }

      case 'customer.subscription.paused':
      case 'customer.subscription.resumed': {
        // MVP: no-op (we don't expose pause/resume yet).
        result = { processed: true, message: `No-op for ${event.type} (MVP)` };
        break;
      }

      case 'invoice.upcoming': {
        const invoice = event.data.object as Stripe.Invoice;
        const stripe = await getStripeServer();
        result = await handleInvoiceUpcoming(invoice, supabase, createPlatformClient(), stripe);
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const stripe = await getStripeServer();
        result = await handleInvoicePaid(invoice, supabase, createPlatformClient(), stripe);
        break;
      }

      case 'invoice.payment_failed':
      case 'invoice.payment_action_required': {
        const invoice = event.data.object as Stripe.Invoice;
        const stripe = await getStripeServer();
        result = await handleInvoicePaymentFailed(
          invoice,
          supabase,
          createPlatformClient(),
          stripe
        );
        break;
      }

      default:
        // Acknowledge unhandled events without error
        result = { processed: true, message: `Unhandled event type: ${event.type}` };
    }

    console.log(`[Stripe Webhook] ${event.type}: ${result.message}`);

    // Terminal data-inconsistency failures: ack 200 even on retriable events
    // so Stripe stops the retry storm (otherwise zombie subscriptions for
    // deleted products hammer the webhook until heap OOM).
    if (!result.processed && TERMINAL_FAILURE_REASONS.has(result.message)) {
      return NextResponse.json({ received: true, skipped: result.message });
    }

    // Force a Stripe retry on retriable events that returned processed:false
    // — by returning 500 the next webhook delivery re-attempts the work.
    if (!result.processed && RETRIABLE_EVENTS.has(event.type)) {
      return NextResponse.json(
        { error: 'Processing failed; will retry' },
        { status: 500 }
      );
    }

    // Always return 200 for valid webhooks to prevent retries
    // SECURITY: Minimal response — don't leak event details or internal processing info
    return NextResponse.json({ received: true });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Stripe Webhook] Error processing ${event.type}:`, message);

    // Retriable events return 500 so Stripe re-attempts delivery on transient errors.
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
