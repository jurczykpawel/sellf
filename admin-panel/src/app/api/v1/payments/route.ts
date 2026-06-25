/**
 * Payments API v1 - List Payments
 *
 * GET /api/v1/payments - List payment transactions with filters and pagination
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
import { parseLimit, applyCursorToQuery, createPaginationResponse, validateCursor } from '@/lib/api/pagination';
import { escapeIlikePattern, validateUUID } from '@/lib/validations/product';
import { firstRelated } from '@/lib/supabase/relations';
import type { PaymentTransactionLineItem } from '@/types/payment';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/payments
 *
 * List payment transactions with optional filters.
 *
 * Query params:
 * - cursor: string (pagination cursor)
 * - limit: number (default 50, max 100)
 * - status: 'all' | 'completed' | 'refunded' | 'failed' | 'pending' (default 'all')
 * - product_id: string (filter by product)
 * - email: string (filter by customer email)
 * - date_from: string ISO date (filter from date)
 * - date_to: string ISO date (filter to date)
 * - sort: string (default '-created_at')
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request, [API_SCOPES.ANALYTICS_READ]);

    const adminClient = auth.supabase;
    const { searchParams } = request.nextUrl;

    // Parse params
    const cursor = searchParams.get('cursor');
    const limit = parseLimit(searchParams.get('limit'));
    const status = searchParams.get('status') || 'all';
    const productId = searchParams.get('product_id');
    const email = searchParams.get('email');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const sort = searchParams.get('sort') || '-created_at';

    // Validate cursor
    const cursorError = validateCursor(cursor);
    if (cursorError) {
      return apiError(request, 'INVALID_INPUT', cursorError);
    }

    // Build query
    let query = adminClient
      .from('payment_transactions')
      .select(`
        id,
        customer_email,
        amount,
        currency,
        status,
        stripe_payment_intent_id,
        product_id,
        products!inner(name, slug, custom_checkout_fields, is_bundle),
        user_id,
        session_id,
        metadata,
        custom_field_values,
        refund_id,
        refunded_amount,
        refunded_at,
        refund_reason,
        refunded_by,
        net_total,
        tax_total,
        tax_snapshot_status,
        created_at,
        updated_at
      `);

    // Filter by status
    if (status !== 'all') {
      const validStatuses = ['completed', 'refunded', 'failed', 'pending'];
      if (!validStatuses.includes(status)) {
        return apiError(request, 'INVALID_INPUT', `Invalid status. Valid values: all, ${validStatuses.join(', ')}`);
      }
      query = query.eq('status', status);
    }

    // Filter by product
    if (productId) {
      const productIdValidation = validateUUID(productId);
      if (!productIdValidation.isValid) {
        return apiError(request, 'INVALID_INPUT', 'Invalid product_id format');
      }
      query = query.eq('product_id', productId);
    }

    if (email) {
      if (email.length > 254) {
        return apiError(request, 'INVALID_INPUT', 'Email filter must be 254 characters or less');
      }
      const escapedEmail = escapeIlikePattern(email);
      query = query.ilike('customer_email', `%${escapedEmail}%`);
    }

    // Filter by date range
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      if (!isNaN(fromDate.getTime())) {
        query = query.gte('created_at', fromDate.toISOString());
      }
    }

    if (dateTo) {
      const toDate = new Date(dateTo);
      if (!isNaN(toDate.getTime())) {
        query = query.lte('created_at', toDate.toISOString());
      }
    }

    // Sorting
    const isDescending = sort.startsWith('-');
    const sortField = isDescending ? sort.slice(1) : sort;
    const allowedSortFields = ['created_at', 'amount', 'customer_email'];

    if (!allowedSortFields.includes(sortField)) {
      return apiError(request, 'INVALID_INPUT', `Invalid sort field. Allowed: ${allowedSortFields.join(', ')}`);
    }

    const orderDirection = isDescending ? 'desc' : 'asc';

    // Apply cursor pagination
    query = applyCursorToQuery(query, cursor, sortField, orderDirection);

    query = query
      .order(sortField, { ascending: !isDescending })
      .order('id', { ascending: !isDescending })
      .limit(limit + 1);

    const { data: payments, error } = await query;

    if (error) {
      console.error('Error fetching payments:', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch payments');
    }

    const paymentRows = payments ?? [];
    const transactionIds = paymentRows.map(p => p.id);
    const lineItemsByTransactionId = new Map<string, PaymentTransactionLineItem[]>();

    if (transactionIds.length > 0) {
      const { data: lineItems, error: lineItemsError } = await adminClient
        .from('payment_line_items')
        .select(`
          id,
          transaction_id,
          product_id,
          item_type,
          product_name,
          quantity,
          unit_price,
          total_price,
          currency,
          metadata,
          net_amount,
          tax_amount,
          vat_rate,
          tax_behavior,
          vat_exempt,
          taxability_reason,
          tax_breakdown
        `)
        .in('transaction_id', transactionIds)
        .order('created_at', { ascending: true });

      if (lineItemsError) {
        console.error('Error fetching payment line items:', lineItemsError);
        return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch payment line items');
      }

      for (const item of lineItems ?? []) {
        if (!item.transaction_id || !item.id || !item.item_type) {
          continue;
        }

        const normalizedItem: PaymentTransactionLineItem = {
          id: item.id,
          transaction_id: item.transaction_id,
          product_id: item.product_id,
          item_type: item.item_type,
          product_name: item.product_name,
          quantity: item.quantity ?? 1,
          unit_price: item.unit_price ?? 0,
          total_price: item.total_price ?? 0,
          currency: item.currency ?? 'usd',
          metadata: item.metadata,
          // VAT snapshot (minor units; null on legacy/uncaptured rows)
          net_amount: item.net_amount,
          tax_amount: item.tax_amount,
          vat_rate: item.vat_rate,
          tax_behavior: item.tax_behavior as PaymentTransactionLineItem['tax_behavior'],
          vat_exempt: item.vat_exempt ?? undefined,
          taxability_reason: item.taxability_reason,
          tax_breakdown: item.tax_breakdown as unknown as PaymentTransactionLineItem['tax_breakdown'],
        };

        const existingItems = lineItemsByTransactionId.get(item.transaction_id) ?? [];
        existingItems.push(normalizedItem);
        lineItemsByTransactionId.set(item.transaction_id, existingItems);
      }
    }

    // Derive bundle components for bundle transactions (light: one batch query,
    // name/slug only). Non-bundle transactions get no bundle_components field.
    const bundleProductIds = Array.from(
      new Set(
        paymentRows
          .filter(p => (p.products as unknown as { is_bundle?: boolean } | null)?.is_bundle && p.product_id)
          .map(p => p.product_id as string),
      ),
    );
    const bundleComponentsByProductId = new Map<string, Array<{ name: string; slug: string }>>();

    if (bundleProductIds.length > 0) {
      const { data: bundleItems, error: bundleError } = await adminClient
        .from('bundle_items')
        .select('bundle_product_id, display_order, component:products!bundle_items_component_product_id_fkey(name, slug)')
        .in('bundle_product_id', bundleProductIds)
        .order('display_order', { ascending: true });

      if (bundleError) {
        console.error('Error fetching bundle components:', bundleError);
      } else {
        for (const item of bundleItems ?? []) {
          if (!item.bundle_product_id) continue;
          const component = firstRelated<{ name: string; slug: string }>(item.component);
          if (!component) continue;
          const existing = bundleComponentsByProductId.get(item.bundle_product_id) ?? [];
          existing.push({ name: component.name, slug: component.slug });
          bundleComponentsByProductId.set(item.bundle_product_id, existing);
        }
      }
    }

    // Transform response
    const transformedItems = paymentRows.map(p => {
      const productRel = p.products as unknown as {
        name: string;
        slug: string;
        custom_checkout_fields: unknown;
        is_bundle?: boolean;
      } | null;
      return {
        id: p.id,
        customer_email: p.customer_email,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        stripe_payment_intent_id: p.stripe_payment_intent_id,
        product: {
          id: p.product_id,
          name: productRel?.name,
          slug: productRel?.slug,
          custom_checkout_fields: Array.isArray(productRel?.custom_checkout_fields)
            ? productRel.custom_checkout_fields
            : null,
          is_bundle: productRel?.is_bundle ?? false,
          // Derived component list (name/slug) for bundle transactions; omitted for non-bundles.
          ...(productRel?.is_bundle && p.product_id
            ? { bundle_components: bundleComponentsByProductId.get(p.product_id) ?? [] }
            : {}),
        },
        line_items: lineItemsByTransactionId.get(p.id) ?? [],
        net_total: p.net_total,
        tax_total: p.tax_total,
        tax_snapshot_status: p.tax_snapshot_status,
        user_id: p.user_id,
        session_id: p.session_id,
        metadata: p.metadata ?? {},
        custom_field_values: p.custom_field_values ?? null,
        refunded_amount: p.refunded_amount ?? 0,
        refund: p.refund_id ? {
          id: p.refund_id,
          amount: p.refunded_amount,
          refunded_at: p.refunded_at,
          reason: p.refund_reason,
          refunded_by: p.refunded_by,
        } : null,
        created_at: p.created_at,
        updated_at: p.updated_at,
      };
    });

    const { items, pagination } = createPaginationResponse(
      transformedItems,
      limit,
      sortField,
      orderDirection,
      cursor
    );

    return jsonResponse(successResponse(items, pagination), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
