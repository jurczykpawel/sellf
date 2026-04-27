/**
 * Pure filter for user_product_access rows: keeps only entries that are
 * currently usable (product still exists, access not yet expired).
 *
 * Mirrors the server-side rule used by check_user_product_access RPC and
 * /api/public/products/[slug]/access — keep this consistent with both.
 *
 * Reusable across `/my-products`, dashboard summaries, mobile clients, etc.
 * Pure function; safe to unit-test without rendering.
 */

export interface AccessRowLike {
  access_expires_at: string | null;
  product: unknown;
}

export function filterActiveAccess<T extends AccessRowLike>(rows: T[], now: Date = new Date()): T[] {
  return rows.filter((row) => {
    if (row.product === null || row.product === undefined) return false;
    if (row.access_expires_at && new Date(row.access_expires_at) < now) return false;
    return true;
  });
}
