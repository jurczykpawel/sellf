/** Public event presentation in a fixed session timezone. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventMailData, participantCsv, formatEventDate, projectEventSessions, selectEventSession } from '@/lib/events/presentation';
import EventSessions from '@/components/checkout/EventSessions';
import { buildPurchaseWebhookPayload } from '@/lib/services/webhook-payload';
import type { BuildWebhookPayloadParams } from '@/lib/services/webhook-payload';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
vi.mock('next-intl', async () => {
  const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl');
  return { useLocale: () => 'pl', useTranslations: () => createTranslator({ locale: 'pl', messages: pl, namespace: 'events' }) };
});
const raw = { id: 'term', starts_at: '2099-06-01T12:00:00Z', ends_at: null, timezone: 'America/New_York', title: 'Workshop', venue: 'Sala 1', extra_days: 'Drugi dzień', remaining: 40, sold_out: false, current_tier: { id: 'tier', label: 'Early', price: 47, seats_left: 30, ends_at: '2099-05-01T12:00:00Z' }, next_tier_price: 67, cheaper_sold_out: true, online_url: 'https://example.com/private' };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2099-04-01T00:00:00Z')); vi.stubEnv('TZ', 'Asia/Tokyo'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('event presentation', () => {
  it('projects only public camel-case fields and future sessions', () => {
    const sessions = projectEventSessions([raw, { ...raw, starts_at: '2000-01-01T00:00:00Z' }], Date.parse('2099-04-01T00:00:00Z'));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ startsAt: raw.starts_at, currentTier: { seatsLeft: 30, price: 47 }, nextTierPrice: 67 });
    expect(JSON.stringify(sessions)).not.toContain('online_url');
  });
  it('formats the session timezone independently of the machine', () => {
    expect(formatEventDate(raw.starts_at, raw.timezone, 'en')).toContain('8:00');
    expect(formatEventDate(raw.starts_at, raw.timezone, 'en')).toContain('America/New_York');
  });
  it('retains the long access-page date style through the shared formatter', () => {
    expect(formatEventDate('2099-06-01T12:00:00Z', 'Europe/Warsaw', 'en-GB', 'long')).toBe('1 June 2099 at 14:00 (Europe/Warsaw)');
  });
  it('selects a sole session or an available URL selection only', () => {
    const sessions = projectEventSessions([raw], Date.parse('2099-04-01'));
    expect(selectEventSession(sessions, null)).toBe('term');
    expect(selectEventSession([...sessions, { ...sessions[0], id: 'other' }], 'other')).toBe('other');
    expect(selectEventSession([{ ...sessions[0], currentTier: null, soldOut: true }], 'term')).toBeNull();
  });
  it('shows tier messages, venue, extra days, labelled radio and both translations', () => {
    const sessions = projectEventSessions([raw], Date.parse('2099-04-01'));
    const html = renderToStaticMarkup(createElement(EventSessions, { sessions, currency: 'PLN', selected: 'term', onSelect: () => {} }));
    for (const value of ['Zostało 30 miejsc w tej cenie', 'Ta cena do', 'Potem', 'Tańsze miejsca wyprzedane', 'Sala 1', 'Drugi dzień', 'type="radio"']) expect(html).toContain(value);
    expect(Object.keys(en.events)).toEqual(Object.keys(pl.events));
  });
  it('omits optional tier messages for unlimited regular seats and closed sales', () => {
    const sessions = projectEventSessions([{ ...raw, ends_at: '2099-06-01T16:00:00Z', current_tier: { ...raw.current_tier, seats_left: null, ends_at: null }, next_tier_price: null, cheaper_sold_out: false }]);
    const html = renderToStaticMarkup(createElement(EventSessions, { sessions, currency: 'PLN', selected: 'term', onSelect: () => {} }));
    for (const text of ['Zostało', 'Ta cena do', 'Potem', 'Tańsze miejsca']) expect(html).not.toContain(text);
    expect(html).toContain('12:00');
    const closed = renderToStaticMarkup(createElement(EventSessions, { sessions: [{ ...sessions[0], currentTier: null }], currency: 'PLN', selected: null, onSelect: () => {} }));
    expect(closed).toContain('Sprzedaż zamknięta'); expect(closed).not.toContain('type="radio"');
  });
  it('shows sold out without a purchase control and handles no sessions', () => {
    const sessions = projectEventSessions([{ ...raw, current_tier: null, sold_out: true }], Date.parse('2099-04-01'));
    const html = renderToStaticMarkup(createElement(EventSessions, { sessions, currency: 'PLN', selected: null, onSelect: () => {} }));
    expect(html).toContain('Brak wolnych miejsc'); expect(html).not.toContain('type="radio"');
    expect(renderToStaticMarkup(createElement(EventSessions, { sessions: [], currency: 'PLN', selected: null, onSelect: () => {} }))).toContain('Brak dostępnych terminów');
  });
});

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
    const params = { supabaseClient: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'p', name: 'Event', slug: 'event', price: 47, currency: 'PLN', icon: null } }) }) }) }) }, customerEmail: 'b@example.com', userId: null, productId: 'p', bumpProductIds: [], metadata: { locale: 'en' }, amount: 4700, currency: 'PLN', paymentIntentId: null, couponId: null, isGuest: true,
      eventLines: [{ product_id: 'p', session_id: 's', session_starts_at: event.starts_at, session_label: 'Autumn', tier_id: 't', tier_label: 'Early' }] } as unknown as BuildWebhookPayloadParams;
    const payload = await buildPurchaseWebhookPayload(params);
    expect(payload.product).toMatchObject({ sessionId: 's', sessionLabel: 'Autumn', sessionStartsAt: event.starts_at, tierId: 't', tierLabel: 'Early' });
    expect(JSON.stringify(payload)).not.toContain('online_url');
  });
});

it('formats Polish mail dates in Polish using the event timezone', () => {
  const event = { id: 'event', starts_at: '2026-12-10T17:00:00Z', timezone: 'Europe/Warsaw', online_url: null, title: null };
  expect(eventMailData([event], 'pl').event_date).toContain('10 gru 2026');
  expect(eventMailData([event], 'pl').event_date).toContain('18:00');
});

describe('tier seats never exceed the session pool (W146 U11)', () => {
  it('caps the advertised seats to what the pool still holds', async () => {
    const { projectEventSessions } = await import('@/lib/events/presentation');
    const raw = { id: 's', starts_at: '2036-01-01T10:00:00Z', ends_at: null, timezone: 'Europe/Warsaw', title: null, venue: null, extra_days: null,
      remaining: 20, sold_out: false, cheaper_sold_out: false, next_tier_price: null, current_tier: { id: 't', label: null, price: 10, seats_left: 25, ends_at: null } };
    expect(projectEventSessions([raw], 0)[0].currentTier?.seatsLeft).toBe(20);
    expect(projectEventSessions([{ ...raw, current_tier: { ...raw.current_tier, seats_left: 5 } }], 0)[0].currentTier?.seatsLeft).toBe(5);
    expect(projectEventSessions([{ ...raw, remaining: null }], 0)[0].currentTier?.seatsLeft).toBe(25);
  });
});
