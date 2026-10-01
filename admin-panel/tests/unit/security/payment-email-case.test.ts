/**
 * DB TEST: payment completion matches customers by e-mail regardless of letter case
 *
 * Stripe returns the e-mail as typed by the buyer; accounts store it lowercased.
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error('Missing Supabase env variables for testing');

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const RUN = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
let productId: string;
const sessionIds: string[] = [];
const userIds: string[] = [];

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'email-case-Test-123!', email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  userIds.push(data.user.id);
  return data.user.id;
}

async function complete(email: string) {
  const sessionId = `cs_emailcase_${RUN}_${sessionIds.length}`;
  sessionIds.push(sessionId);
  const { data, error } = await admin.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: sessionId,
    product_id_param: productId,
    customer_email_param: email,
    amount_total: 1000,
    currency_param: 'USD',
  });
  if (error) throw error;
  return data as { success: boolean; is_guest_purchase?: boolean };
}

async function hasAccess(userId: string): Promise<boolean> {
  const { data } = await admin
    .from('user_product_access')
    .select('id')
    .eq('user_id', userId)
    .eq('product_id', productId);
  return (data ?? []).length > 0;
}

beforeAll(async () => {
  const { data, error } = await admin
    .from('products')
    .insert({ name: `Email case ${RUN}`, slug: `email-case-${RUN}`, price: 10, currency: 'USD', is_active: true })
    .select('id')
    .single();
  if (error) throw error;
  productId = data.id;
});

afterAll(async () => {
  await admin.from('guest_purchases').delete().in('session_id', sessionIds);
  await admin.from('payment_line_items').delete().in(
    'transaction_id',
    ((await admin.from('payment_transactions').select('id').in('session_id', sessionIds)).data ?? []).map((r) => r.id),
  );
  await admin.from('payment_transactions').delete().in('session_id', sessionIds);
  await admin.from('user_product_access').delete().eq('product_id', productId);
  await admin.from('products').delete().eq('id', productId);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
});

describe('payment completion e-mail matching', () => {
  it('grants an existing account when Stripe reports the e-mail in another case', async () => {
    const userId = await createUser(`buyer-${RUN}@example.com`);

    const result = await complete(`Buyer-${RUN}@Example.com`);

    expect(result.success).toBe(true);
    expect(result.is_guest_purchase).toBeFalsy();
    expect(await hasAccess(userId)).toBe(true);
  });

  it('lets a later account claim a guest purchase made with a differently cased e-mail', async () => {
    const result = await complete(`Later-${RUN}@Example.com`);
    expect(result.is_guest_purchase).toBe(true);

    const userId = await createUser(`later-${RUN}@example.com`);
    await admin.rpc('claim_guest_purchases_for_user', { p_user_id: userId });

    expect(await hasAccess(userId)).toBe(true);
  });
});
