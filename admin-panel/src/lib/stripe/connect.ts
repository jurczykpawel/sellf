/**
 * Stripe Connect Standard — Account Links API
 *
 * Handles seller onboarding to Stripe Connect Standard.
 * Each seller connects their own full Stripe account — no vendor lock-in.
 *
 * Flow:
 * 1. Admin provisions seller → stripe.accounts.create({ type: 'standard' })
 * 2. stripe.accountLinks.create() → onboarding URL
 * 3. Seller completes onboarding on Stripe
 * 4. account.updated webhook → update sellers.stripe_onboarding_complete
 *
 * @see priv/MARKETPLACE-PLAN.md — architecture & decisions
 * @see src/lib/marketplace/seller-client.ts — seller lookup
 */

import Stripe from 'stripe';
import { getStripeServer } from '@/lib/stripe/server';
import { createPlatformClient } from '@/lib/supabase/admin';
import type { SellerInfo } from '@/lib/marketplace/seller-client';

// ===== TYPES =====

interface ConnectAccountResult {
  success: boolean;
  accountId?: string;
  error?: string;
}

interface OnboardingLinkResult {
  success: boolean;
  url?: string;
  error?: string;
}

export interface ConnectAccountStatus {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardingComplete: boolean;
}

// ===== URL HELPERS =====

/**
 * Build Stripe Connect onboarding URLs for a seller.
 * Extracted to avoid duplication between onboard and refresh routes.
 *
 * @param sellerId - The seller's database ID
 * @param context - 'admin' returns to /admin/sellers, 'seller' returns to /dashboard/settings
 */
export function buildOnboardingUrls(sellerId: string, context: 'admin' | 'seller' = 'admin'): { refreshUrl: string; returnUrl: string } {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.SITE_URL || '';
  const returnUrl = context === 'seller'
    ? `${baseUrl}/dashboard/settings?stripe_connected=true`
    : `${baseUrl}/admin/sellers?connect_return=true&seller_id=${sellerId}`;
  return {
    refreshUrl: `${baseUrl}/api/stripe/connect/refresh?seller_id=${sellerId}`,
    returnUrl,
  };
}

// ===== ACCOUNT MANAGEMENT =====

/**
 * Create a new Stripe Connect Standard account for a seller.
 * Does NOT create the onboarding link — call createOnboardingLink() after.
 *
 * @param seller - Seller info from public.sellers
 * @param email - Seller's email for the connected account
 * @returns ConnectAccountResult with the new account ID
 */
