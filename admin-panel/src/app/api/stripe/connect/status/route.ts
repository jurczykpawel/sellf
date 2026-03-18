/**
 * Stripe Connect Status API
 *
 * GET: Check the onboarding status of a seller's connected Stripe account.
 * Accessible by platform admins (any seller via seller_id param) and seller admins (own seller only).
 *
 * Query params:
 *   seller_id: string (required for platform admins)
 *   context: 'seller' (optional, used by seller admins to auto-resolve their own seller)
 *
 * Response:
 *   ConnectAccountStatus | { error: string }
 *
 * @see src/lib/stripe/connect.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdminOrSellerApi } from '@/lib/auth-server';
import { checkMarketplaceAccess } from '@/lib/marketplace/feature-flag';
import { getSellerById } from '@/lib/marketplace/seller-client';
import { getConnectedAccountStatus } from '@/lib/stripe/connect';
import { createPlatformClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  try {
    // Marketplace feature gate
    const marketplaceAccess = await checkMarketplaceAccess();
    if (!marketplaceAccess.accessible) {
      return NextResponse.json({ error: 'Marketplace is not enabled' }, { status: 403 });
    }

    // Auth: admin or seller
    const supabase = await createClient();
    const access = await requireAdminOrSellerApi(supabase);

    let sellerId: string | null = null;

    if (access.role === 'seller_admin') {
      // Seller admins always check their own status
      const platform = createPlatformClient();
      const { data: ownSeller } = await platform
        .from('sellers')
        .select('id')
        .eq('user_id', access.user.id)
        .eq('status', 'active')
        .single();

      if (!ownSeller) {
        return NextResponse.json({ error: 'Seller record not found' }, { status: 404 });
      }
      sellerId = ownSeller.id;
    } else {
      // Platform admins must provide seller_id
      sellerId = request.nextUrl.searchParams.get('seller_id');
      if (!sellerId) {
        return NextResponse.json({ error: 'seller_id is required' }, { status: 400 });
      }
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
    }

    console.error('[Stripe Connect Status] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
