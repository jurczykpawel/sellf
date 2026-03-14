/**
 * Payments API v1 - Single Payment Operations
 *
 * GET /api/v1/payments/:id - Get payment details
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
import { createAdminClient } from '@/lib/supabase/admin';
import { validateUUID } from '@/lib/validations/product';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface PaymentProductRelation {
  id: string;
  name: string;
  slug: string;
  price: number;
  currency: string;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/payments/:id
 *
 * Get details of a specific payment transaction.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await authenticate(request, [API_SCOPES.ANALYTICS_READ]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid payment ID format');
    }

    const adminClient = createAdminClient();

    const { data: payment, error } = await adminClient
      .from('payment_transactions')
      .select(`
        id,
        customer_email,
        amount,
        currency,
        status,
        stripe_payment_intent_id,
        product_id,
        products!inner(id, name, slug, price, currency),
        user_id,
        session_id,
        refund_id,
        refunded_amount,
        refunded_at,
        refunded_by,
        refund_reason,
        metadata,
        created_at,
        updated_at
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return apiError(request, 'NOT_FOUND', 'Payment not found');
      }
      console.error('Error fetching payment:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch payment');
    }

    // Get user info if available
    let userInfo = null;
    if (payment.user_id) {
      const { data: user } = await adminClient
        .from('user_access_stats')
        .select('user_id, email')
        .eq('user_id', payment.user_id)
        .single();

      if (user) {
        userInfo = {
          id: user.user_id,
          email: user.email,
        };
      }
    }

    return jsonResponse(
      successResponse({
        id: payment.id,
        customer_email: payment.customer_email,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        stripe_payment_intent_id: payment.stripe_payment_intent_id,
        product: (() => {
          const p = payment.products as unknown as PaymentProductRelation;
          return { id: p.id, name: p.name, slug: p.slug, price: p.price, currency: p.currency };
        })(),
        user: userInfo,
        session_id: payment.session_id,
        refund: payment.refund_id ? {
          id: payment.refund_id,
          amount: payment.refunded_amount,
          refunded_at: payment.refunded_at,
          refunded_by: payment.refunded_by,
          reason: payment.refund_reason,
        } : null,
        metadata: payment.metadata,
        created_at: payment.created_at,
        updated_at: payment.updated_at,
      }),
      request
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
