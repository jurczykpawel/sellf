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

it('recovers a historical subscription summary from its recorded paid invoice @J37', async () => {
  const { execFileSync } = await import('node:child_process');
  const { getTestDatabaseContainer } = await import('../helpers/database-container');
  const result = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { encoding: 'utf8', input: `BEGIN;
    SET LOCAL request.jwt.claims='{"role":"service_role"}';
    DO $test$ DECLARE u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); BEGIN
      INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(u,u::text||'@example.com',now());
      INSERT INTO public.products(id,name,slug,price,currency,product_type,recurring_price,billing_interval,billing_interval_count)
        VALUES(p,'Original plan',p::text,0,'PLN','subscription',49,'month',1);
      INSERT INTO public.subscriptions(id,user_id,product_id,status,stripe_subscription_id,stripe_customer_id)
        VALUES(s,u,p,'active','sub_'||s::text,'cus_'||s::text);
      INSERT INTO public.payment_transactions(id,product_id,user_id,customer_email,subscription_id,amount,currency,status,session_id)
        VALUES(t,p,u,u::text||'@example.com',s,4900,'PLN','completed','in_'||replace(t::text,'-',''));
      SET CONSTRAINTS ALL IMMEDIATE;
      ALTER TABLE public.subscriptions DISABLE TRIGGER snapshot_subscription_product;
      UPDATE public.subscriptions SET product_summary=NULL WHERE id=s;
      ALTER TABLE public.subscriptions ENABLE TRIGGER snapshot_subscription_product;
      UPDATE public.products SET name='Changed catalogue',recurring_price=99,is_active=false WHERE id=p;
      UPDATE public.subscriptions SET updated_at=now() WHERE id=s;
      IF NOT EXISTS(SELECT 1 FROM public.subscriptions WHERE id=s AND product_summary->>'name'='Original plan'
        AND (product_summary->>'recurring_price')::numeric=49) THEN RAISE EXCEPTION 'Purchased summary was replaced by current catalogue'; END IF;
    END $test$; SELECT 'historical summary retained'; ROLLBACK;` });
  expect(result.trim()).toBe('historical summary retained');
});
