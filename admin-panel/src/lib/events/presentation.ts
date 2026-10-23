/** Shared event projection, timezone presentation, mail and participant exports. @see components/checkout/EventSessions.tsx */
import { z } from 'zod';
import { readOrderDetails } from '@/lib/checkout-modules/order-details';
import { buildCsv } from '@/lib/csv/sanitize';

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
export function formatEventDate(date: string, timezone: string, locale: string, dateStyle: Intl.DateTimeFormatOptions['dateStyle'] = 'medium'): string {
  return `${new Intl.DateTimeFormat(locale, { dateStyle, timeStyle: 'short', timeZone: timezone }).format(new Date(date))} (${timezone})`;
}
export function selectEventSession(sessions: EventSession[], requested: string | null): string | null {
  const available = sessions.filter(s => s.currentTier && !s.soldOut);
  return available.find(s => s.id === requested)?.id ?? (sessions.length === 1 ? available[0]?.id ?? null : null);
}

export interface PurchasedEvent { id: string; starts_at: string; timezone: string; online_url: string | null; title: string | null }
export interface EventOrder { transaction_id: string; status: string; customer_email?: string | null; order_details?: unknown }
export function eventMailData(events: PurchasedEvent[]): Record<string, string> {
  const e = events[0]; if (!e) return {};
  return { event_date: formatEventDate(e.starts_at, e.timezone, 'en-GB'),
    ...(e.online_url?.startsWith('https://') ? { event_online_url: e.online_url } : {}) };
}
export function participantRows(orders: EventOrder[]): string[][] {
  return orders.flatMap(o => {
    const d = readOrderDetails(o.order_details);
    return (d.participants?.people.length ? d.participants.people : [{ first_name: d.buyer?.first_name ?? '', last_name: d.buyer?.last_name ?? '', email: o.customer_email ?? '' }])
      .map(p => [o.transaction_id, o.status, p.first_name, p.last_name, p.email]);
  });
}
export function participantCsv(orders: EventOrder[]): string { return buildCsv(['Order', 'Status', 'First name', 'Last name', 'Email'], participantRows(orders)); }
