/**
 * Refund Requests API v1 - Single Refund Request Operations
 *
 * GET /api/v1/refund-requests/:id - Get refund request details
 * PATCH /api/v1/refund-requests/:id - Approve or reject refund request
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  parseJsonBody,
  successResponse,
  API_SCOPES,
} from '@/lib/api';
import { validateUUID } from '@/lib/validations/product';
import { getStripeServer } from '@/lib/stripe/server';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface RefundProductRelation {
  id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
}

interface RefundTransactionRelation {
  id: string;
  customer_email: string;
  amount: number;
  currency: string;
  status: string;
  stripe_payment_intent_id: string | null;
  created_at: string;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/refund-requests/:id
 *
 * Get details of a specific refund request.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.REFUND_REQUESTS_READ]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid refund request ID format');
    }

    const adminClient = auth.supabase;

    const { data: refundRequest, error } = await adminClient
      .from('refund_requests')
      .select(`
        id,
        user_id,
        product_id,
        transaction_id,
        customer_email,
        requested_amount,
        currency,
        reason,
        status,
        admin_id,
        admin_response,
        processed_at,
        created_at,
        updated_at,
        product:products (
          id,
          name,
          slug,
          price,
          currency
        ),
        transaction:payment_transactions (
          id,
          customer_email,
          amount,
          currency,
          status,
          stripe_payment_intent_id,
          created_at
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return apiError(request, 'NOT_FOUND', 'Refund request not found');
      }
      console.error('Error fetching refund request:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch refund request');
    }

    // Transform response
    const response = {
      id: refundRequest.id,
      user_id: refundRequest.user_id,
      product_id: refundRequest.product_id,
      transaction_id: refundRequest.transaction_id,
      customer_email: refundRequest.customer_email,
      requested_amount: refundRequest.requested_amount,
      currency: refundRequest.currency,
      reason: refundRequest.reason,
      status: refundRequest.status,
      admin_id: refundRequest.admin_id,
      admin_response: refundRequest.admin_response,
      processed_at: refundRequest.processed_at,
      created_at: refundRequest.created_at,
      updated_at: refundRequest.updated_at,
      product: refundRequest.product ? (() => {
        const p = refundRequest.product as unknown as RefundProductRelation;
        return { id: p.id, name: p.name, slug: p.slug, price: p.price, currency: p.currency };
      })() : null,
      transaction: refundRequest.transaction ? (() => {
        const t = refundRequest.transaction as unknown as RefundTransactionRelation;
        return { id: t.id, customer_email: t.customer_email, amount: t.amount, currency: t.currency, status: t.status, stripe_payment_intent_id: t.stripe_payment_intent_id, created_at: t.created_at };
      })() : null,
    };

    return jsonResponse(successResponse(response), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}

/**
 * PATCH /api/v1/refund-requests/:id
 *
 * Approve or reject a refund request.
 *
 * Request body:
 * - action: 'approve' | 'reject' (required)
 * - admin_response: string (optional) - Response message to the customer
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticate(request, [API_SCOPES.REFUND_REQUESTS_WRITE]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid refund request ID format');
    }

    const adminClient = authResult.supabase;

    const body = await parseJsonBody<{
      action?: string;
      admin_response?: string;
    }>(request);

    const { action, admin_response } = body;

    // Validate action
    if (!action || !['approve', 'reject'].includes(action)) {
      return apiError(request, 'INVALID_INPUT', 'Action must be "approve" or "reject"');
    }

    // Validate admin_response length
    if (admin_response !== undefined && admin_response !== null) {
      if (typeof admin_response !== 'string' || admin_response.length > 2000) {
        return apiError(request, 'VALIDATION_ERROR', 'admin_response must be a string of 2000 characters or less');
      }
    }

    // Check refund request exists and is pending
    const { data: refundRequest, error: fetchError } = await adminClient
      .from('refund_requests')
      .select(`
        id,
        status,
        requested_amount,
        transaction_id,
        product_id,
        user_id
      `)
      .eq('id', id)
      .single();

    if (fetchError || !refundRequest) {
      return apiError(request, 'NOT_FOUND', 'Refund request not found');
    }

    if (refundRequest.status !== 'pending') {
      return apiError(
        request,
        'INVALID_INPUT',
        `Cannot process refund request with status '${refundRequest.status}'. Only pending requests can be processed.`
      );
    }

    // Get transaction details for Stripe refund
    const { data: transaction, error: txError } = await adminClient
      .from('payment_transactions')
      .select('id, stripe_payment_intent_id, amount, refunded_amount, user_id, product_id, session_id')
      .eq('id', refundRequest.transaction_id)
      .single();

    if (txError || !transaction) {
      return apiError(request, 'INTERNAL_ERROR', 'Transaction not found');
    }

    const adminUserId = authResult.admin.userId;

    // Update refund request status
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const { error: updateError } = await adminClient
      .from('refund_requests')
      .update({
        status: newStatus,
        admin_id: adminUserId,
        admin_response: admin_response || null,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error('Error updating refund request:', updateError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to update refund request');
    }

    // If approved, process the Stripe refund
    if (action === 'approve' && transaction.stripe_payment_intent_id) {
      try {
        const stripe = await getStripeServer();

        await stripe.refunds.create({
          payment_intent: transaction.stripe_payment_intent_id,
          amount: Math.round(refundRequest.requested_amount),
          reason: 'requested_by_customer',
          metadata: {
            refund_request_id: id,
            refunded_by: adminUserId,
          },
        });

        // Update the transaction status
        const totalRefunded = (transaction.refunded_amount || 0) + refundRequest.requested_amount;
        const isFullRefund = totalRefunded >= transaction.amount;

        const { data: updatedRows } = await adminClient
          .from('payment_transactions')
          .update({
            refunded_amount: totalRefunded,
            status: isFullRefund ? 'refunded' : 'completed',
            refunded_at: new Date().toISOString(),
            refunded_by: adminUserId,
            refund_reason: admin_response || 'Customer request approved',
            updated_at: new Date().toISOString(),
          })
          .eq('id', transaction.id)
          .eq('refunded_amount', transaction.refunded_amount || 0)
          .select('id');

        // Revoke all product access on full refund (main + bumps, user + guest)
        if (isFullRefund) {
          const revocation = await revokeTransactionAccess(adminClient, {
            transactionId: transaction.id,
            userId: transaction.user_id,
            productId: transaction.product_id,
            sessionId: transaction.session_id,
          });

          if (revocation.warnings.length > 0) {
            console.error('[refund-request] Revocation warnings:', revocation.warnings);
          }
        }

        if (!updatedRows || updatedRows.length === 0) {
          console.error('[refund-request] Optimistic lock failed for transaction:', transaction.id);
          return jsonResponse(
            successResponse({
              id,
              status: 'approved',
              message: 'Refund processed in Stripe but database was modified concurrently. Verify transaction status manually.',
              stripe_refund_created: true,
              warning: 'concurrent_modification',
            }),
            request
          );
        }

        return jsonResponse(
          successResponse({
            id,
            status: 'approved',
            message: 'Refund processed successfully',
            stripe_refund_created: true,
          }),
          request
        );
      } catch (stripeError) {
        console.error('Stripe refund error:', stripeError);

        // Revert the request status since Stripe failed
        await adminClient
          .from('refund_requests')
          .update({
            status: 'pending',
            admin_id: null,
            admin_response: null,
            processed_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);

        return apiError(
          request,
          'INTERNAL_ERROR',
          'Failed to process refund with Stripe. Request has been reverted to pending.'
        );
      }
    }

    // Return success for rejection or approval without Stripe
    return jsonResponse(
      successResponse({
        id,
        status: newStatus,
        message: action === 'approve'
          ? 'Refund request approved (no Stripe payment to refund)'
          : 'Refund request rejected',
      }),
      request
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
