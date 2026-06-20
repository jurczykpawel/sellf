import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

// ---------------------------------------------------------------------------
// Registered-user variant: same concurrent-completion guarantee for a user
// who is already registered in auth.users at purchase time. The lock key is
// the payment intent, same as the guest case, so serialisation holds.
// ---------------------------------------------------------------------------
describe('process_stripe_payment_completion_with_bump — registered-user single writer', () => {
  const TS = Date.now();
  const pi = `pi_reguser_${TS}`;
  const cs = `cs_reguser_${TS}`;
  const email = `reg.writer.${TS}@example.com`;
  let productId: string;
  let userId: string;

  beforeAll(async () => {
    // Create a real auth user so user_id_param can be resolved.
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (authErr || !authData?.user) throw new Error(`createUser failed: ${authErr?.message}`);
    userId = authData.user.id;

    const { data: product, error: prodErr } = await supabaseAdmin
      .from('products')
      .insert({ slug: `sw-reg-${TS}`, name: 'SW-Reg', price: 10, currency: 'usd', is_active: true })
      .select('id').single();
    if (prodErr || !product) throw new Error(`insert product failed: ${prodErr?.message}`);
    productId = product.id;

    // Pre-create the pending transaction (mirrors what the embed checkout-session route does
    // for an authenticated buyer: session_id, pi, and user_id all populated).
    const { error: txErr } = await supabaseAdmin.from('payment_transactions').insert({
      session_id: cs, product_id: productId, customer_email: email,
      amount: 1000, currency: 'usd', stripe_payment_intent_id: pi,
      status: 'pending', user_id: userId,
    });
    if (txErr) throw new Error(`insert pending tx failed: ${txErr.message}`);
  });

  afterAll(async () => {
    // Clean up in dependency order to avoid FK constraint failures.
    await supabaseAdmin.from('user_product_access').delete().eq('user_id', userId);
    await supabaseAdmin.from('payment_transactions').delete().eq('stripe_payment_intent_id', pi);
    await supabaseAdmin.from('products').delete().eq('id', productId);
    await supabaseAdmin.auth.admin.deleteUser(userId);
  });

  it('grants exactly once for a registered user under concurrent completion', async () => {
    const call = () => supabaseAdmin.rpc('process_stripe_payment_completion_with_bump', {
      session_id_param: cs,
      product_id_param: productId,
      customer_email_param: email,
      amount_total: 1000,
      currency_param: 'usd',
      stripe_payment_intent_id: pi,
      user_id_param: userId,
    });

    const [a, b] = await Promise.all([call(), call()]);

    const results = [a.data as any, b.data as any].filter(r => r?.success);
    expect(results.length).toBeGreaterThanOrEqual(1);

    // Exactly one fresh completion (success && !already_had_access).
    // The fresh call completes the pending transaction and grants access;
    // the other call hits the idempotency guard and returns already_had_access:true.
    const fresh = results.filter((r: any) => r.success && !r.already_had_access);
    expect(fresh.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Dual-event variant: Stripe fires BOTH checkout.session.completed (cs_X) AND
// payment_intent.succeeded (pi_Y) for the same purchase. Both should lock on
// hashtext(pi_Y) → serialised. The first caller to acquire the lock completes
// the pending row; the second caller re-resolves via pi_Y to the cs_X row and
// hits the idempotency path.
// ---------------------------------------------------------------------------
describe('process_stripe_payment_completion_with_bump — dual-event (cs_/pi_) single writer', () => {
  const TS = Date.now();
  const pi = `pi_dualevt_${TS}`;
  const csX = `cs_dualevt_${TS}`;   // the checkout-session event id
  const piY = `pi_dualevt_${TS}`;   // the payment-intent event id (same as pi above)
  const email = `dual.evt.${TS}@example.com`;
  let productId: string;

  beforeAll(async () => {
    const { data: product, error: prodErr } = await supabaseAdmin
      .from('products')
      .insert({ slug: `sw-dual-${TS}`, name: 'SW-Dual', price: 10, currency: 'usd', is_active: true })
      .select('id').single();
    if (prodErr || !product) throw new Error(`insert product failed: ${prodErr?.message}`);
    productId = product.id;

    // Pre-create the pending row keyed by the checkout-session id (cs_X) and
    // the payment intent id (pi_Y). This mirrors what the webhook handler inserts
    // when it processes checkout.session.completed before Stripe fires
    // payment_intent.succeeded.
    const { error: txErr } = await supabaseAdmin.from('payment_transactions').insert({
      session_id: csX, product_id: productId, customer_email: email,
      amount: 1000, currency: 'usd', stripe_payment_intent_id: pi,
      status: 'pending',
    });
    if (txErr) throw new Error(`insert pending tx failed: ${txErr.message}`);
  });

  afterAll(async () => {
    await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', email);
    await supabaseAdmin.from('payment_transactions').delete().eq('stripe_payment_intent_id', pi);
    await supabaseAdmin.from('products').delete().eq('id', productId);
  });

  it('grants exactly once when cs_ and pi_ event callers race', async () => {
    // Call A uses the checkout-session id (cs_X) — the first Stripe event.
    const callA = () => supabaseAdmin.rpc('process_stripe_payment_completion_with_bump', {
      session_id_param: csX,
      product_id_param: productId,
      customer_email_param: email,
      amount_total: 1000,
      currency_param: 'usd',
      stripe_payment_intent_id: piY,
    });

    // Call B uses the payment-intent id (pi_Y) — the second Stripe event.
    // The proxy locks on hashtext(coalesce(piY, piY)) = hashtext(piY), same key
    // as call A, so the two are serialised.
    const callB = () => supabaseAdmin.rpc('process_stripe_payment_completion_with_bump', {
      session_id_param: piY,
      product_id_param: productId,
      customer_email_param: email,
      amount_total: 1000,
      currency_param: 'usd',
      stripe_payment_intent_id: piY,
    });

    const [a, b] = await Promise.all([callA(), callB()]);

    const results = [a.data as any, b.data as any].filter(r => r?.success);
    expect(results.length).toBeGreaterThanOrEqual(1);

    // Exactly one fresh completion across the two Stripe events.
    const fresh = results.filter((r: any) => r.success && !r.already_had_access);
    expect(fresh.length).toBe(1);
  });
});
