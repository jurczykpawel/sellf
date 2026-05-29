/**
 * Pure endpoint-selection logic for webhook dispatch.
 *
 * Given the candidate endpoints already matched on event + active state, decide
 * which ones fire for a given product context. Kept free of IO so it is fully
 * unit-testable; the DB lookup of linked endpoints lives in WebhookService.
 *
 * @see /lib/services/webhook-service.ts
 */

export interface SelectableEndpoint {
  id: string;
  product_filter_mode: 'all' | 'selected';
}

/**
 * - No product context (account-level event): every candidate fires.
 * - With product context: 'all' endpoints always fire; 'selected' endpoints fire
 *   only when linked to at least one product in the event (membership resolved
 *   upstream into linkedEndpointIds).
 */
export function selectEligibleEndpoints<T extends SelectableEndpoint>(
  candidates: T[],
  linkedEndpointIds: Set<string>,
  hasProductContext: boolean,
): string[] {
  if (!hasProductContext) {
    return candidates.map((c) => c.id);
  }

  return candidates
    .filter((c) => c.product_filter_mode === 'all' || linkedEndpointIds.has(c.id))
    .map((c) => c.id);
}

// Supabase clients with different schema types can't be unified via generics.
type SupabaseClientLike = any;

export interface EligibleEndpoint {
  id: string;
  url: string;
  secret: string;
}

function normalizeProductIds(productIds?: string | string[]): string[] {
  if (!productIds) return [];
  return (Array.isArray(productIds) ? productIds : [productIds]).filter(Boolean);
}

/**
 * Resolve the endpoints that should receive an event, honouring per-product
 * scoping. Reads candidates (active + subscribed to the event), then — only
 * when the event carries product context — resolves which 'selected' endpoints
 * are linked to any of the products before delegating to selectEligibleEndpoints.
 */
export async function fetchEligibleEndpoints(
  client: SupabaseClientLike,
  event: string,
  productIds?: string | string[],
): Promise<EligibleEndpoint[]> {
  const { data: candidates, error } = await client
    .from('webhook_endpoints')
    .select('id, url, secret, product_filter_mode')
    .eq('is_active', true)
    .contains('events', [event]);

  if (error) throw error;
  if (!candidates || candidates.length === 0) return [];

  const ids = normalizeProductIds(productIds);
  const hasProductContext = ids.length > 0;

  let linkedEndpointIds = new Set<string>();
  if (hasProductContext) {
    const selectedIds = candidates
      .filter((c: SelectableEndpoint) => c.product_filter_mode === 'selected')
      .map((c: SelectableEndpoint) => c.id);
    if (selectedIds.length > 0) {
      const { data: links, error: linksError } = await client
        .from('webhook_endpoint_products')
        .select('webhook_endpoint_id')
        .in('webhook_endpoint_id', selectedIds)
        .in('product_id', ids);
      if (linksError) throw linksError;
      linkedEndpointIds = new Set((links ?? []).map((l: { webhook_endpoint_id: string }) => l.webhook_endpoint_id));
    }
  }

  const eligibleIds = new Set(selectEligibleEndpoints(candidates, linkedEndpointIds, hasProductContext));
  return candidates
    .filter((c: EligibleEndpoint) => eligibleIds.has(c.id))
    .map((c: EligibleEndpoint) => ({ id: c.id, url: c.url, secret: c.secret }));
}
