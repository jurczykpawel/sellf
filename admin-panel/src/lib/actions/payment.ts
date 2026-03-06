// lib/actions/payment.ts
// Secure Next.js 15 Server Actions for payment processing

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStripeServer } from '@/lib/stripe/server';
import type {
  RefundRequest,
  RefundResponse
} from '@/types/payment';

/**
 * Process refund - Admin only Server Action
 */
export async function processRefund(data: RefundRequest): Promise<RefundResponse> {
  const supabase = await createClient();

  // Get authenticated user and check admin permissions
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Authentication required');
  }

  // Check if user is admin (you should implement your admin check logic)
  const { data: adminUser, error: adminError } = await supabase
    .from('admin_users')
    .select('id')
    .eq('user_id', user.id)
    .single();

  if (adminError || !adminUser) {
    throw new Error('Admin access required');
  }

  // Get transaction details
  const { data: transaction, error: transactionError } = await supabase
    .from('payment_transactions')
    .select('*')
    .eq('id', data.transactionId)
    .eq('status', 'completed')
    .single();

  if (transactionError || !transaction) {
    throw new Error('Transaction not found or already refunded');
  }

  const stripe = await getStripeServer();

  try {
    // Calculate refund amount (amounts in DB are already in cents)
    const refundAmount = data.amount || transaction.amount;
    const alreadyRefunded = transaction.refunded_amount || 0;

    if (refundAmount > (transaction.amount - alreadyRefunded)) {
      throw new Error('Refund amount exceeds available amount');
    }

    // Create refund in Stripe (amount is already in cents)
    const refund = await stripe.refunds.create({
      payment_intent: transaction.stripe_payment_intent_id!,
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
      throw new Error('Failed to update transaction status');
    }

    // Revoke access on full refund — do this regardless of optimistic lock result
    // because the Stripe refund already succeeded
    if (isFullRefund) {
      if (transaction.user_id && transaction.product_id) {
        await supabase
          .from('user_product_access')
          .delete()
          .eq('user_id', transaction.user_id)
          .eq('product_id', transaction.product_id);
      }

      if (transaction.session_id && transaction.product_id) {
        await supabase
          .from('guest_purchases')
          .delete()
          .eq('session_id', transaction.session_id)
          .eq('product_id', transaction.product_id);
      }
    }

    if (!updatedRows || updatedRows.length === 0) {
      throw new Error('Transaction was modified concurrently. Refund processed in Stripe — verify manually.');
    }

    // Revalidate admin pages
    revalidatePath('/dashboard/payments');
    revalidatePath('/dashboard/transactions');

    return {
      success: true,
      refundId: refund.id,
      amount: refund.amount ?? refundAmount,
      message: isFullRefund ? 'Full refund processed' : 'Partial refund processed',
    };

  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to process refund',
    };
  }
}
