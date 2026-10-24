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
/** Formats an event interval with one timezone and retains dates across days. */
export function formatEventRange(start: string, end: string | null, timezone: string, locale: string): string {
  if (!end) return formatEventDate(start, timezone, locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: timezone });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: timezone });
  const a = new Date(start), b = new Date(end);
  return `${date.format(a)}, ${time.format(a)}–${date.format(a) === date.format(b) ? '' : `${date.format(b)}, `}${time.format(b)} (${timezone})`;
}
/** Event-zone wall time for a datetime-local input; independent of the host zone. */
export function eventLocalDate(value: string, timezone: string): string {
  if (!value) return '';
  try {
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
    const part = (type: string) => parts.find(p => p.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
  } catch { return ''; }
}
/** Resolve a wall time using the offset applicable on that event date. */
export function eventUTCDate(value: string, timezone: string): string {
  if (!value) return '';
  const target = Date.parse(`${value}Z`);
  if (!Number.isFinite(target)) return '';
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const local = eventLocalDate(new Date(instant).toISOString(), timezone);
    if (!local) return '';
    if (local === value) return new Date(instant).toISOString();
    instant += target - Date.parse(`${local}Z`);
  }
  return '';
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
interface ParticipantCsvOptions { locale: string; t: (key: string) => string; session: { starts_at: string; timezone: string } }
export function participantFilename(slug: string, session: ParticipantCsvOptions['session'], t: ParticipantCsvOptions['t']): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: session.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(session.starts_at));
  const date = ['year', 'month', 'day'].map(k => parts.find(p => p.type === k)!.value).join('-');
  return `${t('csvFilename')}-${slug.replace(/[^a-zA-Z0-9_-]/g, '-')}-${date}.csv`;
}
export function participantCsv(orders: EventOrder[], options?: ParticipantCsvOptions): string {
  if (options) {
    const { locale, t, session } = options;
    const rows = orders.flatMap(o => participantRows([o]).map(row => [row[0], t(`reservationStatus.${row[1]}`), ...row.slice(2), formatEventDate(session.starts_at, session.timezone, locale), readOrderDetails(o.order_details).phone?.value ?? '']));
    return '\uFEFF' + buildCsv(['order', 'status', 'firstName', 'lastName', 'participantEmail', 'session', 'csvPhone'].map(t), rows);
  }
  return buildCsv(['Order', 'Status', 'First name', 'Last name', 'Email'], participantRows(orders));
}
