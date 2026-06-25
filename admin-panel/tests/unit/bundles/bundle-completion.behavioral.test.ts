/**
 * BEHAVIORAL tests for bundle access explosion in the completion RPC + guest-claim.
 *
 * These drive the REAL local Supabase stack (real RPC
 * `process_stripe_payment_completion_with_bump` → `_impl` →
 * `grant_product_and_bundle_components`, real `claim_guest_purchases_for_user` via the
 * `handle_new_user_registration` trigger). They assert that buying a bundle grants the
 * bundle + every component while still writing exactly ONE `main_product` line item
 * (VAT/line-items stay mode 1a — the bundle is a single line, components are NOT itemized),
 * and that a guest who buys a bundle receives the components after registering.
 *
 * Env: SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (loaded by
 * vitest.config.ts via loadEnv). Mirrors the env/run pattern of
 * tests/unit/webhooks/onetime-payment-handlers.behavioral.test.ts.
 *
 * Run: bunx vitest run tests/unit/bundles/bundle-completion.behavioral.test.ts
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = URL && KEY ? createClient(URL, KEY) : null;
const ids: string[] = []; const users: string[] = []; const emails: string[] = [];

async function mkProduct(over: Record<string, unknown> = {}) {
  const slug = `c-${crypto.randomUUID().slice(0, 8)}`;
  const { data, error } = await db!.from('products')
    .insert({ name: slug, slug, price: 100, currency: 'PLN', is_active: true, ...over }).select('id').single();
  if (error) throw error; ids.push(data!.id); return data!.id as string;
}

beforeAll(() => { if (!db) console.warn('[bundle-completion] skip — needs Supabase env'); });
// Two completion-driving RPCs in this suite are rate-limited and share GLOBAL anti-spoof buckets
// that aggregate across the WHOLE suite, so the 1-hour window trips when many behavioral tests run
// together (passes in isolation, fails in the full `tt`). Reset both per test for deterministic
// isolation (test infra, not behavior under test):
//   - process_stripe_payment_completion (100/hour) — drives the bundle completion test.
//   - claim_guest_purchases_for_user    (10/hour)  — drives the guest-claim test; far lower cap,
//     so it exhausts first and the registration trigger silently grants nothing.
// Same pattern as the onetime-handlers / verify-payment behavioral harnesses.
beforeEach(async () => {
  if (db) {
    await db.from('rate_limits').delete().like('function_name', '%process_stripe_payment_completion');
    await db.from('rate_limits').delete().like('function_name', '%claim_guest_purchases_for_user');
  }
});
afterAll(async () => {
  if (!db) return;
  await db.from('guest_purchases').delete().in('customer_email', emails);
  await db.from('payment_line_items').delete().in('product_id', ids);
  await db.from('user_product_access').delete().in('product_id', ids);
  await db.from('payment_transactions').delete().in('product_id', ids);
  await db.from('bundle_items').delete().in('bundle_product_id', ids);
  await db.from('products').delete().in('id', ids);
  for (const u of users) await db.auth.admin.deleteUser(u).catch(() => {});
});

describe.skipIf(!db)('bundle completion + guest claim', () => {
  it('completing a bundle purchase grants bundle + components and writes ONE main line item', async () => {
    const bundle = await mkProduct({ is_bundle: true, price: 199 });
    const a = await mkProduct(); const b = await mkProduct();
    await db!.from('bundle_items').insert([
      { bundle_product_id: bundle, component_product_id: a },
      { bundle_product_id: bundle, component_product_id: b },
    ]);
    const { data: user } = await db!.auth.admin.createUser({ email: `bc-${crypto.randomUUID().slice(0,8)}@t.dev`, email_confirm: true });
    users.push(user!.user!.id);
    // Session id must match the RPC's format contract ^(cs_|pi_)[a-zA-Z0-9_]+$ — strip uuid hyphens.
    const session = `cs_${crypto.randomUUID().replace(/-/g, '')}`;

    const { data, error } = await db!.rpc('process_stripe_payment_completion_with_bump', {
      session_id_param: session, product_id_param: bundle, customer_email_param: user!.user!.email,
      amount_total: 19900, currency_param: 'pln', stripe_payment_intent_id: `pi_${crypto.randomUUID().replace(/-/g, "")}`,
      user_id_param: user!.user!.id, bump_product_ids_param: null, coupon_id_param: null, amount_subtotal_param: 19900,
    });
    expect(error).toBeNull();
    expect((data as { success?: boolean }).success).toBe(true);

    const { data: access } = await db!.from('user_product_access').select('product_id').eq('user_id', user!.user!.id);
    const owned = new Set((access ?? []).map((r) => r.product_id));
    expect(owned.has(bundle)).toBe(true); expect(owned.has(a)).toBe(true); expect(owned.has(b)).toBe(true);

    const { data: txn } = await db!.from('payment_transactions').select('id').eq('session_id', session).single();
    const { data: lines } = await db!.from('payment_line_items').select('product_id,item_type').eq('transaction_id', txn!.id);
    expect(lines).toHaveLength(1);
    expect(lines![0]).toMatchObject({ product_id: bundle, item_type: 'main_product' });
  });

  it('guest bundle purchase grants components after registration (claim)', async () => {
    const bundle = await mkProduct({ is_bundle: true, price: 50 });
    const a = await mkProduct();
    await db!.from('bundle_items').insert({ bundle_product_id: bundle, component_product_id: a });
    const email = `guest-${crypto.randomUUID().slice(0,8)}@t.dev`; emails.push(email);
    // Session id must match the RPC's format contract ^(cs_|pi_)[a-zA-Z0-9_]+$ — strip uuid hyphens.
    const session = `cs_${crypto.randomUUID().replace(/-/g, '')}`;

    await db!.rpc('process_stripe_payment_completion_with_bump', {
      session_id_param: session, product_id_param: bundle, customer_email_param: email,
      amount_total: 5000, currency_param: 'pln', stripe_payment_intent_id: `pi_${crypto.randomUUID().replace(/-/g, "")}`,
      user_id_param: null, bump_product_ids_param: null, coupon_id_param: null, amount_subtotal_param: 5000,
    });

    const { data: user } = await db!.auth.admin.createUser({ email, email_confirm: true });
    users.push(user!.user!.id);
    // handle_new_user_registration trigger runs claim_guest_purchases_for_user automatically.
    await new Promise((r) => setTimeout(r, 400));
    const { data: access } = await db!.from('user_product_access').select('product_id').eq('user_id', user!.user!.id);
    const owned = new Set((access ?? []).map((r) => r.product_id));
    expect(owned.has(bundle)).toBe(true);
    expect(owned.has(a)).toBe(true); // <-- fails before the fix
  });
});