export async function createConnectedAccount(
  seller: Pick<SellerInfo, 'id' | 'slug' | 'display_name'>,
  email: string
): Promise<ConnectAccountResult> {
  try {
    const stripe = await getStripeServer();

    const account = await stripe.accounts.create({
      type: 'standard',
      email,
      metadata: {
        seller_id: seller.id,
        seller_slug: seller.slug,
        platform: 'sellf',
      },
      business_profile: {
        name: seller.display_name,
      },
    });

    // Update sellers table with the new account ID
    const platform = createPlatformClient();
    const { error: updateError } = await platform
      .from('sellers')
      .update({
        stripe_account_id: account.id,
        stripe_onboarding_complete: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', seller.id);

    if (updateError) {
      console.error('[Stripe Connect] Failed to update seller with account ID:', updateError);
      // Account was created on Stripe — return success but log warning
      // The webhook will eventually sync the status
    }

    return { success: true, accountId: account.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Stripe Connect] Failed to create connected account:', message);
    return { success: false, error: message };
  }
}

/**
 * Create an Account Link for seller onboarding.
 * The seller is redirected to Stripe to complete their account setup.
 *
 * @param accountId - Stripe connected account ID (acct_xxx)
 * @param refreshUrl - URL when the link expires (re-generate link)
 * @param returnUrl - URL when onboarding is complete or user exits
 */
export async function createOnboardingLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string
): Promise<OnboardingLinkResult> {
  try {
    const stripe = await getStripeServer();

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return { success: true, url: accountLink.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Stripe Connect] Failed to create onboarding link:', message);
    return { success: false, error: message };
  }
}

/**
 * Get the full status of a connected Stripe account.
 * Used to check if onboarding is complete and charges/payouts are enabled.
 */
export async function getConnectedAccountStatus(accountId: string): Promise<ConnectAccountStatus | null> {
  try {
    const stripe = await getStripeServer();
    const account = await stripe.accounts.retrieve(accountId);

    return {
      accountId: account.id,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
      onboardingComplete: (account.charges_enabled && account.details_submitted) ?? false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Stripe Connect] Failed to retrieve account status:', message);
    return null;
  }
}

/**
 * Check if a connected account has completed onboarding.
 * Lightweight check — use getConnectedAccountStatus() for full details.
 */
export async function isOnboardingComplete(accountId: string): Promise<boolean> {
  const status = await getConnectedAccountStatus(accountId);
  return status?.onboardingComplete ?? false;
}

/**
 * Disconnect a seller's Stripe account.
 * Removes the account link from the platform — the seller keeps their Stripe account.
 * This is consistent with Standard Connect: no vendor lock-in.
 */
export async function disconnectAccount(sellerId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const platform = createPlatformClient();

    // Get seller's current account ID
    const { data: seller, error: fetchError } = await platform
      .from('sellers')
      .select('stripe_account_id')
      .eq('id', sellerId)
      .single();

    if (fetchError || !seller?.stripe_account_id) {
      return { success: false, error: 'Seller not found or no Stripe account connected' };
    }

    // Remove Stripe link on our side — seller keeps their account
    const { error: updateError } = await platform
      .from('sellers')
      .update({
        stripe_account_id: null,
        stripe_onboarding_complete: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sellerId);

    if (updateError) {
      return { success: false, error: 'Failed to update seller record' };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Stripe Connect] Failed to disconnect account:', message);
    return { success: false, error: message };
  }
}

// ===== WEBHOOK HANDLERS =====

/**
 * Handle account.updated webhook event.
 * Syncs onboarding status from Stripe to our sellers table.
 *
 * Called by the main Stripe webhook handler when receiving account.updated events.
 */
export async function handleAccountUpdated(
  account: Stripe.Account
): Promise<{ processed: boolean; message: string }> {
  const accountId = account.id;

  const platform = createPlatformClient();

  // Find seller by stripe_account_id
  const { data: seller, error: fetchError } = await platform
    .from('sellers')
    .select('id, stripe_onboarding_complete')
    .eq('stripe_account_id', accountId)
    .single();

  if (fetchError || !seller) {
    // Not our account — ignore (Stripe sends events for all connected accounts)
    return { processed: true, message: `No seller found for account ${accountId}` };
  }

  const onboardingComplete = (account.charges_enabled && account.details_submitted) ?? false;

  // Only update if status changed
  if (seller.stripe_onboarding_complete !== onboardingComplete) {
    const { error: updateError } = await platform
      .from('sellers')
      .update({
        stripe_onboarding_complete: onboardingComplete,
        updated_at: new Date().toISOString(),
      })
      .eq('id', seller.id);

    if (updateError) {
      console.error('[Stripe Connect] Failed to update onboarding status:', updateError);
      return { processed: false, message: 'Failed to update seller onboarding status' };
    }

    console.log(`[Stripe Connect] Seller ${seller.id} onboarding status updated: ${onboardingComplete}`);
  }

  return { processed: true, message: `Account ${accountId} status synced (onboarding: ${onboardingComplete})` };
}

/**
 * Handle account.application.deauthorized webhook event.
 * Seller has disconnected their Stripe account from our platform.
 * We clear the Stripe association but keep the seller record.
 *
 * @param accountId - The connected account ID (from event.account)
 */
export async function handleAccountDeauthorized(
  accountId: string
): Promise<{ processed: boolean; message: string }> {

  const platform = createPlatformClient();

  // Find seller by stripe_account_id
  const { data: seller, error: fetchError } = await platform
    .from('sellers')
    .select('id')
    .eq('stripe_account_id', accountId)
    .single();

  if (fetchError || !seller) {
    return { processed: true, message: `No seller found for deauthorized account ${accountId}` };
  }

  // Clear Stripe association
  const { error: updateError } = await platform
    .from('sellers')
    .update({
      stripe_account_id: null,
      stripe_onboarding_complete: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', seller.id);

  if (updateError) {
    console.error('[Stripe Connect] Failed to clear deauthorized account:', updateError);
    return { processed: false, message: 'Failed to clear seller Stripe association' };
  }

  console.log(`[Stripe Connect] Seller ${seller.id} deauthorized account ${accountId}`);
  return { processed: true, message: `Account ${accountId} deauthorized and cleared from seller ${seller.id}` };
}
