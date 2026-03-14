/**
 * System API v1 - Status
 *
 * GET /api/v1/system/status - Get detailed system status (authenticated)
 */

import { NextRequest } from 'next/server';
import {
  handleCorsPreFlight,
  jsonResponse,
  authenticate,
  handleApiError,
  successResponse,
  API_SCOPES,
} from '@/lib/api';
import { createAdminClient, createPlatformClient } from '@/lib/supabase/admin';

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreFlight(request);
}

/**
 * GET /api/v1/system/status
 *
 * Get detailed system status including database health, counts, and version info.
 * Requires SYSTEM_READ scope.
 */
export async function GET(request: NextRequest) {
  try {
    await authenticate(request, [API_SCOPES.SYSTEM_READ]);

    const adminClient = createAdminClient();
    const now = new Date();

    // Run all count queries in parallel (N3: was sequential — 7 round trips)
    const platformClient = createPlatformClient();

    const [
      totalProductsResult,
      activeProductsResult,
      totalUsersResult,
      totalTransactionsResult,
      completedTransactionsResult,
      pendingRefundsResult,
      activeWebhooksResult,
      activeCouponsResult,
      activeApiKeysResult,
    ] = await Promise.all([
      adminClient.from('products').select('*', { count: 'exact', head: true }),
      adminClient.from('products').select('*', { count: 'exact', head: true }).eq('is_active', true),
      adminClient.from('profiles').select('*', { count: 'exact', head: true }),
      adminClient.from('payment_transactions').select('*', { count: 'exact', head: true }),
      adminClient.from('payment_transactions').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
      adminClient.from('refund_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      adminClient.from('webhook_endpoints').select('*', { count: 'exact', head: true }).eq('is_active', true),
      adminClient.from('coupons').select('*', { count: 'exact', head: true }).eq('is_active', true),
      platformClient.from('api_keys').select('*', { count: 'exact', head: true }).eq('is_active', true),
    ]);

    const databaseHealthy = !totalProductsResult.error;
    const databaseError = totalProductsResult.error ? 'Database connection error' : null;

    const totalProducts = totalProductsResult.count;
    const activeProducts = activeProductsResult.count;
    const totalUsers = totalUsersResult.count;
    const totalTransactions = totalTransactionsResult.count;
    const completedTransactions = completedTransactionsResult.count;
    const pendingRefunds = pendingRefundsResult.count;
    const activeWebhooks = activeWebhooksResult.count;
    const activeCoupons = activeCouponsResult.count;
    const activeApiKeys = activeApiKeysResult.count;

    const response = {
      status: databaseHealthy ? 'healthy' : 'degraded',
      timestamp: now.toISOString(),
      version: {
        api: 'v1',
        service: 'sellf-admin',
        build: process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'development',
      },
      environment: process.env.NODE_ENV || 'development',
      database: {
        connected: databaseHealthy,
        error: databaseError,
      },
      counts: {
        products: {
          total: totalProducts || 0,
          active: activeProducts || 0,
        },
        users: {
          total: totalUsers || 0,
        },
        transactions: {
          total: totalTransactions || 0,
          completed: completedTransactions || 0,
        },
        refund_requests: {
          pending: pendingRefunds || 0,
        },
        webhooks: {
          active: activeWebhooks || 0,
        },
        coupons: {
          active: activeCoupons || 0,
        },
        api_keys: {
          active: activeApiKeys || 0,
        },
      },
      features: {
        stripe_enabled: !!process.env.STRIPE_SECRET_KEY,
        webhooks_enabled: true,
        api_keys_enabled: true,
      },
    };

    return jsonResponse(successResponse(response), request);
  } catch (error) {
    return handleApiError(error, request);
  }
}
