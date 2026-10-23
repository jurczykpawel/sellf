/** Public event projection and timezone presentation. @see components/checkout/EventSessions.tsx */
import { z } from 'zod';

const rawSession = z.object({
  id: z.string(), starts_at: z.string(), ends_at: z.string().nullable(), timezone: z.string(),
  title: z.string().nullable(), venue: z.string().nullable(), extra_days: z.string().nullable(),
  remaining: z.number().nullable(), sold_out: z.boolean(), cheaper_sold_out: z.boolean(), next_tier_price: z.number().nullable(),
  current_tier: z.object({ id: z.string(), label: z.string().nullable(), price: z.number(), seats_left: z.number().nullable(), ends_at: z.string().nullable() }).nullable(),
});
export interface EventSession {
  id: string; startsAt: string; endsAt: string | null; timezone: string; title: string | null;
  venue: string | null; extraDays: string | null; remaining: number | null; soldOut: boolean;
  currentTier: { id: string; label: string | null; price: number; seatsLeft: number | null; endsAt: string | null } | null;
  nextTierPrice: number | null; cheaperSoldOut: boolean;
}
export function projectEventSessions(data: unknown, at = Date.now()): EventSession[] {
  return z.array(rawSession).parse(data).filter(s => Date.parse(s.starts_at) > at).map(s => ({
    id: s.id, startsAt: s.starts_at, endsAt: s.ends_at, timezone: s.timezone, title: s.title, venue: s.venue,
    extraDays: s.extra_days, remaining: s.remaining, soldOut: s.sold_out, nextTierPrice: s.next_tier_price, cheaperSoldOut: s.cheaper_sold_out,
    currentTier: s.current_tier && { id: s.current_tier.id, label: s.current_tier.label, price: s.current_tier.price, seatsLeft: s.current_tier.seats_left, endsAt: s.current_tier.ends_at },
  }));
}
export function formatEventDate(date: string, timezone: string, locale: string): string {
  return `${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(date))} (${timezone})`;
}
export function selectEventSession(sessions: EventSession[], requested: string | null): string | null {
  const available = sessions.filter(s => s.currentTier && !s.soldOut);
  return available.find(s => s.id === requested)?.id ?? (sessions.length === 1 ? available[0]?.id ?? null : null);
}
