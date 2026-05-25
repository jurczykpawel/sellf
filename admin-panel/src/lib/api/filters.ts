import type { SupabaseClient } from '@supabase/supabase-js';

export const FILTER_MAX_VALUES = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-zA-Z0-9_-]+$/;

export interface ParsedFilter {
  ids: string[];
  slugs: string[];
}

/**
 * Wraps a value in a PostgREST double-quoted string so that commas, dots,
 * parentheses and colons inside the value cannot be parsed as .or() filter
 * syntax. Inside the quoted form, only backslash and double-quote need to be
 * escaped with a backslash.
 */
export function quoteForPostgrestOr(value: string): string {
  if (typeof value !== 'string') return '""';
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function parseCsvFilter(raw: string | null | undefined): ParsedFilter {
  if (!raw) return { ids: [], slugs: [] };
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length > FILTER_MAX_VALUES) {
    throw new Error(`too many values (max ${FILTER_MAX_VALUES})`);
  }
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const part of parts) {
    if (UUID_RE.test(part)) {
      ids.add(part.toLowerCase());
    } else if (SLUG_RE.test(part)) {
      slugs.add(part);
    } else {
      throw new Error('invalid filter value');
    }
  }
  return { ids: [...ids], slugs: [...slugs] };
}

export type FilterTable = 'categories' | 'tags';

export async function resolveFilterIds(
  supabase: SupabaseClient,
  table: FilterTable,
  parsed: ParsedFilter,
): Promise<string[] | null> {
  const ids = [...parsed.ids];
  if (parsed.slugs.length > 0) {
    const { data, error } = await supabase.from(table).select('id').in('slug', parsed.slugs);
    if (error) throw error;
    const found = (data ?? []).map((r) => r.id as string);
    if (found.length !== parsed.slugs.length) return null;
    ids.push(...found);
  }
  return ids;
}

export interface MembershipFilterConfig {
  junctionTable: string;
  fkColumn: string;
}

export async function intersectProductIdsByMembership(
  supabase: SupabaseClient,
  ids: string[],
  cfg: MembershipFilterConfig,
): Promise<string[] | null> {
  if (ids.length === 0) return null;
  const { data, error } = await supabase
    .from(cfg.junctionTable)
    .select(`product_id, ${cfg.fkColumn}`)
    .in(cfg.fkColumn, ids);
  if (error) throw error;

  const counts = new Map<string, Set<string>>();
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const pid = row.product_id as string;
    const fk = row[cfg.fkColumn] as string;
    let bucket = counts.get(pid);
    if (!bucket) {
      bucket = new Set();
      counts.set(pid, bucket);
    }
    bucket.add(fk);
  }
  const required = ids.length;
  const result: string[] = [];
  for (const [pid, bucket] of counts) {
    if (bucket.size === required) result.push(pid);
  }
  return result;
}
