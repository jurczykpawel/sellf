import type { SupabaseClient } from '@supabase/supabase-js';

export interface FreeProductInput {
  product: {
    id: string;
    slug: string;
  };
  user: {
    id: string;
    email: string;
  };
  /**
   * When set, this grant is driven by a full-discount coupon on a paid product.
   * The unified grant_free_product_access RPC validates the coupon internally
   * (via verify_coupon), enforces the full-discount rule, and records the
   * redemption + bumps the usage counter atomically with the UPA upsert.
   */
  couponCode?: string;
}

export interface FreeProductAccessResult {
  alreadyHadAccess: boolean;
  accessGranted: boolean;
  otoInfo: Record<string, unknown> | null;
  error?: string;
}

/**
 * Grants free access to a product and generates an OTO coupon if configured.
 *
 * The unified seller_main.grant_free_product_access RPC handles eligibility
 * across all three paths (price=0 / PWYW-free / full-discount coupon) in a
 * single atomic transaction, so the service stays thin: detect "already had
 * access", call the RPC, generate OTO.
 *
 * Called from:
 *   - /api/public/products/[slug]/grant-access  (FreeProductForm + coupon redeem)
 *   - /auth/product-access                       (magic-link callback)
 *   - /p/[slug]/payment-status                  (fallback when user arrives without session_id)
 *
 * @param userClient   Authenticated user client (RPC uses auth.uid())
 * @param adminClient  Service role client (for access check + OTO generation)
 */
export async function grantFreeProductAccess(
  userClient: SupabaseClient<any, any>,
  adminClient: SupabaseClient<any, any>,
  { product, user, couponCode }: FreeProductInput,
): Promise<FreeProductAccessResult> {
  // 1. Pre-check for existing active access so callers can distinguish a fresh
  //    grant from a repeat click. The RPC would also short-circuit, but it
  //    returns plain TRUE either way — we need the flag for UI + analytics.
  const { data: existingAccess } = await adminClient
    .from('user_product_access')
    .select('access_expires_at')
    .eq('user_id', user.id)
    .eq('product_id', product.id)
    .single();

  let alreadyHadAccess = false;
  if (existingAccess) {
    const expiresAt = existingAccess.access_expires_at
      ? new Date(existingAccess.access_expires_at)
      : null;
    const isExpired = expiresAt && expiresAt < new Date();
    if (!isExpired) alreadyHadAccess = true;
  }

  // 2. Call the unified grant RPC. It handles:
  //    - coupon validation (via verify_coupon) + full-discount assertion
  //    - price=0 / PWYW-free eligibility
  //    - UPA upsert
  //    - coupon_redemptions insert + usage counter bump + reservation cleanup
  //    all in one transaction.
  if (!alreadyHadAccess) {
    const { data: grantResult, error: grantError } = await userClient.rpc(
      'grant_free_product_access',
      {
        product_slug_param: product.slug,
        coupon_code_param: couponCode ?? null,
      },
    );

    if (grantError) {
      console.error('[grantFreeProductAccess] RPC error:', grantError);
      return { alreadyHadAccess: false, accessGranted: false, otoInfo: null, error: 'Failed to grant access' };
    }

    if (!grantResult) {
      return {
        alreadyHadAccess: false,
        accessGranted: false,
        otoInfo: null,
        error: 'Failed to grant access - product may not be free or the coupon is invalid',
      };
    }
  }

  // 3. Generate OTO coupon — runs for both new grants AND already-had-access cases.
  //    Idempotent: the partial unique index (oto_offer_id + allowed_emails WHERE transaction_id IS NULL)
  //    ensures the same coupon is returned on repeated calls.
  let otoInfo: Record<string, unknown> | null = null;
  try {
    const { data: otoResult, error: otoError } = await adminClient.rpc('generate_oto_coupon', {
      source_product_id_param: product.id,
      customer_email_param: user.email,
    });

    if (otoError) {
      console.error('[grantFreeProductAccess] OTO generation error:', otoError);
    } else {
      const otoResultObj = otoResult as Record<string, unknown> | null;
      if (otoResultObj?.has_oto) {
        otoInfo = otoResultObj;
      }
    }
  } catch (otoErr) {
    console.error('[grantFreeProductAccess] OTO generation exception:', otoErr);
  }

  return { alreadyHadAccess, accessGranted: true, otoInfo };
}
