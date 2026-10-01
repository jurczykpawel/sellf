/**
 * DB TEST: customers create refund requests only through create_refund_request,
 * and only for their own purchases
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const CLIENT_OPTS = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, CLIENT_OPTS);
const PASSWORD = 'refund-owner-Test-123!';
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let buyer: { id: string; email: string; client: SupabaseClient };
let productId: string;
const transactionIds: string[] = [];

async function createTransaction(userId: string | null, email: string): Promise<string> {
  const { data, error } = await admin
    .from('payment_transactions')
    .insert({
      session_id: `cs_refund_owner_${RUN.replace(/-/g, "_")}_${transactionIds.length}`,
      product_id: productId,
      user_id: userId,
      customer_email: email,
      amount: 5000,
      currency: 'USD',
      status: 'completed',
    })
    .select('id')
    .single();
  if (error) throw error;
  transactionIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  const { data: product, error: productError } = await admin
    .from('products')
    .insert({
      name: `Refund owner ${RUN}`,
      slug: `refund-owner-${RUN}`,
      price: 50,
      currency: 'USD',
      is_active: true,
      is_refundable: true,
      refund_period_days: 30,
    })
    .select('id')
    .single();
  if (productError) throw productError;
  productId = product.id;

  const email = `refund-owner-${RUN}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !created.user) throw error ?? new Error('createUser failed');
  const client = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  buyer = { id: created.user.id, email, client };
});

afterAll(async () => {
  await admin.from('refund_requests').delete().in('transaction_id', transactionIds);
  await admin.from('payment_transactions').delete().in('id', transactionIds);
  if (productId) await admin.from('products').delete().eq('id', productId);
  if (buyer) await admin.auth.admin.deleteUser(buyer.id);
});

describe('refund requests', () => {
  it('rejects a row inserted directly by a customer', async () => {
    const txId = await createTransaction(buyer.id, buyer.email);

    const { error } = await buyer.client.from('refund_requests').insert({
      transaction_id: txId,
      user_id: buyer.id,
      customer_email: buyer.email,
      product_id: productId,
      requested_amount: 5000,
      currency: 'USD',
      status: 'pending',
    });

    expect(error).not.toBeNull();
  });

  it('rejects a direct update by a customer', async () => {
    const txId = await createTransaction(buyer.id, buyer.email);
    const created = await buyer.client.rpc('create_refund_request', { transaction_id_param: txId });
    expect(created.data?.success).toBe(true);

    const { error } = await buyer.client
      .from('refund_requests')
      .update({ reason: 'changed' })
      .eq('transaction_id', txId);

    expect(error).not.toBeNull();
  });

  it('refuses a request for a purchase that has no account attached', async () => {
    const txId = await createTransaction(null, `guest-${RUN}@example.com`);

    const { data } = await buyer.client.rpc('create_refund_request', { transaction_id_param: txId });

    expect(data?.success).toBe(false);
    const { data: rows } = await admin.from('refund_requests').select('id').eq('transaction_id', txId);
    expect(rows).toEqual([]);
  });

  it('does not report eligibility for another customer purchase', async () => {
    const txId = await createTransaction(null, `guest-elig-${RUN}@example.com`);

    const { data } = await buyer.client.rpc('check_refund_eligibility', { transaction_id_param: txId });

    expect(data?.eligible).toBe(false);
    expect(data?.amount).toBeUndefined();
  });

  it('accepts a request for the customer own purchase, priced from the transaction', async () => {
    const txId = await createTransaction(buyer.id, buyer.email);

    const { data } = await buyer.client.rpc('create_refund_request', { transaction_id_param: txId });

    expect(data?.success).toBe(true);
    const { data: row } = await admin
      .from('refund_requests')
      .select('requested_amount, status')
      .eq('transaction_id', txId)
      .single();
    expect(row).toEqual({ requested_amount: 5000, status: 'pending' });
  });
});
