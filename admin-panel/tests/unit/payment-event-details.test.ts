import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ allowed: true, reservation: null as unknown, from: vi.fn() }));
vi.mock('@/lib/actions/admin-auth', () => ({ withAdminClient: async (fn: (ctx: unknown) => unknown) => m.allowed ? fn({ dataClient: { from: m.from } }) : { success: false } }));
import { getPaymentEventDetails } from '@/lib/actions/payment-details';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => { m.allowed = true; m.reservation = null; m.from.mockReset().mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.reservation, error: null }) }) }) })); });
it('returns no event for an ordinary purchase', async () => { expect(await getPaymentEventDetails(id)).toEqual({ success: true, data: null }); });
it('returns the reserved session and price tier, including released reservations', async () => {
 m.reservation = { quantity: 2, status: 'released', session: { title: 'Workshop', starts_at: '2026-11-19T16:00:00Z', ends_at: '2026-11-19T18:00:00Z', timezone: 'Europe/Warsaw', venue: 'Studio', online_url: 'https://example.com/join' }, tier: { label: 'Early', price: 47, sort: 0 } };
 expect((await getPaymentEventDetails(id)).data).toEqual(m.reservation);
 expect(m.from).toHaveBeenCalledWith('seat_reservations');
});
it('requires admin and a valid identifier', async () => { m.allowed = false; expect((await getPaymentEventDetails(id)).success).toBe(false); expect((await getPaymentEventDetails('bad')).success).toBe(false); expect(m.from).not.toHaveBeenCalled(); });
