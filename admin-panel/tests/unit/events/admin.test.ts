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
