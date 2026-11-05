import { expect, it, vi } from 'vitest';
import { enrichBuyerWebhook } from '@/lib/webhooks/buyer-notifications';
it('includes the buyer language and entitled event details in the purchase notification', async () => {
 const tx = { metadata: { locale: 'pl' } };
 const session = { id: 's1', starts_at: '2027-01-01T12:00:00Z', timezone: 'Europe/Warsaw', online_url: 'https://example.com/join', title: 'Workshop' };
 const q = (data: unknown) => { const c: Record<string, unknown> = {}; for (const m of ['select','eq']) c[m] = () => c; c.single = async () => ({ data, error: null }); c.then = (r: (v: unknown) => unknown) => r({ data, error: null }); return c; };
 const db = { from: (t: string) => q(t === 'payment_transactions' ? tx : [{ event: session }]), rpc: vi.fn(async () => ({ data: true, error: null })) };
 const data = { customer: { email: 'buyer@example.com' }, product: { id: 'p' }, order: { orderId: 'o' } };
 expect(await enrichBuyerWebhook('purchase.completed', data, db as never)).toMatchObject({ customer: { email: 'buyer@example.com', locale: 'pl' }, buyerMail: { event_online_url: session.online_url, event_date: expect.stringContaining('Europe/Warsaw') } });
});
