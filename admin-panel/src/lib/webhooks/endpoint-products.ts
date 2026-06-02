/**
 * Write/read side of the webhook_endpoint_products junction.
 *
 * Selection (dispatch) lives in endpoint-selection.ts; this module owns the
 * product links attached to an endpoint.
 *
 * @see /lib/webhooks/endpoint-selection.ts
 */

// Supabase clients with different schema types can't be unified via generics.
type SupabaseClientLike = any;

/**
 * Atomically set an endpoint's scoping mode and replace its product links in a
 * single transaction (Postgres RPC). Replace semantics, matching the v1 PATCH
 * contract for tags/categories. An empty set with mode 'selected' clears all
 * links; mode 'all' ignores the set. A failure rolls back fully, so an endpoint
 * never lands in a half-written state (e.g. 'selected' with no links).
 */
export async function setEndpointScoping(
  client: SupabaseClientLike,
  endpointId: string,
  mode: 'all' | 'selected',
  productIds: string[],
): Promise<void> {
  const { error } = await client.rpc('set_webhook_endpoint_scoping', {
    p_endpoint_id: endpointId,
    p_mode: mode,
    p_product_ids: productIds,
  });
  if (error) throw error;
}

/** Product ids linked to a single endpoint. */
export async function getEndpointProductIds(
  client: SupabaseClientLike,
  endpointId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from('webhook_endpoint_products')
    .select('product_id')
    .eq('webhook_endpoint_id', endpointId);
  if (error) throw error;
  return (data ?? []).map((r: { product_id: string }) => r.product_id);
}

/** Product ids grouped per endpoint, in one query (avoids N+1 in list views). */
export async function getEndpointProductIdsMap(
  client: SupabaseClientLike,
  endpointIds: string[],
): Promise<Record<string, string[]>> {
  if (endpointIds.length === 0) return {};
  const { data, error } = await client
    .from('webhook_endpoint_products')
    .select('webhook_endpoint_id, product_id')
    .in('webhook_endpoint_id', endpointIds);
  if (error) throw error;
  const map: Record<string, string[]> = {};
  for (const row of (data ?? []) as Array<{ webhook_endpoint_id: string; product_id: string }>) {
    (map[row.webhook_endpoint_id] ??= []).push(row.product_id);
  }
  return map;
}
