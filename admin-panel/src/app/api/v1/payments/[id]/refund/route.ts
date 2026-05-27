/**
 * Payments API v1 - Refund Payment
 *
 * POST /api/v1/payments/:id/refund - Process a refund for a payment
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  successResponse,
  API_SCOPES,
} from '@/lib/api';
import { createPlatformClient } from '@/lib/supabase/admin';
import { validateUUID } from '@/lib/validations/product';
import { getStripeServer } from '@/lib/stripe/server';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import { emitRefundIssuedWebhook } from '@/lib/services/refund-webhook-payload';
import { scheduleSubscriptionCancelAfterFullRefund } from '@/lib/services/subscription-refund-cancel';
import Stripe from 'stripe';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * POST /api/v1/payments/:id/refund
 *
 * Process a full or partial refund for a payment transaction.
 *
 * Request body:
 * - amount: number (optional) - Refund amount in cents. If not provided, full refund.
 * - reason: 'duplicate' | 'fraudulent' | 'requested_by_customer' (optional)
 *
 * Returns:
 * - refund details including Stripe refund ID
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.PAYMENTS_REFUND]);
    const { id } = await params;

    // Validate ID + body BEFORE consuming the rate-limit budget so a bad
    // payload can't burn the admin's 10/h refund quota.
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid payment ID format');
    }

    let body: { amount?: unknown; reason?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is OK - means full refund
    }

    const { amount, reason } = body;

    if (amount !== undefined && amount !== null) {
      if (typeof amount !== 'number' || !Number.isFinite(amount)) {
        return apiError(request, 'INVALID_INPUT', 'Refund amount must be a number');
      }
      if (!Number.isInteger(amount) || amount <= 0) {
        return apiError(request, 'INVALID_INPUT', 'Refund amount must be a positive integer (in cents)');
      }
      const MAX_REFUND_AMOUNT = 99999999;
      if (amount > MAX_REFUND_AMOUNT) {
        return apiError(request, 'INVALID_INPUT', `Refund amount cannot exceed ${MAX_REFUND_AMOUNT} cents`);
      }
    }

    const validReasons = ['duplicate', 'fraudulent', 'requested_by_customer'];
    if (reason && !validReasons.includes(reason)) {
      return apiError(
        request,
        'INVALID_INPUT',
        `Invalid refund reason. Valid values: ${validReasons.join(', ')}`
      );
    }

    // Rate limit refund operations (prevents abuse)
    const rateLimitOk = await checkRateLimit(
      RATE_LIMITS.ADMIN_REFUND.actionType,
      RATE_LIMITS.ADMIN_REFUND.maxRequests,
      RATE_LIMITS.ADMIN_REFUND.windowMinutes,
      auth.admin.userId
    );

    if (!rateLimitOk) {
      return apiError(
        request,
        'RATE_LIMITED',
        'Rate limit exceeded. Maximum 10 refunds per hour.'
      );
    }

    // Get payment transaction
    const { data: payment, error } = await auth.supabase
      .from('payment_transactions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return apiError(request, 'NOT_FOUND', 'Payment not found');
      }
      console.error('Error fetching payment:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch payment');
    }

    if (payment.status !== 'completed') {
      return apiError(
        request,
        'INVALID_INPUT',
        'Only completed payments can be refunded'
      );
    }

    if (!payment.stripe_payment_intent_id) {
      return apiError(
        request,
        'INVALID_INPUT',
        'Payment does not have a Stripe payment intent'
      );
    }

    const refundAmount = amount ? Number(amount) : payment.amount;

    const alreadyRefunded = payment.refunded_amount || 0;
    const maxRefundable = payment.amount - alreadyRefunded;

    if (refundAmount > maxRefundable) {
      return apiError(
        request,
        'INVALID_INPUT',
        `Refund amount (${refundAmount}) exceeds refundable amount (${maxRefundable})`
      );
    }

    // Process refund through Stripe
    const stripe = await getStripeServer();

    const refundData: Stripe.RefundCreateParams = {
      payment_intent: payment.stripe_payment_intent_id,
    };

    if (amount) {
      refundData.amount = refundAmount;
    }

    if (reason) {
      refundData.reason = reason as Stripe.RefundCreateParams.Reason;
    }

    const stripeRefund = await stripe.refunds.create(refundData);

    // Determine new status - partial or full refund
    const totalRefunded = alreadyRefunded + (stripeRefund.amount ?? refundAmount);
    const isFullRefund = totalRefunded >= payment.amount;
    const nextStatus = isFullRefund ? 'refunded' : 'completed';
    const refundedAt = new Date().toISOString();

    // Update transaction in database with optimistic lock to prevent concurrent refunds
    const { data: updatedRows, error: updateError } = await auth.supabase
      .from('payment_transactions')
      .update({
        status: nextStatus,
        refund_id: stripeRefund.id,
        refunded_amount: totalRefunded,
        refunded_at: refundedAt,
        refunded_by: auth.admin.userId,
        refund_reason: reason || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('refunded_amount', alreadyRefunded)
      .select('id');

    if (updateError) {
      console.error('Error updating transaction:', updateError);
      return apiError(
        request,
        'INTERNAL_ERROR',
        'Refund processed but failed to update database. Please contact support.'
      );
    }

    // Revoke all product access on full refund (main + bumps, user + guest)
    // Do this regardless of optimistic lock result because the Stripe refund already succeeded
    let accessRevocationFailed = false;
    let subscriptionCancelFailed = false;

    if (isFullRefund) {
      const revocation = await revokeTransactionAccess(auth.supabase, {
        transactionId: id,
        userId: payment.user_id,
        productId: payment.product_id,
        sessionId: payment.session_id,
      });

      if (!revocation.success) {
        accessRevocationFailed = true;
        console.error('[refund] Revocation warnings:', revocation.warnings);
      }

      const cancelResult = await scheduleSubscriptionCancelAfterFullRefund({
        supabase: auth.supabase,
        stripe,
        transaction: payment,
      });
      if (!cancelResult.ok) {
        subscriptionCancelFailed = true;
        console.error('[refund] Subscription cancel scheduling failed:', cancelResult.reason);
      }
    }

    if (!updatedRows || updatedRows.length === 0) {
      console.error('[refund] Optimistic lock failed — concurrent refund detected for transaction:', id);
      return apiError(
        request,
        'CONFLICT',
        'Transaction was modified concurrently. The refund was processed in Stripe — please verify the transaction status.'
      );
    }

    await emitRefundIssuedWebhook({
      supabaseClient: auth.supabase,
      transaction: payment,
      stripeRefundId: stripeRefund.id,
      refundAmount: stripeRefund.amount ?? refundAmount,
      refundCurrency: stripeRefund.currency,
      refundReason: stripeRefund.reason || reason || null,
      refundStatus: stripeRefund.status,
      previousRefundedAmount: alreadyRefunded,
      totalRefunded,
      isFullRefund,
      statusBefore: payment.status,
      statusAfter: nextStatus,
      refundedAt,
      initiatedByAdminId: auth.admin.userId,
      source: 'api',
    });

    // Log the refund action (admin_actions is in public schema)
    const platformClient = createPlatformClient();
    await platformClient.from('admin_actions').insert({
      admin_id: auth.admin.userId,
      action: 'refund_processed',
      target_type: 'payment_transaction',
      target_id: id,
      details: {
        refund_id: stripeRefund.id,
        amount: stripeRefund.amount,
        reason: reason || null,
        via_api: true,
        access_revocation_failed: accessRevocationFailed,
      },
      created_at: new Date().toISOString(),
    });

    return jsonResponse(
      successResponse({
        payment_id: id,
        refund: {
          id: stripeRefund.id,
          amount: stripeRefund.amount,
          currency: stripeRefund.currency,
          status: stripeRefund.status,
          reason: stripeRefund.reason,
        },
        payment_status: nextStatus,
        total_refunded: totalRefunded,
        created_at: new Date().toISOString(),
        ...(accessRevocationFailed && {
          warning: 'Refund processed but access revocation failed. Remove user access manually.',
        }),
        ...(subscriptionCancelFailed && {
          subscription_warning: 'Refund processed but subscription cancellation scheduling failed. Cancel the Stripe subscription manually.',
        }),
      }),
      request
    );
  } catch (error) {
    // Handle Stripe-specific errors
    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe error during refund:', error);
      return apiError(
        request,
        'INVALID_INPUT',
        'Refund processing failed'
      );
    }
    return handleApiError(error, request);
  }
}
