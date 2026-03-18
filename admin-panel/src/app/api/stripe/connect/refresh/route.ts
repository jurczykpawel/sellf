/**
 * Stripe Connect Refresh Link API
 *
 * GET: Generate a new Account Link when the previous one expired.
 * Redirects the seller back to Stripe onboarding.
 * Accessible by platform admins and seller admins (own seller only).
 *
 * NOTE: This endpoint intentionally uses GET, not POST.
 * Stripe redirects the user's browser to `refresh_url` via HTTP 302 when
 * an account link expires or has already been visited. Browser redirects
 * are always GET requests — Stripe never POSTs to this URL directly.
 * Changing this to POST would break the Stripe Connect onboarding flow.
 * @see https://docs.stripe.com/api/account_links/create (refresh_url field)
 *
 * Query params:
 *   seller_id: string - the seller to refresh the link for
 *
 * @see src/lib/stripe/connect.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdminOrSellerApi } from '@/lib/auth-server';
import { checkMarketplaceAccess } from '@/lib/marketplace/feature-flag';
import { getSellerById } from '@/lib/marketplace/seller-client';
import { createOnboardingLink, buildOnboardingUrls } from '@/lib/stripe/connect';
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

    const sellerId = request.nextUrl.searchParams.get('seller_id');
    if (!sellerId) {
      return NextResponse.json({ error: 'seller_id is required' }, { status: 400 });
    }

    // Seller admins can only refresh their own link
    if (access.role === 'seller_admin') {
      const platform = createPlatformClient();
      const { data: ownSeller } = await platform
        .from('sellers')
        .select('id')
        .eq('user_id', access.user.id)
        .eq('status', 'active')
        .single();

      if (!ownSeller || ownSeller.id !== sellerId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const seller = await getSellerById(sellerId);
    if (!seller || !seller.stripe_account_id) {
      return NextResponse.json(
        { error: 'Seller not found or no Stripe account connected' },
        { status: 404 }
      );
    }

    // Generate a new onboarding link with context-appropriate return URL
    const urlContext = access.role === 'seller_admin' ? 'seller' : 'admin';
    const { refreshUrl, returnUrl } = buildOnboardingUrls(sellerId, urlContext);

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
    }

    console.error('[Stripe Connect Refresh] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
