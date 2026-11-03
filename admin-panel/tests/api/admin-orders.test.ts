/**
 * API integration: GET /api/admin/orders — the Payments page "Orders" list a seller sees.
 * Seeds one paid order, one bank transfer, one free claim, one manual grant and one lead
 * for a unique email, then reads the list through a real admin session.
 * Run: bun run test:api (requires dev server + supabase running)
 * @see src/app/api/admin/orders/route.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';

const API_URL = process.env.TEST_API_URL || 'http://localhost:3777';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || '');

async function sessionCookie(email: string, password: string): Promise<string> {
  const { data } = await createClient(SUPABASE_URL, ANON_KEY).auth.signInWithPassword({ email, password });
  if (!data.session) throw new Error(`Login failed for ${email}`);
  return `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`;
}

interface OrderRow { id: string; type: string; status: string; orderNumber: number | null; email: string | null }

describe('GET /api/admin/orders', () => {
  const r = randomBytes(4).toString('hex');
  const tag = `orders-${r}`;
  const created = { products: [] as string[], users: [] as string[], tx: [] as string[], leads: [] as string[] };
  let adminCookie = '';
  let paidOrderNumber = 0;

  const list = async (query: string, cookie = adminCookie) => {
    const response = await fetch(`${API_URL}/api/admin/orders?${query}`, { headers: { Cookie: cookie } });
    return { status: response.status, body: await response.json().catch(() => ({})) as { orders?: OrderRow[] } };
  };

  beforeAll(async () => {
    const adminId = process.env.TEST_AUTH_USER_ID!;
    const adminEmail = (await supabase.auth.admin.getUserById(adminId)).data.user!.email!;
    adminCookie = await sessionCookie(adminEmail, 'TestPassword123!');

    const product = async (price: number) => {
      const { data, error } = await supabase.from('products')
        .insert({ name: `Orders ${price} ${r}`, slug: `orders-${price}-${r}`, description: 'orders list test', price, currency: 'PLN', is_active: true })
        .select('id').single();
      if (error) throw error;
      created.products.push(data.id);
      return data.id as string;
    };
    const paidId = await product(49);
    const freeId = await product(0);
    const user = async (label: string) => {
      const { data, error } = await supabase.auth.admin.createUser({ email: `${tag}-${label}@example.com`, password: 'password123', email_confirm: true });
      if (error) throw error;
      created.users.push(data.user!.id);
      return data.user!.id;
    };
    const buyerId = await user('buyer');
    const freeUserId = await user('free');
    const manualUserId = await user('manual');

    const { data: paid, error: paidError } = await supabase.from('payment_transactions').insert({
      customer_email: `${tag}-buyer@example.com`, user_id: buyerId, amount: 4900, currency: 'PLN', status: 'completed',
      product_id: paidId, session_id: `cs_orders_${r}`, stripe_payment_intent_id: `pi_orders_${r}`,
    }).select('id, order_number').single();
    if (paidError) throw paidError;
    created.tx.push(paid.id);
    paidOrderNumber = paid.order_number;
    const { data: transfer, error: transferError } = await supabase.from('payment_transactions').insert({
      customer_email: `${tag}-transfer@example.com`, amount: 4900, currency: 'PLN', status: 'awaiting_payment',
      product_id: paidId, payment_provider: 'bank_transfer', pricing_snapshot_version: 1,
      payment_due_at: '2099-01-01T00:00:00Z', metadata: { customer_email: `${tag}-transfer@example.com` },
    }).select('id').single();
    if (transferError) throw transferError;
    created.tx.push(transfer.id);

    const { error: accessError } = await supabase.from('user_product_access').insert([
      { user_id: buyerId, product_id: paidId },
      { user_id: freeUserId, product_id: freeId },
      { user_id: manualUserId, product_id: paidId },
    ]);
    if (accessError) throw accessError;

    const { data: lead, error: leadError } = await supabase.from('lead_submissions').insert({
      token_hash: createHash('sha256').update(tag).digest('hex'), email: `${tag}-lead@example.com`, product_id: freeId,
      source: 'https://example.com/landing', expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }).select('id').single();
    if (leadError) throw leadError;
    created.leads.push(lead.id);
  });

  afterAll(async () => {
    await supabase.from('lead_submissions').delete().in('id', created.leads);
    await supabase.from('user_product_access').delete().in('user_id', created.users);
    await supabase.from('payment_transactions').delete().in('id', created.tx);
    await supabase.from('products').delete().in('id', created.products);
    for (const id of created.users) await supabase.auth.admin.deleteUser(id);
  });

  it('lists paid, transfer, free, manual and lead entries for the seller @J160', async () => {
    const { status, body } = await list(`search=${encodeURIComponent(tag)}`);
    expect(status).toBe(200);
    const summary = body.orders!.map(o => [o.email, o.type, o.status]).sort();
    expect(summary).toEqual([
      [`${tag}-buyer@example.com`, 'paid', 'completed'],
      [`${tag}-free@example.com`, 'free', 'active'],
      [`${tag}-lead@example.com`, 'lead', 'pending'],
      [`${tag}-manual@example.com`, 'manual', 'active'],
      [`${tag}-transfer@example.com`, 'transfer', 'awaiting_payment'],
    ].sort());
  });

  it('filters by type and finds an order by number @J160', async () => {
    const leads = await list(`type=lead&search=${encodeURIComponent(tag)}`);
    expect(leads.body.orders!.map(o => o.type)).toEqual(['lead']);
    const byNumber = await list(`search=${paidOrderNumber}`);
    expect(byNumber.body.orders!.map(o => o.orderNumber)).toEqual([paidOrderNumber]);
  });

  it('rejects anonymous callers and invalid filters @J160', async () => {
    expect((await list('', '')).status).toBe(401);
    expect((await list('type=everything')).status).toBe(400);
  });
});
