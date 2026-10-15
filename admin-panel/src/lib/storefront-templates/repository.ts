/** Storefront snapshot reads using caller-authorized clients. @see supabase/tests/storefront-config.sql */
import 'server-only';
import { z } from 'zod';
import { validateConfig } from '@/lib/storefront-templates/registry';
import { revisionSchema } from '@/lib/storefront-templates/schemas';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorefrontConfig } from '@/lib/storefront-templates/schemas';
import type { Database } from '@/types/database';

type ReadResult<T> = { success: true; data: T } | { success: false; error: string };
type ConfigRow = Database['public']['Tables']['storefront_config']['Row'];
type HistoryRow = Database['public']['Tables']['storefront_config_history']['Row'];
export interface StorefrontSnapshot extends Omit<ConfigRow, 'id' | 'draft' | 'published'> {
  draft: StorefrontConfig | null;
  published: StorefrontConfig;
}
export interface StorefrontHistorySnapshot extends Omit<HistoryRow, 'draft' | 'published'> {
  draft: StorefrontConfig | null;
  published: StorefrontConfig;
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
  return validateConfig(row.published).valid && (row.draft === null || validateConfig(row.draft).valid);
}

/** Trusted core callers resolve entitlements before using this public projection. */
export async function readPublishedConfig(client: SupabaseClient<Database>): Promise<ReadResult<StorefrontConfig>> {
  try {
    const { data, error } = await client.from('storefront_config').select('published').eq('id', true).single();
    if (error || !data) return { success: false, error: 'Unable to read published storefront config' };
    if (!validateConfig(data.published).valid) return { success: false, error: 'Invalid stored storefront config' };
    return { success: true, data: data.published as StorefrontConfig };
  } catch {
    return { success: false, error: 'Unable to read published storefront config' };
  }
}

export async function readStorefrontConfig(client: SupabaseClient<Database>): Promise<ReadResult<StorefrontSnapshot>> {
  try {
    const { data, error } = await client.from('storefront_config').select('revision,draft,published,updated_at,updated_by').eq('id', true).single();
    if (error || !data) return { success: false, error: 'Unable to read storefront config' };
    const revision = storedRevision(data.revision);
    if (revision === null || !validPair(data)) return { success: false, error: 'Invalid stored storefront config' };
    return { success: true, data: { ...data, revision, draft: data.draft as StorefrontConfig | null, published: data.published as StorefrontConfig } };
  } catch {
    return { success: false, error: 'Unable to read storefront config' };
  }
}

export async function readStorefrontHistory(client: SupabaseClient<Database>, options: { beforeRevision?: number; limit?: number } = {}): Promise<ReadResult<StorefrontHistorySnapshot[]>> {
  const page = historyPageSchema.safeParse(options);
  if (!page.success) return { success: false, error: 'Invalid history page' };
  try {
    let query = client.from('storefront_config_history').select('revision,operation,draft,published,actor_id,created_at,restored_from').order('revision', { ascending: false });
    if (page.data.beforeRevision !== undefined) query = query.lt('revision', page.data.beforeRevision);
    const { data, error } = await query.limit(page.data.limit);
    if (error || !data) return { success: false, error: 'Unable to read storefront history' };
    const snapshots: StorefrontHistorySnapshot[] = [];
    for (const row of data) {
      const revision = storedRevision(row.revision);
      const restoredFrom = row.restored_from === null ? null : storedRevision(row.restored_from);
      if (revision === null || (row.restored_from !== null && restoredFrom === null) || !validPair(row)) return { success: false, error: 'Invalid stored storefront history' };
      snapshots.push({ ...row, revision, restored_from: restoredFrom, draft: row.draft as StorefrontConfig | null, published: row.published as StorefrontConfig });
    }
    return { success: true, data: snapshots };
  } catch {
    return { success: false, error: 'Unable to read storefront history' };
  }
}
