// app/api/admin/payments/refund/route.ts
// API endpoint for processing payment refunds

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { getStripeServer } from '@/lib/stripe/server';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiting';

// Note: These must be read at runtime, not build time
const getSupabaseUrl = () => process.env.SUPABASE_URL!;
const getSupabaseServiceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    const stripe = await getStripeServer();

    // Initialize Supabase client with service role for admin operations
    const supabase = createClient(getSupabaseUrl(), getSupabaseServiceKey());

    // Get authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Extract and verify JWT token
    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin (using admin_users table, consistent with other admin routes)
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!adminUser) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

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

    const { transactionId, paymentIntentId, amount, reason } = await request.json();

    if (!transactionId || !paymentIntentId) {
      return NextResponse.json(
        { message: 'Transaction ID and Payment Intent ID are required' },
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
      payment_intent: transaction.stripe_payment_intent_id,
    };

    if (amount) {
      refundData.amount = refundAmount;
    }

    if (reason) {
      refundData.reason = reason as Stripe.RefundCreateParams.Reason;
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

    // Only revoke access on full refund
    if (isFullRefund) {
      if (transaction.user_id && transaction.product_id) {
        const { error: revokeError } = await supabase
          .from('user_product_access')
          .delete()
          .eq('user_id', transaction.user_id)
          .eq('product_id', transaction.product_id);

        if (revokeError) {
          console.error('Warning: Failed to revoke product access after refund:', revokeError);
        }
      }

      // Also revoke guest purchases after full refund
      if (transaction.session_id && transaction.product_id) {
        const { error: guestRevokeError } = await supabase
          .from('guest_purchases')
          .delete()
          .eq('session_id', transaction.session_id)
          .eq('product_id', transaction.product_id);

        if (guestRevokeError) {
          console.error('Warning: Failed to revoke guest purchase after refund:', guestRevokeError);
        }
      }
    }

    // Log the refund action
    await supabase.from('admin_actions').insert({
      admin_id: user.id,
      action: 'refund_processed',
      target_type: 'payment_transaction',
      target_id: transactionId,
      details: {
        refund_id: refund.id,
        amount: refund.amount,
        reason: reason || null,
      },
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      refund: {
        id: refund.id,
        amount: refund.amount,
        status: refund.status,
      },
    });

  } catch (error) {
    console.error('Refund processing error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
