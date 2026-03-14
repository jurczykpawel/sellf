import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStripeServer } from '@/lib/stripe/server';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import { requireAdminApi } from '@/lib/auth-server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PATCH /api/admin/refund-requests/[id] - Approve or reject a refund request
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: requestId } = await params;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(requestId)) {
      return NextResponse.json({ error: 'Invalid request ID format' }, { status: 400 });
    }

    const supabase = await createClient();
    const { user } = await requireAdminApi(supabase);

    const body = await request.json();
    const { action, admin_response } = body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    // Process the refund request using database function
    const { data: processResult, error: processError } = await supabase
      .rpc('process_refund_request', {
        request_id_param: requestId,
        action_param: action,
        admin_response_param: admin_response || null,
      });

    if (processError) throw processError;

    if (!processResult.success) {
      return NextResponse.json(
        { error: processResult.error || processResult.message },
        { status: 400 }
      );
    }

    // If approved, process the actual Stripe refund
    if (action === 'approve' && processResult.stripe_payment_intent_id) {
      try {
        const stripe = await getStripeServer();

        await stripe.refunds.create({
          payment_intent: processResult.stripe_payment_intent_id,
          amount: Math.round(processResult.amount), // Amount is already in cents from DB
          reason: 'requested_by_customer',
          metadata: {
            refund_request_id: requestId,
            refunded_by: user.id,
          },
        });

        // Get current transaction to check existing refunded amount
        const { data: transaction } = await supabase
          .from('payment_transactions')
          .select('user_id, product_id, amount, refunded_amount, session_id')
          .eq('id', processResult.transaction_id)
          .single();

        const totalRefunded = (transaction?.refunded_amount || 0) + processResult.amount;
        const isFullRefund = transaction ? totalRefunded >= transaction.amount : true;

        const { data: updatedRows } = await supabase
          .from('payment_transactions')
          .update({
            refunded_amount: totalRefunded,
            status: isFullRefund ? 'refunded' : 'completed',
            refunded_at: new Date().toISOString(),
            refunded_by: user.id,
            refund_reason: admin_response || 'Customer request approved',
            updated_at: new Date().toISOString(),
          })
          .eq('id', processResult.transaction_id)
          .eq('refunded_amount', transaction?.refunded_amount || 0)
          .select('id');

        // Revoke all product access on full refund (main + bumps, user + guest)
        if (isFullRefund && transaction) {
          const revocation = await revokeTransactionAccess(supabase, {
            transactionId: processResult.transaction_id,
            userId: transaction.user_id,
            productId: transaction.product_id,
            sessionId: transaction.session_id,
          });

          if (revocation.warnings.length > 0) {
            console.error('[refund-request] Revocation warnings:', revocation.warnings);
          }
        }

        if (!updatedRows || updatedRows.length === 0) {
          console.error('[refund-request] Optimistic lock failed for transaction:', processResult.transaction_id);
          return NextResponse.json({
            success: true,
            status: 'approved',
            message: 'Refund processed in Stripe but database was modified concurrently. Verify transaction status manually.',
            stripe_refund_created: true,
            warning: 'concurrent_modification',
          });
        }

        return NextResponse.json({
          success: true,
          status: 'approved',
          message: 'Refund processed successfully',
          stripe_refund_created: true,
        });
      } catch (stripeError) {
        console.error('Stripe refund error:', stripeError);
        // Revert the request status since Stripe failed
        await supabase
          .from('refund_requests')
          .update({
            status: 'pending',
            admin_id: null,
            admin_response: null,
            processed_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', requestId);

        return NextResponse.json(
          { error: 'Failed to process refund with Stripe. Request has been reverted to pending.' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(processResult);
  } catch (error) {
    console.error('Error processing refund request:', error);
    return NextResponse.json(
      { error: 'Failed to process refund request' },
      { status: 500 }
    );
  }
}
