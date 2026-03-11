/**
 * Stripe Connect Refresh Link API
 *
 * GET: Generate a new Account Link when the previous one expired.
 * Redirects the seller back to Stripe onboarding.
 *
 * Query params:
 *   seller_id: string — the seller to refresh the link for
 *
 * @see src/lib/stripe/connect.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSellerById } from '@/lib/marketplace/seller-client';
import { createOnboardingLink } from '@/lib/stripe/connect';
import { checkMarketplaceAccess } from '@/lib/marketplace/feature-flag';

export async function GET(request: NextRequest) {
  try {
    const access = checkMarketplaceAccess();
    if (!access.accessible) {
      return NextResponse.json({ error: 'Marketplace is not enabled' }, { status: 403 });
    }

    const sellerId = request.nextUrl.searchParams.get('seller_id');
    if (!sellerId) {
      return NextResponse.json({ error: 'seller_id is required' }, { status: 400 });
    }

    const seller = await getSellerById(sellerId);
    if (!seller || !seller.stripe_account_id) {
      return NextResponse.json(
        { error: 'Seller not found or no Stripe account connected' },
        { status: 404 }
      );
    }

    // Generate a new onboarding link
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.SITE_URL || '';
    const refreshUrl = `${baseUrl}/api/stripe/connect/refresh?seller_id=${sellerId}`;
    const returnUrl = `${baseUrl}/admin/sellers?connect_return=true&seller_id=${sellerId}`;

    const linkResult = await createOnboardingLink(seller.stripe_account_id, refreshUrl, returnUrl);
    if (!linkResult.success || !linkResult.url) {
      return NextResponse.json(
        { error: linkResult.error || 'Failed to create onboarding link' },
        { status: 500 }
      );
    }

    // Redirect seller back to Stripe onboarding
    return NextResponse.redirect(linkResult.url);
  } catch (error) {
    console.error('[Stripe Connect Refresh] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
