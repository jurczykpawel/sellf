/** Product offer snapshot reads using caller-authorized clients. @see supabase/tests/product-offers.sql */
import 'server-only';
import { z } from 'zod';
import { offerConfigSchema, validatePhase2 } from '@/lib/storefront-templates/phase2-contracts';
import { revisionSchema } from '@/lib/storefront-templates/schemas';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type OfferPageConfig = z.infer<typeof offerConfigSchema>;
type ReadResult<T> = { success: true; data: T } | { success: false; error: string };
type ConfigRow = Database['public']['Tables']['product_offer_config']['Row'];
type HistoryRow = Database['public']['Tables']['product_offer_history']['Row'];
export interface OfferSnapshot extends Omit<ConfigRow, 'draft' | 'published'> {
  draft: OfferPageConfig | null;
  published: OfferPageConfig | null;
}
export interface OfferHistorySnapshot extends Omit<HistoryRow, 'draft' | 'published'> {
  draft: OfferPageConfig | null;
  published: OfferPageConfig | null;
}
const historyPageSchema = z.strictObject({ beforeRevision: revisionSchema.optional(), limit: z.number().int().min(1).max(50).default(20) });

/** Validate bigint text before conversion so adjacent large revisions stay distinct. */
function storedRevision(value: unknown): number | null {
  if (typeof value === 'string') {
    if (!/^(0|[1-9]\d{0,15})$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    value = Number(value);
  }
  const parsed = revisionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function validPair(row: { draft: unknown; published: unknown }): boolean {
  return (row.published === null || validatePhase2(row.published, 'offer-config').valid) && (row.draft === null || validatePhase2(row.draft, 'offer-config').valid);
}

/** Caller checks canonical product visibility and current entitlements before public use. */
export async function readPublishedOffer(client: SupabaseClient<Database>, productId: string): Promise<ReadResult<OfferPageConfig | null>> {
  if (!z.uuid().safeParse(productId).success) return { success: false, error: 'Invalid product identifier' };
  try {
    const { data, error } = await client.from('product_offer_config').select('published').eq('product_id', productId).maybeSingle();
    if (error) return { success: false, error: 'Unable to read published offer' };
    if (!data || data.published === null) return { success: true, data: null };
    if (!validatePhase2(data.published, 'offer-config').valid) return { success: false, error: 'Invalid stored offer config' };
    const published = data.published as OfferPageConfig;
    return { success: true, data: published.enabled ? published : null };
  } catch { return { success: false, error: 'Unable to read published offer' }; }
}

export async function readOfferConfig(client: SupabaseClient<Database>, productId: string): Promise<ReadResult<OfferSnapshot | null>> {
  if (!z.uuid().safeParse(productId).success) return { success: false, error: 'Invalid product identifier' };
  try {
    const { data, error } = await client.from('product_offer_config').select('product_id,revision,draft,published,updated_at,updated_by').eq('product_id', productId).maybeSingle();
    if (error) return { success: false, error: 'Unable to read offer config' };
    if (!data) return { success: true, data: null };
    const revision = storedRevision(data.revision);
    if (data.product_id !== productId || revision === null || !validPair(data)) return { success: false, error: 'Invalid stored offer config' };
    return { success: true, data: { product_id: data.product_id, updated_at: data.updated_at, updated_by: data.updated_by, revision, draft: data.draft as OfferPageConfig | null, published: data.published as OfferPageConfig | null } };
  } catch {
    return { success: false, error: 'Unable to read offer config' };
  }
}

export async function readOfferHistory(client: SupabaseClient<Database>, productId: string, options: { beforeRevision?: number; limit?: number } = {}): Promise<ReadResult<OfferHistorySnapshot[]>> {
  if (!z.uuid().safeParse(productId).success) return { success: false, error: 'Invalid product identifier' };
  const page = historyPageSchema.safeParse(options);
  if (!page.success) return { success: false, error: 'Invalid history page' };
  try {
    let query = client.from('product_offer_history').select('product_id,revision,operation,draft,published,actor_id,created_at,restored_from').eq('product_id', productId).order('revision', { ascending: false });
    if (page.data.beforeRevision !== undefined) query = query.lt('revision', page.data.beforeRevision);
    const { data, error } = await query.limit(page.data.limit);
    if (error || !data) return { success: false, error: 'Unable to read offer history' };
    const snapshots: OfferHistorySnapshot[] = [];
    for (const row of data) {
      const revision = storedRevision(row.revision);
      const restoredFrom = row.restored_from === null ? null : storedRevision(row.restored_from);
      if (row.product_id !== productId || revision === null || (row.restored_from !== null && restoredFrom === null) || !validPair(row)) return { success: false, error: 'Invalid stored offer history' };
      snapshots.push({ product_id: row.product_id, operation: row.operation, actor_id: row.actor_id, created_at: row.created_at, revision, restored_from: restoredFrom, draft: row.draft as OfferPageConfig | null, published: row.published as OfferPageConfig | null });
    }
    return { success: true, data: snapshots };
  } catch {
    return { success: false, error: 'Unable to read offer history' };
  }
}
