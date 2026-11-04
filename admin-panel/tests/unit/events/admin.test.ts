import { describe, expect, it } from 'vitest';
import { ProductCreateDTO, ProductUpdateDTO, mapApiInputToProductRow } from '@/lib/api/dto/product';
import { validateWholeAmounts } from '@/lib/validations/product';
import { eventSessionsSchema } from '@/lib/events/schema';
const tier = { label: 'Early', price: 47, seats: 30, sort: 0 };
const session = { starts_at: '2036-01-10T10:00:00Z', timezone: 'Europe/Warsaw', tiers: [tier] };
describe('event admin contract', () => {
  it('retains sessions and event_mode in the product mutation', () => {
    expect(mapApiInputToProductRow({ event_mode: true, sessions: [session] }, 'update')).toMatchObject({ event_mode: true, sessions: [{ tiers: [tier] }] });
  });
  it('distinguishes omission from complete replacement', () => {
    expect(ProductUpdateDTO.parse({})).not.toHaveProperty('sessions');
    expect(ProductUpdateDTO.parse({ sessions: [] })).toEqual({ sessions: [] });
  });
  it.each([
    { ...session, tiers: [] }, { ...session, starts_at: 'tomorrow' },
    { ...session, ends_at: '2035-01-01T00:00:00Z' }, { ...session, timezone: 'invalid' },
    { ...session, online_url: 'http://meet.example.com' },
    { ...session, tiers: [{ ...tier, price: -1 }] },
    { ...session, tiers: [{ ...tier, seats: 0 }] },
    { ...session, tiers: [tier, tier] },
  ])('rejects invalid session %#', value => expect(eventSessionsSchema.safeParse([value]).success).toBe(false));
  it('requires event-compatible products', () => {
    expect(ProductCreateDTO.safeParse({ name: 'Event', slug: 'event', price: 47, event_mode: true, is_bundle: true, sessions: [session] }).success).toBe(false);
  });
  it('accepts https meeting URLs and nullable capacity', () => {
    expect(eventSessionsSchema.parse([{ ...session, online_url: 'https://meet.example.com/x', capacity: null }])[0].capacity).toBeNull();
  });
});

it('validates event tier prices in the product currency',()=>{
  expect(validateWholeAmounts({sessions:[{tiers:[{price:47.5}]}]},'JPY')).toHaveLength(1);
  expect(validateWholeAmounts({sessions:[{tiers:[{price:47.5}]}]},'PLN')).toEqual([]);
});

describe('event field errors (W150 B8/B3/U11)', () => {
  it('does not throw while the online link is typed character by character', async () => {
    const { eventFieldErrors } = await import('@/lib/events/schema');
    for (const partial of ['h', 'ht', 'https', 'https:/', 'https://']) {
      expect(() => eventSessionsSchema.safeParse([{ ...session, online_url: partial }])).not.toThrow();
      expect(eventFieldErrors([{ ...session, online_url: partial }])['0.online_url']).toBe('online_url');
    }
    expect(eventFieldErrors([{ ...session, online_url: 'https://meet.example.com/x' }])).toEqual({});
  });
  it('points each problem at its own field', async () => {
    const { eventFieldErrors } = await import('@/lib/events/schema');
    expect(eventFieldErrors([{ ...session, starts_at: '', timezone: 'Mars/Base', ends_at: '2035-01-01T00:00:00Z' }])).toMatchObject({ '0.starts_at': 'starts_at', '0.timezone': 'timezone' });
    expect(eventFieldErrors([{ ...session, ends_at: '2035-01-01T00:00:00Z' }])).toEqual({ '0.ends_at': 'ends_at' });
    expect(eventFieldErrors([{ ...session, tiers: [tier, { ...tier }] }])).toEqual({ '0.tiers.1.sort': 'tier_sort' });
    expect(eventFieldErrors([{ ...session, tiers: [] }])).toEqual({ '0.tiers': 'tiers' });
  });
  it('rejects a tier with more seats than the session pool', async () => {
    const { eventFieldErrors } = await import('@/lib/events/schema');
    expect(eventSessionsSchema.safeParse([{ ...session, capacity: 20, tiers: [{ ...tier, seats: 25 }] }]).success).toBe(false);
    expect(eventFieldErrors([{ ...session, capacity: 20, tiers: [{ ...tier, seats: 25 }] }])).toEqual({ '0.tiers.0.seats': 'tier_seats_capacity' });
    expect(eventSessionsSchema.safeParse([{ ...session, capacity: 20, tiers: [{ ...tier, seats: 20 }] }]).success).toBe(true);
  });
});
