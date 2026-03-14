/**
 * Stripe Connect Onboarding API
 *
 * POST: Create a new connected account for a seller + generate onboarding link.
 * Admin-only endpoint.
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
import { requireMarketplaceAdmin } from '@/lib/auth-server';
import { getSellerById } from '@/lib/marketplace/seller-client';
import { createConnectedAccount, createOnboardingLink, buildOnboardingUrls } from '@/lib/stripe/connect';
import { checkRateLimit } from '@/lib/rate-limiting';

export async function POST(request: NextRequest) {
  try {
    // Auth: admin + marketplace gate
    const supabase = await createClient();
    const { user } = await requireMarketplaceAdmin(supabase);

    // Rate limit: 10 onboard requests per 60 minutes per admin
    const rateLimitOk = await checkRateLimit('stripe_connect_onboard', 10, 60, user.id);
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

    // Generate onboarding link
    const { refreshUrl, returnUrl } = buildOnboardingUrls(sellerId);

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
      if (error.message === 'Marketplace is not enabled') {
        return NextResponse.json({ error: 'Marketplace is not enabled' }, { status: 403 });
      }
    }

    console.error('[Stripe Connect Onboard] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
