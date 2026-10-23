/** Public event presentation in a fixed session timezone. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatEventDate, projectEventSessions, selectEventSession } from '@/lib/events/presentation';
import EventSessions from '@/components/checkout/EventSessions';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';
vi.mock('next-intl', () => ({ useLocale: () => 'pl', useTranslations: () => (key: string, values: Record<string, string> = {}) => Object.entries(values).reduce((s, [k,v]) => s.replace(`{${k}}`, v), pl.events[key as keyof typeof pl.events]) }));
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
