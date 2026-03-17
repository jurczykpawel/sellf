/**
 * Payments API v1 - Single Payment Operations
 *
 * GET   /api/v1/payments/:id          - Get payment details
 * PATCH /api/v1/payments/:id/metadata - Update payment metadata (merge, not replace)
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  apiError,
  authenticate,
  handleApiError,
  successResponse,
  parseJsonBody,
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

/**
 * PATCH /api/v1/payments/:id
 *
 * Update payment metadata. Merges with existing metadata (does not replace).
 * Only the `metadata` field can be modified — all other fields are read-only.
 *
 * Body: { metadata: { ... } }
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    await authenticate(request, [API_SCOPES.ANALYTICS_READ]);
    const { id } = await params;

    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid payment ID format');
    }

    const body = await parseJsonBody<Record<string, unknown>>(request);

    // Only metadata is writable
    if (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
      return apiError(request, 'VALIDATION_ERROR', 'Body must contain a metadata object');
    }

    // Reject if any other fields are present
    const allowedKeys = ['metadata'];
    const extraKeys = Object.keys(body).filter(k => !allowedKeys.includes(k));
    if (extraKeys.length > 0) {
      return apiError(request, 'VALIDATION_ERROR', `Only metadata can be modified. Unexpected fields: ${extraKeys.join(', ')}`);
    }

    const adminClient = createAdminClient();

    // Verify payment exists
    const { data: existing, error: fetchError } = await adminClient
      .from('payment_transactions')
      .select('id, metadata')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return apiError(request, 'NOT_FOUND', 'Payment not found');
    }

    // Merge metadata (existing || operator in jsonb)
    const mergedMetadata = { ...(existing.metadata as Record<string, unknown>), ...(body.metadata as Record<string, unknown>) };

    const { data: updated, error: updateError } = await adminClient
      .from('payment_transactions')
      .update({
        metadata: mergedMetadata as unknown as Record<string, never>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, metadata, updated_at')
      .single();

    if (updateError) {
      console.error('Error updating payment metadata:', updateError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to update metadata');
    }

    return jsonResponse(successResponse({
      id: updated.id,
      metadata: updated.metadata,
      updated_at: updated.updated_at,
    }), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
