import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { grantFreeProductAccess } from '@/lib/services/free-product-access';

/**
 * Pending free-product grants.
 *
 * A free product requested by e-mail is remembered on the account
 * (`app_metadata.pending_free_grants`) when the magic link goes out, and
 * granted on the next sign-in through any path — not only through the
 * product-access link from that e-mail.
 *
 * @see supabase/migrations/20260911000000_pending_free_grants.sql
 * @see src/app/[locale]/auth/callback/route.ts
 */

export interface PendingGrantUser {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown>;
}

export interface ClaimPendingFreeGrantsInput {
  /** Client authenticated as `user` — the grant RPC relies on auth.uid(). */
  userClient: SupabaseClient<any, any>;
  user: PendingGrantUser;
  /** Product the post-login redirect grants itself (keeps its success_url / OTO page). */
  skipSlug?: string;
}

interface PendingProductRow {
  product_id: string;
  slug: string;
}

const PRODUCT_ACCESS_PATH = /^\/(?:[a-z]{2}\/)?auth\/product-access\/?$/;

export async function queuePendingFreeGrant(email: string, productSlug: string): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc('queue_pending_free_grant', {
      p_email: email,
      p_product_slug: productSlug,
    });
    if (error) console.error('[queuePendingFreeGrant] RPC error:', error.message);
  } catch (err) {
    console.error('[queuePendingFreeGrant] Error:', err instanceof Error ? err.message : 'Unknown error');
  }
}

function hasPendingGrants(user: PendingGrantUser): boolean {
  const pending = user.app_metadata?.pending_free_grants;
  return Array.isArray(pending) && pending.length > 0;
}

/** Grants every pending free product; never throws. Returns how many were granted. */
export async function claimPendingFreeGrants({
  userClient,
  user,
  skipSlug,
}: ClaimPendingFreeGrantsInput): Promise<number> {
  if (!hasPendingGrants(user)) return 0;

  let rows: PendingProductRow[];
  try {
    const { data, error } = await userClient.rpc('pending_free_grant_products');
    if (error || !Array.isArray(data)) {
      if (error) console.error('[claimPendingFreeGrants] Lookup error:', error.message);
      return 0;
    }
    rows = data as PendingProductRow[];
  } catch (err) {
    console.error('[claimPendingFreeGrants] Lookup error:', err instanceof Error ? err.message : 'Unknown error');
    return 0;
  }

  const adminClient = createAdminClient();
  let granted = 0;
  for (const row of rows) {
    if (row.slug === skipSlug) continue;
    try {
      const result = await grantFreeProductAccess(userClient, adminClient, {
        product: { id: row.product_id, slug: row.slug },
        user: { id: user.id, email: user.email ?? '' },
      });
      if (result.accessGranted) granted += 1;
    } catch (err) {
      console.error('[claimPendingFreeGrants] Grant error:', err instanceof Error ? err.message : 'Unknown error');
    }
  }
  return granted;
}

/** Slug the post-login redirect will grant on its own, if it goes to /auth/product-access. */
export function productSlugHandledByRedirect(redirectPath: string): string | undefined {
  try {
    const url = new URL(redirectPath, 'http://internal.invalid');
    if (!PRODUCT_ACCESS_PATH.test(url.pathname)) return undefined;
    return url.searchParams.get('product') || undefined;
  } catch {
    return undefined;
  }
}
