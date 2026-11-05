import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { paymentSearchQuery } from '@/lib/payments/search';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(url || 'http://127.0.0.1:54321', key || 'not-configured');
const ids: string[] = [];
const tag = `literal-${Date.now()}`;
let orderNumber: number;
const productIds: string[] = [];
let userId: string;
let leadId: string;

describe.skipIf(!url || !key)('literal search transport and results', () => {
beforeAll(async () => {
  const products = await db.from('products').insert([
    { name: "' OR 1=1 --", slug: `${tag}-quote`, price: 1, currency: 'USD' },
    { name: 'a*b', slug: `${tag}-star`, price: 1, currency: 'USD' },
  ]).select('id');
  expect(products.error).toBeNull();
  productIds.push(...products.data!.map(row => row.id));
  const result = await db.from('payment_transactions').insert([
    { product_id: productIds[0], customer_email: `${tag}@example.com`, amount: 100, currency: 'USD', status: 'completed', session_id: `cs_${Date.now()}a` },
    { product_id: productIds[1], customer_email: `${tag}-other@example.com`, amount: 100, currency: 'USD', status: 'completed', session_id: `cs_${Date.now()}b` },
  ]).select('id,order_number');
  expect(result.error).toBeNull();
  ids.push(...result.data!.map(row => row.id));
  orderNumber = result.data![0].order_number;
  const user = await db.auth.admin.createUser({ email: `${tag}-access@example.com`, email_confirm: true });
  expect(user.error).toBeNull();
  userId = user.data.user!.id;
  const access = await db.from('user_product_access').insert({ user_id: userId, product_id: productIds[0], grant_source: 'manual' });
  expect(access.error).toBeNull();
  const lead = await db.from('lead_submissions').insert({ email: `${tag}-lead@example.com`, product_id: productIds[0], source: 'https://example.com/checkout', token_hash: createHash('sha256').update(tag).digest('hex') }).select('id').single();
  expect(lead.error).toBeNull();
  leadId = lead.data!.id;
});
afterAll(async () => {
  if (ids.length) await db.from('payment_transactions').delete().in('id', ids);
  if (leadId) await db.from('lead_submissions').delete().eq('id', leadId);
  if (userId) await db.auth.admin.deleteUser(userId);
  if (productIds.length) await db.from('products').delete().in('id', productIds);
});

it('sends the literal search text in a POST body', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const client = createClient('https://example.supabase.co', 'test-key', { global: { fetch: fetcher } });
  await paymentSearchQuery(client, "' OR 1=1 --").select('id').limit(10);
  const [requestUrl, options] = fetcher.mock.calls[0];
  expect(String(requestUrl)).not.toContain('OR');
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body)).toEqual({ p_search: "' OR 1=1 --" });
});
it.each([["' OR 1=1 --", 0], ['a*b', 1]])('finds the literal product text %s through RPC', async (phrase, index) => {
  const result = await db.rpc('search_payment_transactions', { p_search: phrase }).select('id').in('id', ids);
  expect(result.error).toBeNull();
  expect(result.data).toEqual([{ id: ids[index] }]);
});
it('matches an exact order number', async () => {
  const result = await db.rpc('search_payment_transactions', { p_search: `#${orderNumber}` }).select('id').in('id', ids);
  expect(result.error).toBeNull();
  expect(result.data).toEqual([{ id: ids[0] }]);
});
it('retains the products relation and pagination', async () => {
  const result = await paymentSearchQuery(db, tag).select('id,created_at,products!inner(name,slug)').order('created_at').range(0, 0);
  expect(result.error).toBeNull();
  expect(result.data).toHaveLength(1);
  expect(result.data![0].products).toHaveProperty('name');
});
it.each(['search_payment_transactions', 'search_order_accesses', 'search_order_leads'])('denies anonymous execution of %s', async (name) => {
  const anon = createClient(url!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const result = await anon.rpc(name, { p_search: 'x' });
  expect(result.error?.code).toBe('42501');
});
it('finds access by buyer email and literal product name', async () => {
  for (const phrase of [`${tag}-access`, "' OR 1=1 --"]) {
    const result = await db.rpc('search_order_accesses', { p_search: phrase }).select('user_id').eq('user_id', userId);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ user_id: userId }]);
  }
});
it('finds lead by email and literal product name', async () => {
  for (const phrase of [`${tag}-lead`, "' OR 1=1 --"]) {
    const result = await db.rpc('search_order_leads', { p_search: phrase }).select('id').eq('id', leadId);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: leadId }]);
  }
});
it('rejects overlong input at the database boundary', async () => {
  const result = await db.rpc('search_payment_transactions', { p_search: 'x'.repeat(201) });
  expect(result.error?.code).toBe('22023');
});

});
