/** Event authoring contract. @see supabase/migrations/20261023080000_event_reservations.sql */
import { z } from 'zod';
const date = z.string().datetime({ offset: true });
const text = z.string().trim().max(500).nullable().optional();
const limit = z.number().int().positive().max(2147483647).nullable().optional();
export const eventTierSchema = z.object({
  id: z.string().uuid().optional(), label: text, price: z.number().finite().nonnegative(), seats: limit,
  sale_ends_at: date.nullable().optional(), sort: z.number().int().min(0).max(10000),
}).strict();
export const eventSessionSchema = z.object({
  id: z.string().uuid().optional(), starts_at: date, ends_at: date.nullable().optional(),
  timezone: z.string().max(100).default('Europe/Warsaw').refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }),
  title: text, venue: text, extra_days: text, online_url: z.string().url().max(2048).refine(v => new URL(v).protocol === 'https:').nullable().optional(),
  capacity: limit, sales_open: z.boolean().default(true), sort: z.number().int().min(0).max(10000).default(0),
  tiers: z.array(eventTierSchema).min(1).max(50),
}).strict().refine(s => !s.ends_at || Date.parse(s.ends_at) > Date.parse(s.starts_at), 'End must follow start')
  .refine(s => new Set(s.tiers.map(t => t.sort)).size === s.tiers.length, 'Tier order must be unique')
  .refine(s => { const ids = s.tiers.flatMap(t => t.id ? [t.id] : []); return new Set(ids).size === ids.length; }, 'Tier IDs must be unique');
export const eventSessionsSchema = z.array(eventSessionSchema).max(50).refine(s => {
  const ids = s.flatMap(v => v.id ? [v.id] : []); return new Set(ids).size === ids.length;
}, 'Session IDs must be unique');
export type EventSessionInput = z.infer<typeof eventSessionSchema>;
export function isEventCompatible(p: { event_mode?: boolean; product_type?: string; is_bundle?: boolean; allow_custom_price?: boolean }): boolean {
  return !p.event_mode || (p.product_type !== 'subscription' && !p.is_bundle && !p.allow_custom_price);
}
