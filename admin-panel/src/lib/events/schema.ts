/** Event authoring contract. @see supabase/migrations/20261110235902_release_2026_11_0_orders_events.sql */
import { z } from 'zod';
/** Never throws: an unparsable value is simply not an HTTPS link (B8: typing "h" crashed the form). */
const isHttpsUrl = (v: string): boolean => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };
const text = z.string().trim().max(500).nullable().optional();
export const eventTierSchema = z.object({
  id: z.string().uuid().optional(), label: text, price: z.number({ message: 'tier_price' }).finite({ message: 'tier_price' }).nonnegative({ message: 'tier_price' }), seats: z.number().int({ message: 'tier_seats' }).positive({ message: 'tier_seats' }).max(2147483647, { message: 'tier_seats' }).nullable().optional(),
  sale_ends_at: z.string().datetime({ offset: true, message: 'tier_sale_ends_at' }).nullable().optional(), sort: z.number().int({ message: 'tier_sort' }).min(0, { message: 'tier_sort' }).max(10000, { message: 'tier_sort' }),
}).strict();
export const eventSessionSchema = z.object({
  id: z.string().uuid().optional(), starts_at: z.string().datetime({ offset: true, message: 'starts_at' }), ends_at: z.string().datetime({ offset: true, message: 'ends_at' }).nullable().optional(),
  timezone: z.string().max(100, { message: 'timezone' }).default('Europe/Warsaw').refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, { message: 'timezone' }),
  title: text, venue: text, extra_days: text, online_url: z.string().max(2048, { message: 'online_url' }).refine(isHttpsUrl, { message: 'online_url' }).nullable().optional(),
  capacity: z.number().int({ message: 'capacity' }).positive({ message: 'capacity' }).max(2147483647, { message: 'capacity' }).nullable().optional(), sales_open: z.boolean().default(true), sort: z.number().int({ message: 'sort' }).min(0, { message: 'sort' }).max(10000, { message: 'sort' }).default(0),
  tiers: z.array(eventTierSchema).min(1, { message: 'tiers' }).max(50, { message: 'tiers' }),
}).strict().superRefine((s, ctx) => {
  if (s.ends_at && !(Date.parse(s.ends_at) > Date.parse(s.starts_at))) ctx.addIssue({ code: 'custom', path: ['ends_at'], message: 'ends_at' });
  const sorts = new Set<number>(); const ids = new Set<string>();
  s.tiers.forEach((t, i) => {
    if (sorts.has(t.sort)) ctx.addIssue({ code: 'custom', path: ['tiers', i, 'sort'], message: 'tier_sort' }); sorts.add(t.sort);
    if (t.id) { if (ids.has(t.id)) ctx.addIssue({ code: 'custom', path: ['tiers', i, 'id'], message: 'tiers' }); ids.add(t.id); }
    // U11: a tier can never promise more seats than the session pool holds.
    if (s.capacity != null && t.seats != null && t.seats > s.capacity) ctx.addIssue({ code: 'custom', path: ['tiers', i, 'seats'], message: 'tier_seats_capacity' });
  });
});
export const eventSessionsSchema = z.array(eventSessionSchema).max(50).refine(s => {
  const ids = s.flatMap(v => v.id ? [v.id] : []); return new Set(ids).size === ids.length;
}, 'Session IDs must be unique');
/** Field-level error codes keyed "<session>.<field>" / "<session>.tiers.<n>.<field>"; codes map to `events.errors.*`. */
export function eventFieldErrors(sessions: unknown): Record<string, string> {
  const r = eventSessionsSchema.safeParse(sessions); const out: Record<string, string> = {};
  if (r.success) return out;
  for (const issue of r.error.issues) {
    const key = issue.path.join('.'); if (!key || out[key]) continue;
    out[key] = /^[a-z_]+$/.test(issue.message) ? issue.message : 'invalid';
  }
  return out;
}
export type EventSessionInput = z.infer<typeof eventSessionSchema>;
export function isEventCompatible(p: { event_mode?: boolean; product_type?: string; is_bundle?: boolean; allow_custom_price?: boolean }): boolean {
  return !p.event_mode || (p.product_type !== 'subscription' && !p.is_bundle && !p.allow_custom_price);
}
