/**
 * Coupons API v1 - Coupon Statistics
 *
 * GET /api/v1/coupons/:id/stats - Get usage statistics for a coupon
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
import { validateUUID } from '@/lib/validations/product';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/coupons/:id/stats
 *
 * Get usage statistics for a specific coupon.
 *
 * Returns:
 * - total_redemptions: number
 * - total_discount_amount: number (sum of all discounts applied)
 * - unique_users: number (distinct emails)
 * - recent_redemptions: array of last 10 uses
 * - daily_usage: array of usage by day (last 30 days)
 * - usage_by_product: array of usage breakdown by product
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticate(request, [API_SCOPES.COUPONS_READ]);
    const { id } = await params;

    // Validate ID format
    const idValidation = validateUUID(id);
    if (!idValidation.isValid) {
      return apiError(request, 'INVALID_INPUT', 'Invalid coupon ID format');
    }

    // Check coupon exists and get basic info
    const { data: coupon, error: couponError } = await auth.supabase
      .from('coupons')
      .select('id, code, current_usage_count, usage_limit_global, usage_limit_per_user, currency')
      .eq('id', id)
      .single();

    if (couponError || !coupon) {
      return apiError(request, 'NOT_FOUND', 'Coupon not found');
    }

    // Get redemptions with stats
    const { data: redemptions, error: redemptionsError } = await auth.supabase
      .from('coupon_redemptions')
      .select('id, customer_email, discount_amount, redeemed_at, transaction_id')
      .eq('coupon_id', id)
      .order('redeemed_at', { ascending: false });

    if (redemptionsError) {
      console.error('Error fetching redemptions:', redemptionsError);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch coupon statistics');
    }

    const allRedemptions = redemptions || [];

    // Calculate statistics
    const totalRedemptions = allRedemptions.length;
    const totalDiscountAmount = allRedemptions.reduce((sum, r) => sum + (r.discount_amount || 0), 0);
    const uniqueEmails = new Set(allRedemptions.map(r => r.customer_email.toLowerCase()));
    const uniqueUsers = uniqueEmails.size;

    // Recent redemptions (last 10)
    const recentRedemptions = allRedemptions.slice(0, 10).map(r => ({
      id: r.id,
      customer_email: r.customer_email,
      discount_amount: r.discount_amount,
      redeemed_at: r.redeemed_at,
      transaction_id: r.transaction_id,
    }));

    // Daily usage (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyUsageMap = new Map<string, { count: number; amount: number }>();

    // Initialize last 30 days with zeros
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      dailyUsageMap.set(dateStr, { count: 0, amount: 0 });
    }

    // Fill in actual data
    for (const r of allRedemptions) {
      const dateStr = r.redeemed_at.split('T')[0];
      const existing = dailyUsageMap.get(dateStr);
      if (existing) {
        existing.count++;
        existing.amount += r.discount_amount || 0;
      }
    }

    const dailyUsage = Array.from(dailyUsageMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Get product breakdown via transactions
    const transactionIds = allRedemptions
      .filter((r): r is typeof r & { transaction_id: string } => r.transaction_id !== null)
      .map(r => r.transaction_id);

    let usageByProduct: { product_id: string; product_name: string; count: number; amount: number }[] = [];

    if (transactionIds.length > 0) {
      const { data: transactions } = await auth.supabase
        .from('payment_transactions')
        .select('id, product_id, products!inner(name)')
        .in('id', transactionIds);

      if (transactions) {
        const productUsageMap = new Map<string, { name: string; count: number; amount: number }>();

        for (const t of transactions) {
          const redemption = allRedemptions.find(r => r.transaction_id === t.id);
          const products = t.products as unknown as { name: string } | { name: string }[];
          const productName = (Array.isArray(products) ? products[0]?.name : products?.name) || 'Unknown';

          const existing = productUsageMap.get(t.product_id) || { name: productName, count: 0, amount: 0 };
          existing.count++;
          existing.amount += redemption?.discount_amount || 0;
          productUsageMap.set(t.product_id, existing);
        }

        usageByProduct = Array.from(productUsageMap.entries())
          .map(([product_id, data]) => ({
            product_id,
            product_name: data.name,
            count: data.count,
            amount: data.amount,
          }))
          .sort((a, b) => b.count - a.count);
      }
    }

    // Calculate remaining uses
    const remainingGlobalUses = coupon.usage_limit_global
      ? Math.max(0, coupon.usage_limit_global - totalRedemptions)
      : null;

    return jsonResponse(
      successResponse({
        coupon_id: id,
        coupon_code: coupon.code,
        currency: coupon.currency,
        summary: {
          total_redemptions: totalRedemptions,
          total_discount_amount: totalDiscountAmount,
          unique_users: uniqueUsers,
          usage_limit_global: coupon.usage_limit_global,
          usage_limit_per_user: coupon.usage_limit_per_user,
          remaining_global_uses: remainingGlobalUses,
        },
        recent_redemptions: recentRedemptions,
        daily_usage: dailyUsage,
        usage_by_product: usageByProduct,
      }),
      request
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}
