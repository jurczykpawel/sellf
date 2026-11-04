/**
 * Purchase attribution report: query parsing and the per-order view shared by the API.
 *
 * @see src/app/api/v1/analytics/attribution/route.ts
 * @see supabase/migrations/20261103120000_purchase_attribution.sql — get_attribution_report()
 */

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export const ATTRIBUTION_DIMENSIONS = [
  'channel', 'source', 'medium', 'campaign', 'content', 'term', 'referrer_host', 'landing_path',
  'product', 'country', 'device_class', 'affiliate', 'kind', 'day',
] as const;
export type AttributionDimension = (typeof ATTRIBUTION_DIMENSIONS)[number];
export const DEFAULT_ATTRIBUTION_GROUP_BY: AttributionDimension[] = ['channel', 'source', 'medium', 'campaign', 'content'];

const MAX_RANGE_DAYS = 3660;
const DAY_MS = 86400_000;

export interface AttributionReportQuery {
  from: Date;
  to: Date;
  touch: 'first' | 'last';
  groupBy: AttributionDimension[];
  productId: string | null;
}

const isoDate = z.string().max(40).refine(v => !Number.isNaN(Date.parse(v)), 'Invalid date');
const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(MAX_RANGE_DAYS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  touch: z.enum(['first', 'last']).default('last'),
  group_by: z.string().max(300).optional(),
  product_id: z.uuid().optional(),
});

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parses `days | from,to`, `touch`, `group_by` (CSV) and `product_id`. Default: last 30 days. */
export function parseAttributionQuery(params: URLSearchParams, now = new Date()): ParseResult<AttributionReportQuery> {
  const raw = Object.fromEntries(['days', 'from', 'to', 'touch', 'group_by', 'product_id']
    .map(k => [k, params.get(k) ?? undefined]).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' };
  const q = parsed.data;
  const to = q.to ? new Date(q.to) : now;
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - (q.days ?? 30) * DAY_MS);
  if (from >= to) return { ok: false, error: '`from` must be before `to`' };
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) return { ok: false, error: 'Date range too large' };
  const groupBy = q.group_by
    ? [...new Set(q.group_by.split(',').map(s => s.trim()).filter(Boolean))]
    : DEFAULT_ATTRIBUTION_GROUP_BY;
  if (groupBy.length > 8 || groupBy.some(d => !(ATTRIBUTION_DIMENSIONS as readonly string[]).includes(d))) {
    return { ok: false, error: `group_by accepts up to 8 of: ${ATTRIBUTION_DIMENSIONS.join(', ')}` };
  }
  return { ok: true, value: { from, to, touch: q.touch, groupBy: groupBy as AttributionDimension[], productId: q.product_id ?? null } };
}

/** Grouping of the seller panel report: channel, source, campaign and partner (owner, 3.11.2026). */
export const ATTRIBUTION_PANEL_GROUP_BY: AttributionDimension[] = ['channel', 'source', 'campaign', 'affiliate'];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Panel form (`touch`, `from`, `to` as YYYY-MM-DD, end day inclusive) → the same query the API parses. */
export function panelAttributionQuery(
  input: { touch?: string; from?: string; to?: string }, now = new Date(),
): ParseResult<AttributionReportQuery> {
  const params = new URLSearchParams({ group_by: ATTRIBUTION_PANEL_GROUP_BY.join(',') });
  if (input.touch) params.set('touch', input.touch);
  if (input.from) params.set('from', input.from);
  if (input.to) {
    if (!DATE_ONLY.test(input.to) || Number.isNaN(Date.parse(input.to))) return { ok: false, error: 'Invalid date' };
    params.set('to', new Date(Date.parse(`${input.to}T00:00:00Z`) + DAY_MS).toISOString());
  }
  return parseAttributionQuery(params, now);
}

export type AttributionReportRow = Record<string, string | number | null>;

/** Runs get_attribution_report (admin or service role); shared by the API v1 endpoint and the panel page. */
export async function runAttributionReport(
  supabase: Pick<SupabaseClient<Database>, 'rpc'>, q: AttributionReportQuery,
): Promise<{ ok: true; rows: AttributionReportRow[] } | { ok: false }> {
  const { data, error } = await supabase.rpc('get_attribution_report', {
    p_from: q.from.toISOString(),
    p_to: q.to.toISOString(),
    p_touch: q.touch,
    p_group_by: q.groupBy,
    ...(q.productId ? { p_product: q.productId } : {}),
  });
  if (error) {
    console.error('[runAttributionReport] Error:', error.message);
    return { ok: false };
  }
  return { ok: true, rows: Array.isArray(data) ? data as AttributionReportRow[] : [] };
}

