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
 * 3. Bundle components the order granted — user_product_access (via revoke_order_bundle_components;
 *    components the buyer still holds through another paid order or another live bundle access stay)
 * 4. Main product — guest_purchases
 * 5. Bump products — guest_purchases (via payment_line_items)
 *
 * @see supabase/migrations/20260310175058_multi_order_bumps.sql — payment_line_items table
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql — order_bundle_components
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RevocationTarget {
  /** payment_transactions.id — used to look up bump products in payment_line_items */
  transactionId: string;
  /** User UUID (null for guest-only purchases) */
  userId: string | null;
  /** Main product UUID (null once the product was permanently deleted — its access went with it) */
  productId: string | null;
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
  /** Number of bundle-component access rows the order granted that were revoked */
  bundleComponentsRevoked: number;
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
  let bundleComponentsRevoked = 0;
  const bumpGuestPurchasesRevoked = 0;

  // --- 0. Defense-in-depth input validation ---
  if (!target.transactionId || !UUID_PATTERN.test(target.transactionId)) {
    return {
      success: false,
      mainProductRevoked: false,
      mainGuestRevoked: false,
      bumpProductsRevoked: 0,
      bumpGuestPurchasesRevoked: 0,
      bundleComponentsRevoked: 0,
      warnings: [`Invalid transactionId: ${target.transactionId ?? 'empty'}`],
    };
  }

  if (target.productId !== null && !UUID_PATTERN.test(target.productId)) {
    return {
      success: false,
      mainProductRevoked: false,
      mainGuestRevoked: false,
      bumpProductsRevoked: 0,
      bumpGuestPurchasesRevoked: 0,
      bundleComponentsRevoked: 0,
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
      bundleComponentsRevoked: 0,
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

  const bumpProductIds = (bumpLineItems ?? [])
    .map((item: { product_id: string | null }) => item.product_id)
    .filter((id): id is string => id !== null);

  // --- 2. Revoke user_product_access (main + bumps) ---
  if (target.userId) {
    if (target.productId) {
      const { data: revoked, error: mainRevokeError } = await supabase
        .rpc('revoke_order_product_access', { p_transaction_id: target.transactionId, p_user_id: target.userId, p_product_id: target.productId });

      if (mainRevokeError) {
        warnings.push(`Failed to revoke main product access: ${mainRevokeError.message}`);
      } else {
        mainProductRevoked = revoked === true;
      }
    }

    for (const productId of bumpProductIds) {
      const { data: revoked, error } = await supabase.rpc('revoke_order_product_access', {
        p_transaction_id: target.transactionId, p_user_id: target.userId, p_product_id: productId,
      });
      if (error) warnings.push(`Failed to revoke bump product access: ${error.message}`);
      else if (revoked === true) bumpProductsRevoked++;
    }

    // Bundle components granted by this order (runs before the guest claim rows go away).
    const { data: componentsRevoked, error: componentRevokeError } = await supabase
      .rpc('revoke_order_bundle_components', { p_transaction_id: target.transactionId, p_user_id: target.userId });
    if (componentRevokeError) {
      warnings.push(`Failed to revoke bundle component access: ${componentRevokeError.message}`);
    } else {
      bundleComponentsRevoked = typeof componentsRevoked === 'number' ? componentsRevoked : 0;
    }
  }

  // --- 3. Revoke guest_purchases (main product only — bumps don't have separate guest_purchases rows) ---
  // DB design: one guest_purchases row per session (main product). Bumps tracked via payment_line_items.
  if (target.productId) {
    const { error: guestTransactionError } = await supabase
      .from('guest_purchases')
      .delete()
      .eq('transaction_id', target.transactionId)
      .eq('product_id', target.productId);

    if (guestTransactionError) {
      warnings.push(`Failed to revoke guest transaction: ${guestTransactionError.message}`);
    } else {
      mainGuestRevoked = true;
    }
  }

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

  if (bumpProductsRevoked > 0 || bundleComponentsRevoked > 0 || mainProductRevoked || mainGuestRevoked) {
    console.log(
      `[access-revocation] transaction=${target.transactionId}: mainProduct=${mainProductRevoked}, mainGuest=${mainGuestRevoked}, bumps=${bumpProductsRevoked}, components=${bundleComponentsRevoked}`
    );
  }

  return {
    success: warnings.length === 0,
    mainProductRevoked,
    mainGuestRevoked,
    bumpProductsRevoked,
    bumpGuestPurchasesRevoked,
    bundleComponentsRevoked,
    warnings,
  };
}
