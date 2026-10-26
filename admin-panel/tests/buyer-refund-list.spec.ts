/** Buyer refund list uses the signed-in account. @see app/api/refund-requests/route.ts */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession } from './helpers/admin-auth';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const password = 'Refund-list-test-123!';
const users: { id: string; email: string }[] = [];
let productId: string;
let requestId: string;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  for (let index = 0; index < 2; index++) {
    const email = `refund-list-${randomUUID()}@example.com`;
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    expect(error).toBeNull();
    users.push({ id: data.user!.id, email });
  }
  const { data, error } = await db.from('products').insert({ name: 'Buyer refund list', slug: `refund-list-${randomUUID()}`, price: 49, currency: 'PLN', is_active: true }).select('id').single();
  expect(error).toBeNull();
  productId = data!.id;
});
test.afterAll(async () => {
  if (productId) {
    await db.from('refund_requests').delete().eq('product_id', productId);
    await db.from('payment_transactions').delete().eq('product_id', productId);
    await db.from('products').delete().eq('id', productId);
  }
  for (const user of users) await db.auth.admin.deleteUser(user.id);
});
test('anonymous caller receives 401', async ({ request }) => {
  expect((await request.get('/api/refund-requests')).status()).toBe(401);
});
test('buyer with no requests receives an empty list', async ({ page }) => {
  await setAuthSession(page, users[0].email, password);
  const response = await page.request.get('/api/refund-requests');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ requests: [] });
});
test('buyer sees an own request with product and transaction', async ({ page }) => {
  const user = users[0];
  const { data: transaction, error } = await db.from('payment_transactions').insert({ user_id: user.id, customer_email: user.email, product_id: productId, amount: 4900, currency: 'PLN', status: 'completed', stripe_payment_intent_id: `pi_refund_${randomUUID().replaceAll('-', '')}`, session_id: `cs_refund_${randomUUID().replaceAll('-', '')}` }).select('id').single();
  expect(error).toBeNull();
  const { data, error: insertError } = await db.from('refund_requests').insert({ user_id: user.id, customer_email: user.email, product_id: productId, transaction_id: transaction!.id, requested_amount: 4900, currency: 'PLN', reason: 'Purchased the wrong edition' }).select('id').single();
  expect(insertError).toBeNull();
  requestId = data!.id;
  await setAuthSession(page, user.email, password);
  const response = await page.request.get('/api/refund-requests');
  expect(response.status()).toBe(200);
  expect((await response.json()).requests).toEqual([expect.objectContaining({ id: requestId, products: expect.objectContaining({ id: productId }), payment_transactions: expect.objectContaining({ id: transaction!.id }) })]);
});
test('another buyer receives no other account requests in API or database', async ({ page }) => {
  await setAuthSession(page, users[1].email, password);
  const response = await page.request.get('/api/refund-requests');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ requests: [] });
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  expect((await client.auth.signInWithPassword({ email: users[1].email, password })).error).toBeNull();
  const result = await client.from('refund_requests').select('id');
  expect(result.error).toBeNull();
  expect(result.data).toEqual([]);
  await client.auth.signOut();
});