type AttributionRow = Database['public']['Tables']['purchase_attribution']['Row'];

export const PURCHASE_ATTRIBUTION_COLUMNS = 'transaction_id, kind, channel, first_channel, mode, consent, '
  + 'last_source, last_medium, last_campaign, last_content, last_term, last_utm_id, last_referrer_host, last_landing_path, last_at, '
  + 'first_source, first_medium, first_campaign, first_content, first_term, first_utm_id, first_referrer_host, first_landing_path, first_at, '
  + 'sessions_count, first_seen_at, click_id_type, click_id, device_class, country, affiliate_member_id, created_at';

export interface PurchaseAttributionView {
  channel: string;
  first_channel: string | null;
  kind: string;
  mode: string;
  consent: string;
  last: Record<string, string | null>;
  first: Record<string, string | null> | null;
  sessions_count: number | null;
  first_seen_at: string | null;
  days_to_purchase: number | null;
  click: { type: string; id: string | null } | null;
  device_class: string;
  country: string | null;
  affiliate_member_id: string | null;
  recorded_at: string;
}

type ViewSource = Pick<AttributionRow, 'kind' | 'channel' | 'first_channel' | 'mode' | 'consent' | 'last_source' | 'last_medium'
  | 'last_campaign' | 'last_content' | 'last_term' | 'last_utm_id' | 'last_referrer_host' | 'last_landing_path' | 'last_at'
  | 'first_source' | 'first_medium' | 'first_campaign' | 'first_content' | 'first_term' | 'first_utm_id' | 'first_referrer_host'
  | 'first_landing_path' | 'first_at' | 'sessions_count' | 'first_seen_at' | 'click_id_type' | 'click_id' | 'device_class'
  | 'country' | 'affiliate_member_id' | 'created_at'>;

/** Per-order shape returned by `?embed=attribution` and shown in the payment details. */
export function toPurchaseAttributionView(row: ViewSource): PurchaseAttributionView {
  const touch = (p: 'last' | 'first') => ({
    source: row[`${p}_source`], medium: row[`${p}_medium`], campaign: row[`${p}_campaign`], content: row[`${p}_content`],
    term: row[`${p}_term`], utm_id: row[`${p}_utm_id`], referrer_host: row[`${p}_referrer_host`],
    landing_path: row[`${p}_landing_path`], at: row[`${p}_at`],
  });
  const first = touch('first');
  const days = row.first_seen_at
    ? Math.max(0, Math.round(((Date.parse(row.created_at) - Date.parse(row.first_seen_at)) / DAY_MS) * 10) / 10)
    : null;
  return {
    channel: row.channel,
    first_channel: row.first_channel,
    kind: row.kind,
    mode: row.mode,
    consent: row.consent,
    last: touch('last'),
    first: Object.values(first).some(v => v !== null) ? first : null,
    sessions_count: row.sessions_count,
    first_seen_at: row.first_seen_at,
    days_to_purchase: days,
    click: row.click_id_type ? { type: row.click_id_type, id: row.click_id } : null,
    device_class: row.device_class,
    country: row.country,
    affiliate_member_id: row.affiliate_member_id,
    recorded_at: row.created_at,
  };
}

/** Source attached to the purchase.completed webhook. Never contains the ad click id itself. */
export interface WebhookAttribution {
  channel: string;
  firstChannel: string | null;
  kind: string;
  mode: string;
  last: Record<string, string | null>;
  first: Record<string, string | null> | null;
  sessionsCount: number | null;
  daysToPurchase: number | null;
  clickIdType: string | null;
  deviceClass: string;
  country: string | null;
  affiliateMemberId: string | null;
}

export function toWebhookAttribution(view: PurchaseAttributionView): WebhookAttribution {
  return {
    channel: view.channel, firstChannel: view.first_channel, kind: view.kind, mode: view.mode,
    last: view.last, first: view.first, sessionsCount: view.sessions_count, daysToPurchase: view.days_to_purchase,
    clickIdType: view.click?.type ?? null, deviceClass: view.device_class, country: view.country,
    affiliateMemberId: view.affiliate_member_id,
  };
}
