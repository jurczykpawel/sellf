/**
 * Stripe Connect Status API
 *
 * GET: Check the onboarding status of a seller's connected Stripe account.
 * Admin-only endpoint.
 *
 * Query params:
 *   seller_id: string
 *
 * Response:
 *   ConnectAccountStatus | { error: string }
 *
 * @see src/lib/stripe/connect.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMarketplaceAdmin } from '@/lib/auth-server';
import { getSellerById } from '@/lib/marketplace/seller-client';
import { getConnectedAccountStatus } from '@/lib/stripe/connect';

export async function GET(request: NextRequest) {
  try {
    // Auth: admin + marketplace gate
    const supabase = await createClient();
    await requireMarketplaceAdmin(supabase);

    const sellerId = request.nextUrl.searchParams.get('seller_id');
    if (!sellerId) {
      return NextResponse.json({ error: 'seller_id is required' }, { status: 400 });
    }

    const seller = await getSellerById(sellerId);
    if (!seller) {
      return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
    }

    if (!seller.stripe_account_id) {
      return NextResponse.json({
        accountId: null,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        onboardingComplete: false,
      });
    }

    const status = await getConnectedAccountStatus(seller.stripe_account_id);
    if (!status) {
      return NextResponse.json(
        { error: 'Failed to retrieve Stripe account status' },
        { status: 500 }
      );
    }

    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (error.message === 'Forbidden') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (error.message === 'Marketplace is not enabled') {
        return NextResponse.json({ error: 'Marketplace is not enabled' }, { status: 403 });
      }
    }

    console.error('[Stripe Connect Status] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
