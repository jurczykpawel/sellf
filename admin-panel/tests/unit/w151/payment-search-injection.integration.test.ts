/**
 * B4 (W146): hostile search phrases in Payments/Orders search must never error out,
 * widen the filter, or leak rows. Runs against the real local PostgREST.
 * @see src/lib/payments/search.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { buildPaymentSearchFilter, buildSearchPattern } from '@/lib/payments/search';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = SUPABASE_URL && KEY ? createClient(SUPABASE_URL, KEY) : null;
const tag = `w151${Date.now()}`;
const ids: string[] = [];

describe.skipIf(!db)('payment search with hostile input', () => {
  beforeAll(async () => {
    const { data: product } = await db!.from('products').select('id').limit(1).single();
    const { data, error } = await db!.from('payment_transactions').insert([
      { product_id: product!.id, customer_email: `${tag}-target@example.com`, amount: 100, currency: 'USD', status: 'completed', session_id: `cs_${tag}a` },
      { product_id: product!.id, customer_email: `${tag}-other@example.com`, amount: 100, currency: 'USD', status: 'completed', session_id: `cs_${tag}b` },
    ]).select('id');
    if (error) throw error;
    ids.push(...data!.map((row) => row.id));
  });
  afterAll(async () => { if (ids.length) await db!.from('payment_transactions').delete().in('id', ids); });

  const hostile = ["' OR 1=1 --", 'a OR 1=1 --', '1=1 --', '%', '*', 'a,b', '(a)', 'a)', '"q"', "'", '\\', 'customer_email.neq.x', 'x),id.neq.(0'];
  it.each(hostile)('%s returns no error and none of the seeded rows', async (phrase) => {
    const { filter, error } = await buildPaymentSearchFilter(db!, phrase);
    expect(error).toBeNull();
    const result = await db!.from('payment_transactions').select('id').in('id', ids).or(filter!);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it('still finds the exact row by a part of the e-mail', async () => {
    const { filter } = await buildPaymentSearchFilter(db!, `${tag}-target`);
    const result = await db!.from('payment_transactions').select('customer_email').in('id', ids).or(filter!);
    expect(result.data).toEqual([{ customer_email: `${tag}-target@example.com` }]);
  });

  it('treats "*" literally instead of as PostgREST match-all', () => {
    expect(buildSearchPattern('a*b')).toBe('a\\*b');
  });
});
