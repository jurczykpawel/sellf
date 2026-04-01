import type { SupabaseClient } from '@supabase/supabase-js';

export interface FreeProductInput {
  product: {
    id: string;
    slug: string;
    price: number;
    isPwywFree: boolean;
  };
  user: {
    id: string;
    email: string;
  };
}

export interface FreeProductAccessResult {
  alreadyHadAccess: boolean;
  accessGranted: boolean;
  otoInfo: Record<string, unknown> | null;
  error?: string;
}

/**
 * Grants access to a free (or PWYW-free) product and generates an OTO coupon if one is configured.
 *
 * Called from:
 * - /api/public/products/[slug]/grant-access  (primary path via FreeProductForm)
 * - /p/[slug]/payment-status                  (fallback when user arrives without session_id)
 *
 * @param userClient   Authenticated user client (for RPC calls that need auth.uid())
 * @param adminClient  Service role client, schema-scoped for marketplace (needed for
 *                     access check + generate_oto_coupon which bypass RLS)
 */
export async function grantFreeProductAccess(
  userClient: SupabaseClient<any, any>,
  adminClient: SupabaseClient<any, any>,
  { product, user }: FreeProductInput,
): Promise<FreeProductAccessResult> {
  // 1. Check whether user already has valid (non-expired) access
  // Use adminClient (schema-scoped) — in marketplace, user_product_access lives in seller schema
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

    if (!isExpired) {
      alreadyHadAccess = true;
    }
  }

  // 2. Grant access only if not already granted
  if (!alreadyHadAccess) {
    // PWYW-free: product has a non-zero list price but custom_price_min = 0 → use dedicated RPC
    const rpcName =
      product.isPwywFree && product.price > 0
        ? 'grant_pwyw_free_access'
        : 'grant_free_product_access';

    // Use adminClient (service_role, schema-scoped) for the grant.
    // grant_free_product_access uses auth.uid() which isn't available with service_role,
    // so for marketplace (adminClient != userClient) use grant_product_access_service_role
    // which accepts explicit user_id parameter.
    let grantResult: boolean | null = null;
    let grantError: Error | null = null;

    if (adminClient !== userClient) {
      // Marketplace: service_role grant with explicit user_id (no auth.uid() needed)
      const { data, error } = await adminClient.rpc('grant_product_access_service_role', {
        user_id_param: user.id,
        product_id_param: product.id,
      });
      grantResult = data;
      grantError = error;
    } else {
      // Platform: user client with auth.uid()
      const { data, error } = await userClient.rpc(rpcName, {
        product_slug_param: product.slug,
      });
      grantResult = data;
      grantError = error;
    }

    if (grantError) {
      console.error('[grantFreeProductAccess] RPC error:', grantError);
      return { alreadyHadAccess: false, accessGranted: false, otoInfo: null, error: 'Failed to grant access' };
    }

    if (!grantResult) {
      return {
        alreadyHadAccess: false,
        accessGranted: false,
        otoInfo: null,
        error: 'Failed to grant access - product may not be free or active',
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
      // transaction_id_param omitted — free products have no payment transaction
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
