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
  /** Whether main product user_product_access was revoked (or attempted) */
  mainProductRevoked: boolean;
  /** Whether main product guest_purchase was revoked (or attempted) */
  mainGuestRevoked: boolean;
  /** Number of bump products whose user_product_access was revoked */
  bumpProductsRevoked: number;
  /** Number of bump products whose guest_purchases were revoked */
  bumpGuestPurchasesRevoked: number;
  /** Non-fatal warnings (e.g. individual bump revocation failures) */
  warnings: string[];
}

/** UUID v4 pattern for defense-in-depth validation */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Revoke all product access (main + bumps) for a transaction.
 *
 * Designed to be idempotent — deleting rows that don't exist is a no-op.
 * Uses service_role client (the caller is responsible for passing one).
 */
export async function revokeTransactionAccess(
  supabase: SupabaseClient<any, any>,
  target: RevocationTarget,
): Promise<RevocationResult> {
  const warnings: string[] = [];
  let mainProductRevoked = false;
  let mainGuestRevoked = false;
  let bumpProductsRevoked = 0;
  const bumpGuestPurchasesRevoked = 0;

  // --- 0. Defense-in-depth input validation ---
  if (!target.transactionId || !UUID_PATTERN.test(target.transactionId)) {
    return {
      success: false,
      mainProductRevoked: false,
      mainGuestRevoked: false,
      bumpProductsRevoked: 0,
      bumpGuestPurchasesRevoked: 0,
      warnings: [`Invalid transactionId: ${target.transactionId ?? 'empty'}`],
    };
  }

  if (!target.productId || !UUID_PATTERN.test(target.productId)) {
    return {
      success: false,
      mainProductRevoked: false,
      mainGuestRevoked: false,
      bumpProductsRevoked: 0,
      bumpGuestPurchasesRevoked: 0,
      warnings: [`Invalid productId: ${target.productId ?? 'empty'}`],
    };
  }

  if (target.userId !== null && !UUID_PATTERN.test(target.userId)) {
    return {
      success: false,
      mainProductRevoked: false,
      mainGuestRevoked: false,
      bumpProductsRevoked: 0,
      bumpGuestPurchasesRevoked: 0,
      warnings: [`Invalid userId: ${target.userId}`],
    };
  }

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
    } else {
      mainProductRevoked = true;
    }

    // Bump products (batch DELETE to avoid N+1)
    if (bumpProductIds.length > 0) {
      const { error: bumpRevokeError } = await supabase
        .from('user_product_access')
        .delete()
        .eq('user_id', target.userId)
        .in('product_id', bumpProductIds);

      if (bumpRevokeError) {
        warnings.push(`Failed to revoke bump product access: ${bumpRevokeError.message}`);
      } else {
        bumpProductsRevoked = bumpProductIds.length;
      }
    }
  }

  // --- 3. Revoke guest_purchases (main product only — bumps don't have separate guest_purchases rows) ---
  // DB design: one guest_purchases row per session (main product). Bumps tracked via payment_line_items.
  if (target.sessionId && target.productId) {
    const { error: guestMainError } = await supabase
      .from('guest_purchases')
      .delete()
      .eq('session_id', target.sessionId)
      .eq('product_id', target.productId);

    if (guestMainError) {
      warnings.push(`Failed to revoke main guest purchase: ${guestMainError.message}`);
    } else {
      mainGuestRevoked = true;
    }
  }

  if (bumpProductsRevoked > 0 || mainProductRevoked || mainGuestRevoked) {
    console.log(
      `[access-revocation] transaction=${target.transactionId}: mainProduct=${mainProductRevoked}, mainGuest=${mainGuestRevoked}, bumps=${bumpProductsRevoked}`
    );
  }

  return {
    success: warnings.length === 0,
    mainProductRevoked,
    mainGuestRevoked,
    bumpProductsRevoked,
    bumpGuestPurchasesRevoked,
    warnings,
  };
}
