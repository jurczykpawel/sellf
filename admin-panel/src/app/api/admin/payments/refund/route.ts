// app/api/admin/payments/refund/route.ts
// API endpoint for processing payment refunds

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripeServer } from '@/lib/stripe/server';
import { createAdminClient, createPlatformClient } from '@/lib/supabase/admin';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Authenticate before initializing service client
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);

    // Initialize service client only after auth header validation
    const stripe = await getStripeServer();
    const platformClient = createPlatformClient();

    const { data: { user }, error: authError } = await platformClient.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin (using admin_users table, consistent with other admin routes)
    const { data: adminUser } = await platformClient
      .from('admin_users')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!adminUser) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    // Use admin client for seller_main data operations
    const supabase = createAdminClient();

    // SECURITY: Rate limit refund operations (prevents abuse of compromised admin accounts)
    const rateLimitOk = await checkRateLimit(
      RATE_LIMITS.ADMIN_REFUND.actionType,
      RATE_LIMITS.ADMIN_REFUND.maxRequests,
      RATE_LIMITS.ADMIN_REFUND.windowMinutes,
      user.id
    );

    if (!rateLimitOk) {
      return NextResponse.json(
        { message: 'Rate limit exceeded. Maximum 10 refunds per hour.' },
        { status: 429 }
      );
    }

    const { transactionId, amount, reason } = await request.json();

    if (!transactionId) {
      return NextResponse.json(
        { message: 'Transaction ID is required' },
        { status: 400 }
      );
    }

    // Get transaction details from database
    const { data: transaction, error: transactionError } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('id', transactionId)
      .single();

    if (transactionError || !transaction) {
      return NextResponse.json({ message: 'Transaction not found' }, { status: 404 });
    }

    if (transaction.status !== 'completed') {
      return NextResponse.json(
        { message: 'Only completed transactions can be refunded' },
        { status: 400 }
      );
    }

    // SECURITY: Validate refund amount to prevent integer overflow/abuse
    const MAX_REFUND_AMOUNT = 99999999; // Same as DB constraint (~$999,999.99)
    const refundAmount = amount ? Number(amount) : transaction.amount;

    if (!Number.isInteger(refundAmount) || refundAmount <= 0) {
      return NextResponse.json(
        { message: 'Refund amount must be a positive integer (in cents)' },
        { status: 400 }
      );
    }

    if (refundAmount > MAX_REFUND_AMOUNT) {
      return NextResponse.json(
        { message: `Refund amount cannot exceed ${MAX_REFUND_AMOUNT} cents` },
        { status: 400 }
      );
    }

    const alreadyRefunded = transaction.refunded_amount || 0;
    const maxRefundable = transaction.amount - alreadyRefunded;

    if (refundAmount > maxRefundable) {
      return NextResponse.json(
        { message: `Refund amount (${refundAmount}) exceeds refundable amount (${maxRefundable})` },
        { status: 400 }
      );
    }

    // Process refund through Stripe
    // SECURITY: Use payment intent from DB, not client-supplied value
    const refundData: Stripe.RefundCreateParams = {
      payment_intent: transaction.stripe_payment_intent_id ?? undefined,
    };

    if (amount) {
      refundData.amount = refundAmount;
    }

    const VALID_REFUND_REASONS: Stripe.RefundCreateParams.Reason[] = [
      'duplicate', 'fraudulent', 'requested_by_customer',
    ];
    if (reason) {
      if (!VALID_REFUND_REASONS.includes(reason)) {
        return NextResponse.json(
          { message: `Invalid refund reason. Must be one of: ${VALID_REFUND_REASONS.join(', ')}` },
          { status: 400 }
        );
      }
      refundData.reason = reason;
    }

    const refund = await stripe.refunds.create(refundData);

    // Determine if this is a full or partial refund
    const totalRefunded = alreadyRefunded + (refund.amount ?? refundAmount);
    const isFullRefund = totalRefunded >= transaction.amount;

    // Update transaction status in database (optimistic lock on refunded_amount)
    const { data: updated, error: updateError } = await supabase
      .from('payment_transactions')
      .update({
        status: isFullRefund ? 'refunded' : 'completed',
        refund_id: refund.id,
        refunded_amount: totalRefunded,
        refunded_at: new Date().toISOString(),
        refunded_by: user.id,
        refund_reason: reason || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', transactionId)
      .eq('refunded_amount', alreadyRefunded)
      .select('id');

    if (updateError || !updated || updated.length === 0) {
      console.error('Error updating transaction (concurrent refund?):', updateError);
      return NextResponse.json(
        { message: 'Refund processed but failed to update database — possible concurrent refund' },
        { status: 409 }
      );
    }

    // Revoke all product access on full refund (main + bumps, user + guest)
    let accessRevocationFailed = false;

    if (isFullRefund) {
      const revocation = await revokeTransactionAccess(supabase, {
        transactionId: transaction.id,
        userId: transaction.user_id,
        productId: transaction.product_id,
        sessionId: transaction.session_id,
      });

      if (!revocation.success) {
        accessRevocationFailed = true;
        console.error('[admin-refund] Revocation warnings:', revocation.warnings);
      }
    }

    console.log(`[admin-refund] Refund processed by ${user.id}: txn=${transactionId} refund=${refund.id} amount=${refund.amount}`);

    return NextResponse.json({
      success: true,
      refund: {
        id: refund.id,
        amount: refund.amount,
        status: refund.status,
      },
      ...(accessRevocationFailed && {
        warning: 'Refund processed but access revocation failed. Remove user access manually.',
      }),
    });

  } catch (error) {
    console.error('Refund processing error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
