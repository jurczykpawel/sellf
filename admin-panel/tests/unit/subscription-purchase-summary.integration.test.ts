/** Owned subscriptions retain their purchased summary outside the public catalogue. */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));
vi.mock('@/lib/rate-limiting', () => ({ checkRateLimit: async () => true, RATE_LIMITS: { SUBSCRIPTION_READ: {} } }));
import { GET } from '@/app/api/subscriptions/route';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<T> { if (error) throw error; return data; }
it('keeps the purchased name and price after archive, catalogue edits, and deactivation @J37', async () => {
  const id = randomUUID(), email = `sub-summary-${id}@example.com`, password = `Password-${id}!`;
  const u = (await checked(await db.auth.admin.createUser({ email, password, email_confirm: true }))).user!;
  const p = (await checked(await db.from('products').insert({ name: 'Purchased plan', slug: `sub-${id}`, price: 0, currency: 'PLN', is_active: true, product_type: 'subscription', recurring_price: 49, billing_interval: 'month', billing_interval_count: 1 }).select('id').single()))!;
  try {
    await checked(await db.from('subscriptions').insert({ user_id: u.id, product_id: p.id, stripe_subscription_id: `sub_${id}`, stripe_customer_id: `cus_${id}`, status: 'active' }));
    const buyer = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
    await checked(await buyer.auth.signInWithPassword({ email, password })); state.client = buyer;
    await checked(await db.from('products').update({ is_active: false, archived_at: new Date().toISOString(), name: 'Changed catalogue', recurring_price: 99 }).eq('id', p.id));
    expect((await checked(await buyer.from('products').select('id').eq('id', p.id)))).toEqual([]);
    const response = await GET(); expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.subscriptions).toHaveLength(1);
    expect(data.subscriptions[0].product).toMatchObject({ id: p.id, name: 'Purchased plan', recurring_price: 49, currency: 'PLN', billing_interval: 'month' });
    state.client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
    expect((await GET()).status).toBe(401);
  } finally {
    await db.from('subscriptions').delete().eq('user_id', u.id);
    await db.auth.admin.deleteUser(u.id); await db.from('products').delete().eq('id', p.id);
  }
});
