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
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import Stripe from 'stripe';
import { verifyWebhookSignature, getStripeServer } from '@/lib/stripe/server';
import { revokeLicensesForOrder } from '@/lib/license-keys/revoke';
import { emitLicenseRevokedWebhooks } from '@/lib/services/license-revoke-webhook-payload';
import { emitRefundIssuedWebhook } from '@/lib/services/refund-webhook-payload';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import { scheduleSubscriptionCancelAfterFullRefund } from '@/lib/services/subscription-refund-cancel';
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

/**
 * Handle refund - revoke product access
 */
async function handleChargeRefunded(
  charge: Stripe.Charge,
  supabase: ReturnType<typeof createAdminClient>,
  stripe: Stripe
): Promise<{ processed: boolean; message: string }> {
  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id;

  if (!paymentIntentId) {
    // Malformed event payload — there is nothing to retry, acknowledge.
    return { processed: true, message: 'No payment_intent in charge, skipping' };
  }

  // Find transaction by payment intent ID (include session_id for guest cleanup)
  const { data: transaction, error: txError } = await supabase
    .from('payment_transactions')
    .select('id, user_id, product_id, status, session_id, stripe_payment_intent_id, amount, currency, customer_email, refunded_amount, subscription_id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (txError || !transaction) {
    // Also try finding by session_id (for payment intent flow)
    const { data: txBySession } = await supabase
      .from('payment_transactions')
      .select('id, user_id, product_id, status, session_id, stripe_payment_intent_id, amount, currency, customer_email, refunded_amount, subscription_id')
      .eq('session_id', paymentIntentId)
      .maybeSingle();

    if (!txBySession) {
      // Charge is not from this account — acknowledge so Stripe stops retrying.
      return { processed: true, message: 'Transaction not found for refund, skipping' };
    }

    return await processRefundForTransaction(txBySession, charge, stripe, supabase);
  }

  return await processRefundForTransaction(transaction, charge, stripe, supabase);
}

/**
 * Handle Stripe refund objects by resolving the underlying charge and
 * delegating to the charge-based refund processor.
 */
async function handleRefundEvent(
  refund: Stripe.Refund,
  stripe: Stripe,
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ processed: boolean; message: string }> {
  const chargeId = typeof refund.charge === 'string'
    ? refund.charge
    : refund.charge?.id;

  if (!chargeId) {
    return { processed: true, message: 'No charge in refund event, skipping' };
  }

  const charge = await stripe.charges.retrieve(chargeId);
  return handleChargeRefunded(charge, supabase, stripe);
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
    subscription_id?: string | null;
  },
  charge: Stripe.Charge,
  stripe: Stripe,
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ processed: boolean; message: string }> {
  // Determine if this is a full or partial refund
  const isFullRefund = charge.amount_refunded >= charge.amount;
  const previousRefundedAmount = transaction.refunded_amount || 0;
  const nextStatus = isFullRefund ? 'refunded' : 'completed';
  const refundedAt = new Date().toISOString();
  const latestRefund = charge.refunds?.data?.[0];

  // A repeated partial refund event after a full refund should not downgrade state.
  // A repeated full refund event still attempts revocation so failed access cleanup
  // can be repaired by Stripe retries or manual event replays.
  if (transaction.status === 'refunded' && !isFullRefund) {
    return { processed: true, message: 'Already fully refunded' };
  }

  // Update transaction status
  const { error: updateError } = await supabase
    .from('payment_transactions')
    .update({
      status: nextStatus,
      refund_id: latestRefund?.id || null,
      refunded_amount: charge.amount_refunded,
      refunded_at: refundedAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', transaction.id);

  if (updateError) {
    console.error('[Stripe Webhook] Failed to update refund status:', updateError);
    return { processed: false, message: 'Failed to update transaction status' };
  }

  await emitRefundIssuedWebhook({
    supabaseClient: supabase,
    transaction,
    stripeRefundId: latestRefund?.id || null,
    // Delta since last recorded — NOT latestRefund.amount, which is only the single newest
    // refund. If Stripe coalesces multiple refunds into one delivery (or a dashboard refund
    // races), the delta = total - prev keeps refund.net/amount consistent with totalRefunded.
    refundAmount: Math.max(charge.amount_refunded - previousRefundedAmount, 0),
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
    process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || '',
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
  supabase: ReturnType<typeof createAdminClient>
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

  // Find transaction (include session_id for guest cleanup)
  const { data: transaction } = await supabase
    .from('payment_transactions')
    .select('id, user_id, product_id, status, session_id')
    .or(`stripe_payment_intent_id.eq.${paymentIntentId},session_id.eq.${paymentIntentId}`)
    .maybeSingle();

  if (!transaction) {
    // Charge is not from this account — acknowledge so Stripe stops retrying.
    return { processed: true, message: 'Transaction not found for dispute, skipping' };
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

  // Revoke any offline license issued for this order (chargeback = lost payment).
  const disputeRevoked = await revokeLicensesForOrder(supabase, {
    productId: transaction.product_id,
    orderIds: [paymentIntentId, transaction.session_id],
  });
  // Notify integrations (Pro, fire-and-forget — never throws, so it can't redeliver this event).
  await emitLicenseRevokedWebhooks(
    supabase,
    disputeRevoked.rows,
    process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || '',
  );

  return { processed: true, message: 'Dispute recorded and access revoked (main + bumps)' };
}

/**
 * Main webhook handler
 */
export async function POST(request: NextRequest) {
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
        const stripe = await getStripeServer();
        result = await handleChargeRefunded(charge, supabase, stripe);
        break;
      }

      case 'refund.created':
      case 'refund.updated': {
        const refund = event.data.object as Stripe.Refund;
        const stripe = await getStripeServer();
        result = await handleRefundEvent(refund, stripe, supabase);
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        result = await handleChargeDisputeCreated(dispute, supabase);
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
