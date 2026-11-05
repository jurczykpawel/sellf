import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ trigger: vi.fn(), magic: vi.fn() }));
vi.mock('@/lib/services/webhook-service', () => ({ WebhookService: { trigger: h.trigger } }));
vi.mock('@/lib/auth/magic-link/request', () => ({ sendTrustedMagicLink: h.magic }));
import { sendParticipantsNotice } from '@/lib/orders/participants-service';
const tx = { id: '10000000-0000-4000-8000-000000000001', customer_email: 'buyer@example.com', product_id: 'p', status: 'completed', amount: 20000, currency: 'PLN', order_number: 42, metadata: { locale: 'pl' }, order_details: { quantity: { value: 2 } } };
function client() {
 const chain = (data: unknown) => { const q: Record<string, unknown> = {}; for (const key of ['select', 'eq', 'update']) q[key] = () => q; q.single = async () => ({ data }); q.then = (resolve: (v: unknown) => unknown) => resolve({ error: null }); return q; };
 return { from: (table: string) => chain(table === 'products' ? { name: 'Workshop', slug: 'workshop' } : tx) };
}
beforeEach(() => { vi.clearAllMocks(); process.env.CHECKOUT_BINDING_SECRET = 'x'.repeat(40); process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'; h.magic.mockResolvedValue({ ok: true, skipped: true }); });
it('gives the integrator a complete participants reminder even when Supabase mail is skipped', async () => {
 const db = client();
 expect(await sendParticipantsNotice(db as never, tx.id, 2)).toBe('sent');
 expect(h.trigger).toHaveBeenCalledWith('order.participants_needed', expect.objectContaining({
  customer: { email: tx.customer_email, locale: 'pl' }, product: { id: 'p', name: 'Workshop', slug: 'workshop' },
  order: expect.objectContaining({ orderId: tx.id, orderNumber: 42, amount: 20000, currency: 'PLN' }),
  reminder: expect.objectContaining({ stage: 2, participantsUrl: expect.stringContaining('/participants?token=') }),
 }), db, 'p', `participants:${tx.id}:2`);
});
it('leaves the notification pending when the webhook queue is unavailable', async () => {
 h.trigger.mockRejectedValue(new Error('unavailable'));
 expect(await sendParticipantsNotice(client() as never, tx.id)).toBe('failed');
 expect(h.magic).not.toHaveBeenCalled();
});
