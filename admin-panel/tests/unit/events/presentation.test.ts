import { describe, expect, it } from 'vitest';
import { eventMailData, participantCsv } from '@/lib/events/presentation';
import { buildPurchaseWebhookPayload } from '@/lib/services/webhook-payload';
import type { BuildWebhookPayloadParams } from '@/lib/services/webhook-payload';
const event = { id: 'session', starts_at: '2036-01-10T10:00:00Z', timezone: 'Europe/Warsaw', online_url: 'https://meet.example.com/private', title: 'Edition' };
describe('event presentation', () => {
  it('includes the time zone and https meeting link in mail data', () => {
    expect(eventMailData([event])).toEqual({ event_date: expect.stringContaining('Europe/Warsaw'), event_online_url: event.online_url });
    expect(eventMailData([])).toEqual({});
    expect(eventMailData([{ ...event, online_url: 'javascript:alert(1)' }])).not.toHaveProperty('event_online_url');
  });
  it('exports named participants and uses a buyer fallback, with safe cells', () => {
    const csv = participantCsv([{ transaction_id: 'tx', status: 'confirmed', customer_email: 'buyer@example.com', order_details: { participants: { v: 1, people: [{ first_name: '=A1', last_name: 'Nowak', email: 'p@example.com' }] } } }]);
    expect(csv).toContain("\"'=A1\""); expect(csv).toContain('p@example.com'); expect(csv).not.toContain('buyer@example.com');
    expect(participantCsv([{ transaction_id: 'tx', status: 'confirmed', customer_email: 'buyer@example.com' }])).toContain('buyer@example.com');
  });
  it('adds event snapshots only to the matching purchased line', async () => {
    const params = { supabaseClient: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'p', name: 'Event', slug: 'event', price: 47, currency: 'PLN', icon: null } }) }) }) }) }, customerEmail: 'b@example.com', userId: null, productId: 'p', bumpProductIds: [], metadata: {}, amount: 4700, currency: 'PLN', paymentIntentId: null, couponId: null, isGuest: true,
      eventLines: [{ product_id: 'p', session_id: 's', session_starts_at: event.starts_at, session_label: 'Autumn', tier_id: 't', tier_label: 'Early' }] } as unknown as BuildWebhookPayloadParams;
    const payload = await buildPurchaseWebhookPayload(params);
    expect(payload.product).toMatchObject({ sessionId: 's', sessionLabel: 'Autumn', sessionStartsAt: event.starts_at, tierId: 't', tierLabel: 'Early' });
    expect(JSON.stringify(payload)).not.toContain('online_url');
  });
});
