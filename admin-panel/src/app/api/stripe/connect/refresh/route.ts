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
import { createClient } from '@/lib/supabase/server';
import { requireMarketplaceAdmin } from '@/lib/auth-server';
import { getSellerById } from '@/lib/marketplace/seller-client';
import { createOnboardingLink, buildOnboardingUrls } from '@/lib/stripe/connect';

export async function GET(request: NextRequest) {
  try {
    // Auth: admin + marketplace gate (K3 — was missing authentication)
    const supabase = await createClient();
    await requireMarketplaceAdmin(supabase);

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
    const { refreshUrl, returnUrl } = buildOnboardingUrls(sellerId);

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

    console.error('[Stripe Connect Refresh] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
