import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Drives the production proxy directly with two concurrent callers for the
// SAME purchase (one pending row pre-exists). Exactly one call must report a
// fresh completion; the other must report already-granted.
describe('process_stripe_payment_completion_with_bump — single writer', () => {
  let productId: string;
  const pi = `pi_singlewriter_${Date.now()}`;
  const cs = `cs_singlewriter_${Date.now()}`;
  const email = `single.writer.${Date.now()}@example.com`;

  beforeAll(async () => {
    const { data: product } = await supabaseAdmin
      .from('products')
      .insert({ slug: `sw-${Date.now()}`, name: 'SW', price: 10, currency: 'usd', is_active: true })
      .select('id').single();
    productId = product!.id;

    // Pre-create the pending transaction both callers will complete.
    await supabaseAdmin.from('payment_transactions').insert({
      session_id: cs, product_id: productId, customer_email: email,
      amount: 1000, currency: 'usd', stripe_payment_intent_id: pi, status: 'pending',
    });
  });

  it('grants exactly once under concurrent completion', async () => {
    const call = () => supabaseAdmin.rpc('process_stripe_payment_completion_with_bump', {
      session_id_param: cs, product_id_param: productId, customer_email_param: email,
      amount_total: 1000, currency_param: 'usd', stripe_payment_intent_id: pi,
    });

    const [a, b] = await Promise.all([call(), call()]);

    const results = [a.data as any, b.data as any].filter(r => r?.success);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // "fresh completion" = success && !already_had_access. Must be exactly one.
    const fresh = results.filter(r => r.success && !r.already_had_access);
    expect(fresh.length).toBe(1);
  });
});
