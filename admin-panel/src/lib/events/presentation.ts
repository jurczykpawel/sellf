/** Event mail and participant exports. @see @/lib/events/actions */
import { readOrderDetails } from '@/lib/checkout-modules/order-details';
import { buildCsv } from '@/lib/csv/sanitize';
export interface PurchasedEvent { id: string; starts_at: string; timezone: string; online_url: string | null; title: string | null }
export interface EventOrder { transaction_id: string; status: string; customer_email?: string | null; order_details?: unknown }
export function eventMailData(events: PurchasedEvent[]): Record<string, string> {
  const e = events[0]; if (!e) return {};
  return { event_date: `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: e.timezone }).format(new Date(e.starts_at))} (${e.timezone})`,
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
