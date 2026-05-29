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
 * Replace the product links for an endpoint with the given set (replace
 * semantics, matching the v1 PATCH contract for tags/categories). Deduplicates
 * input; an empty set clears all links (endpoint then fires for no product when
 * in 'selected' mode).
 */
export async function replaceEndpointProducts(
  client: SupabaseClientLike,
  endpointId: string,
  productIds: string[],
): Promise<void> {
  const { error: deleteError } = await client
    .from('webhook_endpoint_products')
    .delete()
    .eq('webhook_endpoint_id', endpointId);
  if (deleteError) throw deleteError;

  const unique = Array.from(new Set(productIds));
  if (unique.length === 0) return;

  const rows = unique.map((product_id) => ({ webhook_endpoint_id: endpointId, product_id }));
  const { error: insertError } = await client.from('webhook_endpoint_products').insert(rows);
  if (insertError) throw insertError;
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
