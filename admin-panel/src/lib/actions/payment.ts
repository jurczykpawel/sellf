// lib/actions/payment.ts
// Secure Next.js 15 Server Actions for payment processing

'use server';

import { revalidatePath } from 'next/cache';
import { getStripeServer } from '@/lib/stripe/server';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import { withAdminAuth } from '@/lib/actions/admin-auth';
import type {
  RefundRequest,
  RefundResponse
} from '@/types/payment';

/**
 * Process refund - Admin only Server Action
 */
export async function processRefund(data: RefundRequest): Promise<RefundResponse> {
  const authResult = await withAdminAuth(async ({ user, supabase }) => {
    // Get transaction details
    const { data: transaction, error: transactionError } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('id', data.transactionId)
      .eq('status', 'completed')
      .single();

    if (transactionError || !transaction) {
      return { success: false, error: 'Transaction not found or already refunded' };
    }

    // Calculate refund amount (amounts in DB are already in cents)
    const refundAmount = data.amount || transaction.amount;
    const alreadyRefunded = transaction.refunded_amount || 0;

    if (refundAmount > (transaction.amount - alreadyRefunded)) {
      return { success: false, error: 'Refund amount exceeds available amount' };
    }

    if (!transaction.stripe_payment_intent_id) {
      return { success: false, error: 'Transaction has no Stripe payment intent' };
    }

    let stripe;
    try {
      stripe = await getStripeServer();
    } catch {
      return { success: false, error: 'Payment system unavailable' };
    }

    // Create refund in Stripe (amount is already in cents)
    const refund = await stripe.refunds.create({
      payment_intent: transaction.stripe_payment_intent_id,
      amount: refundAmount,
      reason: (data.reason as 'duplicate' | 'fraudulent' | 'requested_by_customer') || 'requested_by_customer',
      metadata: {
        refunded_by: user.id,
        original_transaction_id: transaction.id,
      },
    });

    // Update transaction in database
    const totalRefunded = alreadyRefunded + (refund.amount ?? refundAmount);
    const isFullRefund = totalRefunded >= transaction.amount;

    const { data: updatedRows, error: updateError } = await supabase
      .from('payment_transactions')
      .update({
        refunded_amount: totalRefunded,
        status: isFullRefund ? 'refunded' : 'completed',
        refunded_at: new Date().toISOString(),
        refunded_by: user.id,
        refund_id: refund.id,
        refund_reason: data.reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.transactionId)
      .eq('refunded_amount', alreadyRefunded)
      .select('id');

    if (updateError) {
      console.error('[processRefund] DB update failed after Stripe refund:', updateError);
    }

    // Revoke all product access on full refund (main + bumps, user + guest)
    // Always attempt revocation after Stripe refund succeeds — even if DB update failed
    if (isFullRefund) {
      try {
        const revocation = await revokeTransactionAccess(supabase, {
          transactionId: transaction.id,
          userId: transaction.user_id,
          productId: transaction.product_id,
          sessionId: transaction.session_id,
        });

        if (revocation.warnings.length > 0) {
          console.error('[processRefund] Revocation warnings:', revocation.warnings);
        }
      } catch (revocationError) {
        console.error('[processRefund] Access revocation failed after Stripe refund:', revocationError);
      }
    }

    if (!updatedRows || updatedRows.length === 0) {
      return {
        success: true,
        data: {
          refundId: refund.id,
          amount: refund.amount ?? refundAmount,
          message: 'Refund processed in Stripe but DB update failed (concurrent modification). Verify transaction status manually.',
        },
      };
    }

    // Revalidate admin pages
    revalidatePath('/dashboard/payments');
    revalidatePath('/dashboard/transactions');

    return {
      success: true,
      data: {
        refundId: refund.id,
        amount: refund.amount ?? refundAmount,
        message: isFullRefund ? 'Full refund processed' : 'Partial refund processed',
      },
    };
  });

  // Map ActionResponse to RefundResponse
  if (!authResult.success) {
    return {
      success: false,
      message: authResult.error || 'Authentication failed',
    };
  }

  return {
    success: true,
    refundId: authResult.data?.refundId,
    amount: authResult.data?.amount,
    message: authResult.data?.message || 'Refund processed',
  };
}
