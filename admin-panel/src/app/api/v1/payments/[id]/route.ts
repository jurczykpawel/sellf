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
  requireScope,
  handleApiError,
  successResponse,
  parseJsonBody,
  API_SCOPES,
} from '@/lib/api';
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
  custom_checkout_fields: unknown;
  is_bundle: boolean;
}

function firstRelated<T>(value: unknown): T | null { return (Array.isArray(value) ? value[0] : value) as T ?? null; }

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
    const auth = await authenticate(request);
    requireScope(auth, API_SCOPES.PAYMENTS_READ);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid payment ID format');
    }

    const adminClient = auth.supabase;

    const { data: payment, error } = await adminClient
      .from('payment_transactions')
      .select(`
        id,order_number,payment_provider,payment_due_at,transfer_details,order_details,
        customer_email,
        amount,
        currency,
        status,
        stripe_payment_intent_id,
        product_id,
        products!inner(id, name, slug, price, currency, custom_checkout_fields, is_bundle),
        coupons!payment_transactions_coupon_id_fkey(code),
        coupon_redemptions(coupons!coupon_redemptions_coupon_id_fkey(code)),
        invoices(status,number,view_url,error,attempts),
        user_id,
        session_id,
        refund_id,
        refund_status,
        refunded_amount,
        refunded_at,
        refunded_by,
        refund_reason,
        metadata,
        custom_field_values,
        net_total,
        tax_total,
        tax_snapshot_status,
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

    const { data: lineItems, error: lineError } = await adminClient.from('payment_line_items').select('*').eq('transaction_id', id);
    if (lineError) return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch payment items');

    const productRelation = payment.products as unknown as PaymentProductRelation;
    let bundleComponents: Array<{ name: string; slug: string }> = [];
    if (productRelation.is_bundle) {
      const components = await adminClient.from('bundle_items').select('component:products!bundle_items_component_product_id_fkey(name,slug)').eq('bundle_product_id', payment.product_id).order('display_order');
      if (components.error) return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch payment components');
      bundleComponents = (components.data ?? []).flatMap(row => { const value = firstRelated<{ name: string; slug: string }>(row.component); return value ? [value] : []; });
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
        order_number: payment.order_number,
        user_id: payment.user_id, refunded_amount: payment.refunded_amount ?? 0,
        coupon_code: firstRelated<{ code: string }>(payment.coupons)?.code ?? firstRelated<{ code: string }>(firstRelated<{ coupons: unknown }>(payment.coupon_redemptions)?.coupons)?.code ?? null,
        invoice: firstRelated(payment.invoices) ?? null, payment_provider: payment.payment_provider, payment_due_at: payment.payment_due_at,
        transfer_details: payment.transfer_details, order_details: payment.order_details, line_items: lineItems ?? [],
        customer_email: payment.customer_email,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        stripe_payment_intent_id: payment.stripe_payment_intent_id,
        product: (() => {
          const p = payment.products as unknown as PaymentProductRelation;
          return {
            id: p.id,
            name: p.name,
            slug: p.slug,
            price: p.price,
            currency: p.currency,
            is_bundle: p.is_bundle,
            ...(p.is_bundle ? { bundle_components: bundleComponents } : {}),
            custom_checkout_fields: Array.isArray(p.custom_checkout_fields) ? p.custom_checkout_fields : null,
          };
        })(),
        user: userInfo,
        session_id: payment.session_id,
        net_total: payment.net_total,
        tax_total: payment.tax_total,
        tax_snapshot_status: payment.tax_snapshot_status,
        refund: payment.refund_id ? {
          id: payment.refund_id,
          status: payment.refund_status,
          amount: payment.refunded_amount,
          refunded_at: payment.refunded_at,
          refunded_by: payment.refunded_by,
          reason: payment.refund_reason,
        } : null,
        metadata: payment.metadata,
        custom_field_values: payment.custom_field_values ?? null,
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
    const auth = await authenticate(request, [API_SCOPES.PAYMENTS_WRITE]);
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

    const adminClient = auth.supabase;

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
