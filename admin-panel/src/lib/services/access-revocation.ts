/**
 * Centralized access revocation for refunds, chargebacks, and disputes.
 *
 * Single source of truth — every refund path (webhook, admin API, V1 API,
 * server action, refund-request approval) must call this function instead
 * of inlining revocation queries.
 *
 * Revokes:
 * 1. Main product — user_product_access
 * 2. Bump products — user_product_access (via payment_line_items)
 * 3. Main product — guest_purchases
 * 4. Bump products — guest_purchases (via payment_line_items)
 *
 * @see supabase/migrations/20260310175058_multi_order_bumps.sql — payment_line_items table
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RevocationTarget {
  /** payment_transactions.id — used to look up bump products in payment_line_items */
  transactionId: string;
  /** User UUID (null for guest-only purchases) */
  userId: string | null;
  /** Main product UUID */
  productId: string;
  /** Stripe checkout session_id or payment intent ID — used for guest_purchases cleanup */
  sessionId: string | null;
}

export interface RevocationResult {
  /** Whether the revocation completed without critical errors */
  success: boolean;
  /** Number of bump products whose access was revoked */
  bumpProductsRevoked: number;
  /** Non-fatal warnings (e.g. individual bump revocation failures) */
  warnings: string[];
}

/**
 * Revoke all product access (main + bumps) for a transaction.
 *
 * Designed to be idempotent — deleting rows that don't exist is a no-op.
 * Uses service_role client (the caller is responsible for passing one).
 */
export async function revokeTransactionAccess(
  supabase: SupabaseClient,
  target: RevocationTarget,
): Promise<RevocationResult> {
  const warnings: string[] = [];
  let bumpProductsRevoked = 0;

  // --- 1. Query bump product IDs from payment_line_items (single query, reused below) ---
  const { data: bumpLineItems, error: bumpQueryError } = await supabase
    .from('payment_line_items')
    .select('product_id')
    .eq('transaction_id', target.transactionId)
    .eq('item_type', 'order_bump');

  if (bumpQueryError) {
    warnings.push(`Failed to query bump line items: ${bumpQueryError.message}`);
  }

  const bumpProductIds = (bumpLineItems ?? []).map((item: { product_id: string }) => item.product_id);

  // --- 2. Revoke user_product_access (main + bumps) ---
  if (target.userId && target.productId) {
    // Main product
    const { error: mainRevokeError } = await supabase
      .from('user_product_access')
      .delete()
      .eq('user_id', target.userId)
      .eq('product_id', target.productId);

    if (mainRevokeError) {
      warnings.push(`Failed to revoke main product access: ${mainRevokeError.message}`);
    }

    // Bump products
    for (const bumpProductId of bumpProductIds) {
      const { error: bumpRevokeError } = await supabase
        .from('user_product_access')
        .delete()
        .eq('user_id', target.userId)
        .eq('product_id', bumpProductId);

      if (bumpRevokeError) {
        warnings.push(`Failed to revoke bump product ${bumpProductId} access: ${bumpRevokeError.message}`);
      } else {
        bumpProductsRevoked++;
      }
    }
  }

  // --- 3. Revoke guest_purchases (main + bumps) ---
  if (target.sessionId && target.productId) {
    // Main product
    const { error: guestMainError } = await supabase
      .from('guest_purchases')
      .delete()
      .eq('session_id', target.sessionId)
      .eq('product_id', target.productId);

    if (guestMainError) {
      warnings.push(`Failed to revoke main guest purchase: ${guestMainError.message}`);
    }

    // Bump products
    for (const bumpProductId of bumpProductIds) {
      const { error: guestBumpError } = await supabase
        .from('guest_purchases')
        .delete()
        .eq('session_id', target.sessionId)
        .eq('product_id', bumpProductId);

      if (guestBumpError) {
        warnings.push(`Failed to revoke guest bump product ${bumpProductId}: ${guestBumpError.message}`);
      }
    }
  }

  if (bumpProductsRevoked > 0) {
    console.log(`[access-revocation] Revoked access for ${bumpProductsRevoked} bump product(s) for transaction ${target.transactionId}`);
  }

  return {
    success: warnings.length === 0,
    bumpProductsRevoked,
    warnings,
  };
}
