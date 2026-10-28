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
 * Refund, dispute and subscription handling stay in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { abandonPendingCheckoutSession } from '@/lib/stripe/checkout-expiration';
import { verifyWebhookSignature, getStripeServer } from '@/lib/stripe/server';
import { revokeLicensesForOrder } from '@/lib/license-keys/revoke';
import { emitLicenseRevokedWebhooks } from '@/lib/services/license-revoke-webhook-payload';
import { emitRefundIssuedWebhook } from '@/lib/services/refund-webhook-payload';
import { getPaymentRefundStatus } from '@/lib/refunds/payment-status';
import { WebhookService } from '@/lib/services/webhook-service';
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
import { handleCheckoutSessionCompleted, handlePaymentIntentSucceeded } from './onetime-handlers';
import { readBodyWithByteLimit, ApiPayloadTooLargeError, DEFAULT_MAX_BODY_BYTES } from '@/lib/api/body-limit';
import { getCanonicalOriginOrNull } from '@/lib/utils/canonical-url';

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
  const paymentIntentId = typeof currentCharge.payment_intent === 'string'
    ? currentCharge.payment_intent : currentCharge.payment_intent?.id;
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
    // Charge is not from this account — acknowledge so Stripe stops retrying.
    return { processed: true, message: 'Transaction not found for refund, skipping' };
  }

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
  const chargeId = typeof currentRefund.charge === 'string'
    ? currentRefund.charge
    : currentRefund.charge?.id;

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

  // Revoke any offline license issued for this order so a refunded token stops working.
  const refundRevoked = await revokeLicensesForOrder(supabase, {
    productId: transaction.product_id,
    orderIds: [transaction.stripe_payment_intent_id, transaction.session_id],
  });
  // Notify integrations (Pro, fire-and-forget — never throws, so it can't redeliver this event).
  await emitLicenseRevokedWebhooks(
    supabase,
    refundRevoked.rows,
    getCanonicalOriginOrNull() ?? '',
  );

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
 * Handle dispute/chargeback - revoke product access immediately
 */
