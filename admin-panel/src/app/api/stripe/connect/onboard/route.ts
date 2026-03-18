/**
 * Stripe Connect Onboarding API
 *
 * POST: Create a new connected account for a seller + generate onboarding link.
 * Accessible by platform admins (any seller) and seller admins (own seller only).
 *
 * Request body:
 *   { sellerId: string, email: string }
 *
 * Response:
 *   { accountId: string, onboardingUrl: string }
 *
 * @see src/lib/stripe/connect.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdminOrSellerApi } from '@/lib/auth-server';
import { checkMarketplaceAccess } from '@/lib/marketplace/feature-flag';
import { getSellerById } from '@/lib/marketplace/seller-client';
import { createConnectedAccount, createOnboardingLink, buildOnboardingUrls } from '@/lib/stripe/connect';
import { checkRateLimit } from '@/lib/rate-limiting';
import { createPlatformClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
  try {
    // Marketplace feature gate
    const marketplaceAccess = await checkMarketplaceAccess();
    if (!marketplaceAccess.accessible) {
      return NextResponse.json({ error: 'Marketplace is not enabled' }, { status: 403 });
    }

    // Auth: admin or seller
    const supabase = await createClient();
    const access = await requireAdminOrSellerApi(supabase);

    // Rate limit: 10 onboard requests per 60 minutes per user
    const rateLimitOk = await checkRateLimit('stripe_connect_onboard', 10, 60, access.user.id);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Parse and validate input
    const body = await request.json();
    const { sellerId, email } = body as { sellerId?: string; email?: string };

    if (!sellerId || typeof sellerId !== 'string') {
      return NextResponse.json({ error: 'sellerId is required' }, { status: 400 });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    // Seller admins can only onboard THEMSELVES
    if (access.role === 'seller_admin') {
      const platform = createPlatformClient();
      const { data: ownSeller } = await platform
        .from('sellers')
        .select('id')
        .eq('user_id', access.user.id)
        .eq('status', 'active')
        .single();

      if (!ownSeller || ownSeller.id !== sellerId) {
        return NextResponse.json({ error: 'Forbidden - you can only onboard your own seller account' }, { status: 403 });
      }
    }

    // Look up seller
    const seller = await getSellerById(sellerId);
    if (!seller) {
      return NextResponse.json({ error: 'Seller not found' }, { status: 404 });
    }

    if (seller.stripe_account_id) {
      return NextResponse.json(
        { error: 'Seller already has a connected Stripe account. Use /refresh for a new onboarding link.' },
        { status: 409 }
      );
    }

    // Create connected account
    const accountResult = await createConnectedAccount(seller, email);
    if (!accountResult.success || !accountResult.accountId) {
      return NextResponse.json(
        { error: accountResult.error || 'Failed to create connected account' },
        { status: 500 }
      );
    }

    // Generate onboarding link with context-appropriate return URL
    const urlContext = access.role === 'seller_admin' ? 'seller' : 'admin';
    const { refreshUrl, returnUrl } = buildOnboardingUrls(sellerId, urlContext);

    const linkResult = await createOnboardingLink(accountResult.accountId, refreshUrl, returnUrl);
    if (!linkResult.success || !linkResult.url) {
      return NextResponse.json(
        { error: linkResult.error || 'Failed to create onboarding link' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      accountId: accountResult.accountId,
      onboardingUrl: linkResult.url,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (error.message === 'Forbidden') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    console.error('[Stripe Connect Onboard] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
