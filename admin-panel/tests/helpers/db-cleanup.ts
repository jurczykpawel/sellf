/**
 * Shared teardown helpers for behavioral/integration tests that create real rows in the local
 * Supabase database.
 *
 * `bundle_items.component_product_id` is `ON DELETE RESTRICT` (see
 * supabase/migrations/20260625000000_product_bundles.sql) — a test that links a bundle to
 * component products must clear `bundle_items` in BOTH directions before deleting the products,
 * or the delete can fail. Supabase-js delete() calls don't throw on error by default, so a failed
 * cleanup step silently leaves rows behind unless the caller checks `{ error }` itself — use
 * `deleteChecked` for that.
 */

import { execFileSync } from 'node:child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTestDatabaseContainer } from './database-container';

/** A minimal shape covering the builders returned by `supabase.from(...).delete()...`. */
type Deletable = PromiseLike<{ error: { message: string } | null }>;

/**
 * Await a Supabase delete/update builder and throw if it reports an error, so a broken cleanup
 * step fails the test run loudly instead of leaving orphaned rows behind unnoticed.
 */
export async function deleteChecked(label: string, query: Deletable): Promise<void> {
  const { error } = await query;
  if (error) throw new Error(`cleanup ${label} failed: ${error.message}`);
}

/**
 * Deletes every `bundle_items` row referencing any of `productIds`, in either FK direction.
 * Must run before deleting from `products` whenever a test links bundles/components via
 * `bundle_items` — otherwise the RESTRICT on `component_product_id` can block the products delete.
 */
export async function deleteBundleItemsFor(db: SupabaseClient, productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;
  await deleteChecked('bundle_items (component)', db.from('bundle_items').delete().in('component_product_id', productIds));
  await deleteChecked('bundle_items (bundle)', db.from('bundle_items').delete().in('bundle_product_id', productIds));
}

/**
 * Deletes every `oto_offers` row referencing any of `productIds` (as source, upsell, or
 * downsell product). Must run before deleting from `products` whenever a test creates an
 * `oto_offers` row with a downsell configured — `downsell_product_id` is ON DELETE SET NULL, but
 * the `oto_offers_downsell_consistency` CHECK constraint requires the three downsell columns to
 * be all-null or all-set together, so a bare SET NULL (from deleting the downsell product without
 * deleting the offer row itself) violates that constraint and fails the products delete.
 */
export async function deleteOtoOffersFor(db: SupabaseClient, productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;
  const cols = ['source_product_id', 'oto_product_id', 'downsell_product_id'];
  await deleteChecked(
    'oto_offers',
    db.from('oto_offers').delete().or(cols.map((c) => `${c}.in.(${productIds.join(',')})`).join(',')),
  );
}

/**
 * Deletes auth users created by a test via the Admin API.
 *
 * Every row referencing the user across the schema is either removed with it (per-account data
 * — access grants, sessions, admin membership) or kept with the reference set to NULL (financial
 * and audit records — see supabase/migrations/20260924000000_access_scope_tightening.sql), so a
 * plain deleteUser() succeeds without any manual cleanup of `audit_log` first.
 */
export async function deleteAuthUsers(db: SupabaseClient, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  for (const id of userIds) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) throw new Error(`cleanup auth user ${id} failed: ${error.message}`);
  }
}

/**
 * Deletes an auth user that a test only knows by email — e.g. a guest checkout flow that
 * triggers a trusted magic link (`sendTrustedMagicLink()`), which materializes the account
 * immediately even though nobody ever clicks the link. Resolves the id via the
 * `find_user_id_by_email` RPC first; no-ops if no such account exists (e.g. the flow never
 * reached that point in a given test run).
 */
export async function deleteAuthUserByEmail(db: SupabaseClient, email: string): Promise<void> {
  const { data: userId, error } = await db.rpc('find_user_id_by_email', { p_email: email });
  if (error) throw new Error(`cleanup lookup for ${email} failed: ${error.message}`);
  if (userId) await deleteAuthUsers(db, [userId as string]);
}

/**
 * Deletes every `coupons` row auto-minted (by the `generate_oto_coupon` RPC, via the
 * `/payment-status` verification flow) for a given buyer e-mail. These rows have no FK to the
 * product/offer/transaction they were minted for (those columns are ON DELETE SET NULL), so
 * deleting the related fixtures never removes the coupon — it has to be deleted by code.
 *
 * `allowed_emails` is jsonb, not a native Postgres array — `.contains()` needs a JSON string,
 * not a JS array, or supabase-js builds a Postgres array literal (`{...}`) that PostgREST
 * rejects with "invalid input syntax for type json".
 */
export async function deleteCouponsForEmail(db: SupabaseClient, email: string): Promise<void> {
  await deleteChecked(
    'coupons',
    db.from('coupons').delete().contains('allowed_emails', JSON.stringify([email])),
  );
}

export function deferPendingBusinessEvents(): () => void {
  const container = getTestDatabaseContainer();
  const sql = (input: string) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  const pending = sql(`WITH previous AS MATERIALIZED (
    SELECT id, next_attempt_at FROM public.business_events WHERE dispatched_at IS NULL AND abandoned_at IS NULL
  ), deferred AS (
    UPDATE public.business_events b SET next_attempt_at = clock_timestamp() + interval '1 day'
      FROM previous p WHERE b.id = p.id RETURNING b.id
  ) SELECT coalesce(jsonb_agg(p), '[]') FROM previous p JOIN deferred USING (id);`).trim();
  return () => {
    sql(`UPDATE public.business_events b SET next_attempt_at = p.next_attempt_at
      FROM jsonb_to_recordset($pending$${pending}$pending$::jsonb) AS p(id uuid, next_attempt_at timestamptz)
      WHERE b.id = p.id AND b.dispatched_at IS NULL;`);
  };
}