async function handleChargeDisputeCreated(
  dispute: Stripe.Dispute,
  supabase: ReturnType<typeof createAdminClient>,
  closed = false,
): Promise<{ processed: boolean; message: string }> {
  const chargeId = typeof dispute.charge === 'string'
    ? dispute.charge
    : dispute.charge?.id;

  if (!chargeId) {
    return { processed: true, message: 'No charge in dispute, skipping' };
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
    // Stripe raises StripeInvalidRequestError when the charge id is unknown
    // — that is a permanent state, retrying is pointless. Other error kinds
    // (network, rate limit, 5xx) are transient and should escalate to retry.
    const isUnknownResource =
      err instanceof Error &&
      (err as { type?: string }).type === 'StripeInvalidRequestError';
    if (isUnknownResource) {
      return { processed: true, message: `Charge ${chargeId} not found, skipping` };
    }
    return { processed: false, message: `Failed to retrieve charge: ${msg}` };
  }

  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id;

  if (!paymentIntentId) {
    return { processed: true, message: 'No payment_intent in disputed charge, skipping' };
  }

  // Find transaction by payment intent id or session id (include session_id for guest cleanup)
  const transaction = await findTransactionByOrderId<{
    id: string;
    user_id: string | null;
    product_id: string;
    status: string;
    session_id: string | null;
    customer_email: string;
    amount: number;
    currency: string;
    subscription_id: string | null;
    stripe_invoice_id: string | null;
    metadata: Record<string, unknown> | null;
  }>(supabase, paymentIntentId, 'id, user_id, product_id, status, session_id, customer_email, amount, currency, subscription_id, stripe_invoice_id, metadata');

  if (!transaction) {
    // Charge is not from this account — acknowledge so Stripe stops retrying.
    return { processed: true, message: 'Transaction not found for dispute, skipping' };
  }

  const metadata = transaction.metadata ?? {};
  if (!closed && metadata.dispute_id === dispute.id && ['won', 'lost'].includes(String(metadata.dispute_status))) {
    return { processed: true, message: 'Dispute already closed' };
  }
  const eventType = closed ? 'dispute.closed' : 'dispute.created';
  const notification = `${eventType}:${dispute.id}:${dispute.status}`;
  const shouldRevoke = dispute.status !== 'won';

  // Update transaction status to disputed
  const { error: updateError } = await supabase
    .from('payment_transactions')
    .update({
      status: shouldRevoke ? 'disputed' : transaction.status,
      updated_at: new Date().toISOString(),
      metadata: {
        ...metadata,
        dispute_id: dispute.id,
        dispute_reason: dispute.reason,
        dispute_status: dispute.status,
        dispute_created: new Date(dispute.created * 1000).toISOString(),
      },
    })
    .eq('id', transaction.id);

  if (updateError) {
    console.error('[Stripe Webhook] Failed to update dispute status:', updateError);
    return { processed: false, message: 'Failed to update dispute status' };
  }

  if (shouldRevoke) {
    // SECURITY: Immediately revoke all product access (main + bumps, user + guest)
    const revocation = await revokeTransactionAccess(supabase, {
      transactionId: transaction.id,
      userId: transaction.user_id,
      productId: transaction.product_id,
      sessionId: transaction.session_id,
    });

    if (revocation.warnings.length > 0) {
      console.error('[Stripe Webhook] Revocation warnings after dispute:', revocation.warnings);
      return { processed: false, message: 'Dispute access revocation incomplete' };
    }

    // Revoke any offline license issued for this order (chargeback = lost payment).
    const disputeRevoked = await revokeLicensesForOrder(supabase, {
      productId: transaction.product_id,
      orderIds: [paymentIntentId, transaction.session_id],
    });
    // Notify integrations (Pro, fire-and-forget — never throws, so it can't redeliver this event).
    await emitLicenseRevokedWebhooks(
      supabase,
      disputeRevoked.rows,
      getCanonicalOriginOrNull() ?? '',
    );

  }
  if (metadata.dispute_notification !== notification) {
    const { data: subscription } = transaction.subscription_id
      ? await supabase.from('subscriptions').select('stripe_subscription_id').eq('id', transaction.subscription_id).maybeSingle()
      : { data: null };
    await WebhookService.trigger(eventType, {
      customer: { email: transaction.customer_email, userId: transaction.user_id },
      product: { id: transaction.product_id },
      payment: { id: transaction.id, amount: transaction.amount, currency: transaction.currency,
        sessionId: transaction.session_id, paymentIntentId, stripeInvoiceId: transaction.stripe_invoice_id,
        subscriptionId: transaction.subscription_id },
      ...(transaction.subscription_id && { subscription: { id: transaction.subscription_id,
        stripeSubscriptionId: subscription?.stripe_subscription_id ?? null } }),
      dispute: { stripeDisputeId: dispute.id, stripeChargeId: chargeId, status: dispute.status,
        reason: dispute.reason, amount: dispute.amount, currency: dispute.currency.toUpperCase(),
        createdAt: new Date(dispute.created * 1000).toISOString(),
        accessRevoked: shouldRevoke, accessRestored: false },
    }, supabase, transaction.product_id);
    const { error } = await supabase.from('payment_transactions').update({ metadata: {
      ...metadata, dispute_id: dispute.id, dispute_reason: dispute.reason, dispute_status: dispute.status,
      dispute_created: new Date(dispute.created * 1000).toISOString(), dispute_notification: notification,
    } }).eq('id', transaction.id);
    if (error) return { processed: false, message: 'Failed to record dispute notification' };
  }

  return { processed: true, message: 'Dispute outcome recorded and integrations notified' };
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
        result = await handleChargeDisputeCreated(dispute, supabase, event.type === 'charge.dispute.closed');
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
