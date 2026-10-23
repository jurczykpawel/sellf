/** Public availability route contract. */
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { GET, OPTIONS } from '@/app/api/public/products/[slug]/availability/route';
const state = vi.hoisted(() => ({ allowed: true, origins: ['https://shop.example.com'], product: { id: 'p', currency: 'PLN', seller_id: null, event_mode: true, is_active: true, is_listed: true }, sessions: [] as unknown[], rpcError: null as unknown }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: vi.fn(async () => state.allowed) }));
vi.mock('@/lib/embed/checkout-embed', () => ({ loadAllowedOriginsForProduct: async () => state.origins, isAllowedEmbedOrigin: (o: string, a: string[]) => a.includes(o) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.product, error: null }) }) }) }), rpc: async () => ({ data: state.sessions, error: state.rpcError }) }) }));
const context = { params: Promise.resolve({ slug: 'workshop' }) };
const req = () => new NextRequest('http://localhost/api/public/products/workshop/availability', { headers: { origin: 'https://shop.example.com' } });
beforeEach(() => { state.allowed = true; state.origins = ['https://shop.example.com']; state.product.is_active = true; state.product.event_mode = true; state.rpcError = null; state.sessions = []; });
it('returns the public contract, no-store and allowlisted CORS', async () => {
  const res = await GET(req(), context);
  expect(await res.json()).toEqual({ productId: 'p', currency: 'PLN', sessions: [] });
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://shop.example.com');
  expect(res.headers.get('Vary')).toBe('Origin');
});
it('does not reflect an origin with an empty allowlist', async () => { state.origins = []; expect((await GET(req(), context)).headers.get('Access-Control-Allow-Origin')).toBeNull(); });
it('supports a no-store GET preflight', async () => { const res = await OPTIONS(req(), context); expect(res.status).toBe(204); expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET'); expect(res.headers.get('Cache-Control')).toBe('no-store'); });
it.each(['is_active', 'event_mode'] as const)('returns 404 for false %s', async key => { state.product[key] = false; expect((await GET(req(), context)).status).toBe(404); });
it('limits requests and retains no-store on errors', async () => { state.allowed = false; const res = await GET(req(), context); expect(res.status).toBe(429); expect(res.headers.get('Cache-Control')).toBe('no-store'); });
it('returns a controlled error for an unavailable read', async () => { state.rpcError = { message: 'internal' }; const res = await GET(req(), context); expect(res.status).toBe(503); expect(await res.text()).not.toContain('internal'); });

it('projects the session response shape without private source fields', async () => {
  state.sessions = [{ id: 'term', starts_at: '2099-06-01T12:00:00Z', ends_at: null, timezone: 'Europe/Warsaw', title: 'Workshop', venue: null, extra_days: null, remaining: 5, sold_out: false, cheaper_sold_out: true, next_tier_price: 67, current_tier: { id: 'tier', label: 'Early', price: 47, seats_left: 5, ends_at: null }, online_url: 'PRIVATE', customer_email: 'PRIVATE' }];
  const res = await GET(req(), context); const body = await res.json();
  expect(body.sessions[0]).toEqual({ id: 'term', startsAt: '2099-06-01T12:00:00Z', endsAt: null, timezone: 'Europe/Warsaw', title: 'Workshop', venue: null, extraDays: null, remaining: 5, soldOut: false, cheaperSoldOut: true, nextTierPrice: 67, currentTier: { id: 'tier', label: 'Early', price: 47, seatsLeft: 5, endsAt: null } });
  expect(JSON.stringify(body)).not.toContain('PRIVATE');
  expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
});
