/**
 * Completion contract exercised through the local order RPCs.
 * @see supabase/migrations/20261022210000_order_completion_tail.sql
 * @see supabase/migrations/20261022211000_offline_order_completion.sql
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const products: string[] = []; const txs: string[] = []; const users: string[] = []; const coupons: string[] = [];
let bump: string;
const email = `completion-${crypto.randomUUID()}@example.com`;
async function checked<T>(r: { data: T; error: unknown }): Promise<NonNullable<T>> {
  if (r.error) throw r.error; return r.data!;
}
beforeAll(async () => {
  for (let i = 0; i < 3; i++) {
    const slug = `completion-${crypto.randomUUID()}`;
    products.push((await checked(await db.from('products').insert({ name: slug, slug, price: 100, currency: 'PLN', is_active: true, price_includes_vat: true }).select('id').single())).id);
  }
  bump = (await checked(await db.from('order_bumps').insert({ main_product_id: products[0], bump_product_id: products[1], bump_title: 'Extra' }).select('id').single())).id;
});
afterAll(async () => {
  await db.from('guest_purchases').delete().in('transaction_id', txs);
  await db.from('coupon_redemptions').delete().in('coupon_id', coupons);
  await db.from('coupon_reservations').delete().in('coupon_id', coupons);
  await db.from('payment_transactions').delete().in('id', txs);
  await db.from('coupons').delete().in('id', coupons);
  for (const id of users) await db.auth.admin.deleteUser(id);
  await db.from('order_bumps').delete().eq('id', bump);
  await db.from('products').delete().in('id', products);
});
function line(extra: Record<string, unknown> = {}) {
  return { product_id: products[0], item_type: 'main_product', quantity: 2, unit_price: 100, total_price: 200, discounted_total: 160, currency: 'PLN', product_name: 'Saved', tax_behavior: 'inclusive', vat_rate: 0, ...extra };
}
async function place(provider = 'stripe', extra: Record<string, unknown> = {}, lines = [line()]) {
  const order = { payment_provider: provider, product_id: products[0], customer_email: email, currency: 'PLN', ...(provider === 'stripe' ? { session_id: `cs_${crypto.randomUUID().replaceAll('-', '')}` } : {}), ...extra };
  const r = await checked(await db.rpc('place_order', { p_order: order, p_lines: lines }));
  txs.push(r.transaction_id);
  return checked(await db.from('payment_transactions').select('*').eq('id', r.transaction_id).single());
}
async function complete(tx: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return db.rpc('process_stripe_payment_completion_with_bump', { session_id_param: tx.session_id, product_id_param: tx.product_id, customer_email_param: tx.customer_email, amount_total: tx.amount, currency_param: tx.currency, ...extra });
}
describe('shared completion tail', () => {
  it('records the transaction reference for a legacy guest while preserving its result', async () => {
    const session = `cs_${crypto.randomUUID().replaceAll('-', '')}`;
    const r = await complete({ session_id: session, product_id: products[0], customer_email: email, amount: 10000, currency: 'PLN' });
    expect(r.error).toBeNull(); expect(r.data).toMatchObject({ success: true, scenario: 'guest_purchase_new_user_with_bump', access_granted: false, is_guest_purchase: true, send_magic_link: true, customer_email: email });
    txs.push(r.data.transaction_id);
    const gp = await checked(await db.from('guest_purchases').select('transaction_id').eq('session_id', session).single());
    expect(gp.transaction_id).toBe(r.data.transaction_id);
  });
  it('restricts the shared tail to service callers', async () => {
    const r = await anon.rpc('_order_grant_and_record', { p_transaction_id: crypto.randomUUID(), p_user_id: null, p_existing_user_id: null, p_requested_user_id: null, p_coupon_id: null, p_coupon_mode: 'none' });
    expect(r.error?.code).toBe('42501');
  });
});
describe('saved pricing completion', () => {
  it.each([1, 5])('completes a net set-price snapshot for quantity %i with exact basis', async (quantity) => {
    const cid = (await checked(await db.from('coupons').insert({ code: `NET_${crypto.randomUUID()}`, discount_type: 'set_price', discount_value: 30, currency: 'PLN' }).select('id').single())).id;
    coupons.push(cid);
    await checked(await db.from('coupon_reservations').insert({ coupon_id: cid, customer_email: email, expires_at: '2099-01-01T00:00:00Z' }));
    const tx = await place('stripe', { coupon_id: cid }, [line({ quantity, total_price: 100 * quantity, discounted_total: 30 * quantity, tax_behavior: 'exclusive', vat_rate: 23 })]);
    expect(Number(tx.amount)).toBe(3690 * quantity);
    expect((await complete(tx, { coupon_id_param: cid, amount_subtotal_param: 3000 * quantity - 1 })).data).toMatchObject({ success: false, error: 'Saved order amount does not match' });
    expect((await complete(tx, { coupon_id_param: cid, amount_subtotal_param: 3000 * quantity })).data).toMatchObject({ success: true, pricing_source: 'snapshot' });
  });

  it('accepts exact saved price after a sale ends and counts quantity once', async () => {
    await checked(await db.from('products').update({ sale_price: 80, sale_price_until: '2099-01-01T00:00:00Z', sale_quantity_sold: 0 }).eq('id', products[0]));
    const tx = await place();
    await checked(await db.from('products').update({ sale_price_until: '2000-01-01T00:00:00Z' }).eq('id', products[0]));
    const before = await checked(await db.from('payment_line_items').select('*').eq('transaction_id', tx.id));
    for (let i = 0; i < 2; i++) {
      const r = await complete(tx); expect(r.error).toBeNull(); expect(r.data).toMatchObject({ success: true, pricing_source: 'snapshot' });
    }
    expect(await checked(await db.from('payment_line_items').select('*').eq('transaction_id', tx.id))).toEqual(before);
    expect((await checked(await db.from('products').select('sale_quantity_sold').eq('id', products[0]).single())).sale_quantity_sold).toBe(2);
  });
  it.each([-1, 1])('rejects a difference of %i minor unit without changing the order', async difference => {
    const tx = await place(); const r = await complete(tx, { amount_total: tx.amount + difference });
    expect(r.data).toMatchObject({ success: false, error_kind: 'data' });
    expect((await checked(await db.from('payment_transactions').select('status,amount').eq('id', tx.id).single()))).toMatchObject({ status: 'pending', amount: tx.amount });
  });
  it('uses saved bumps and duration after disabling the offer', async () => {
    const tx = await place('stripe', {}, [line(), line({ product_id: products[1], item_type: 'order_bump', order_bump_id: bump, quantity: 1, unit_price: 20, total_price: 20, discounted_total: 18, access_duration_override: 7 })]);
    await checked(await db.from('order_bumps').update({ is_active: false }).eq('id', bump));
    try {
      const r = await complete(tx, { bump_product_ids_param: [products[1]] });
      expect(r.error).toBeNull(); expect(r.data).toMatchObject({ success: true, pricing_source: 'snapshot' });
    } finally { await checked(await db.from('order_bumps').update({ is_active: true }).eq('id', bump)); }
  });
  it('rejects a bump outside the saved lines', async () => {
    const tx = await place(); expect((await complete(tx, { bump_product_ids_param: [products[2]] })).data).toMatchObject({ success: false, error_kind: 'data' });
  });
  it('rejects a different coupon and product binding', async () => {
    const tx = await place();
    expect((await complete(tx, { coupon_id_param: crypto.randomUUID() })).data).toMatchObject({ success: false, error_kind: 'data' });
    await checked(await db.from('payment_line_items').update({ product_id: products[2] }).eq('transaction_id', tx.id));
    expect((await complete(tx)).data).toMatchObject({ success: false, error_kind: 'data' });
  });
  it('checks the saved net basis for exclusive pricing', async () => {
    const tx = await place('stripe', {}, [line({ tax_behavior: 'exclusive', vat_rate: 23 })]);
    expect((await complete(tx, { amount_subtotal_param: 16001 })).data).toMatchObject({ success: false, error_kind: 'data' });
    const r = await complete(tx, { amount_subtotal_param: 16000 });
    expect(r.error).toBeNull(); expect(r.data).toMatchObject({ success: true, pricing_source: 'snapshot' });
  });
  it('consumes the saved Stripe coupon reservation once', async () => {
    const cid = (await checked(await db.from('coupons').insert({ code: `SNAP_${crypto.randomUUID()}`, discount_type: 'percentage', discount_value: 20 }).select('id').single())).id; coupons.push(cid);
    await checked(await db.from('coupon_reservations').insert({ coupon_id: cid, customer_email: email, expires_at: '2099-01-01T00:00:00Z' }));
    const tx = await place('stripe', { coupon_id: cid });
    for (let i = 0; i < 2; i++) expect((await complete(tx, { coupon_id_param: cid })).data).toMatchObject({ success: true });
    expect((await checked(await db.from('coupons').select('current_usage_count').eq('id', cid).single())).current_usage_count).toBe(1);
  });
  it('marks rows without a snapshot as legacy', async () => {
    const r = await complete({ session_id: `cs_${crypto.randomUUID().replaceAll('-', '')}`, product_id: products[0], customer_email: email, amount: 10000, currency: 'PLN' });
    expect(r.error).toBeNull(); expect(r.data).toMatchObject({ success: true, pricing_source: 'legacy' }); txs.push(r.data.transaction_id);
  });
  it('rejects transfer-shaped calls to Stripe completion', async () => {
    const tx = await place('bank_transfer'); const r = await complete(tx);
    expect(r.data).toMatchObject({ success: false, error_kind: 'data' });
  });
});
describe('offline completion and claiming', () => {
  it.each(['set_price', 'fixed'])('completes a net %s coupon with five units and an unchanged bump', async (discountType) => {
    const cid = (await checked(await db.from('coupons').insert({ code: `OFF_NET_${crypto.randomUUID()}`, discount_type: discountType, discount_value: discountType === 'set_price' ? 30 : 350, currency: 'PLN', exclude_order_bumps: true }).select('id').single())).id;
    coupons.push(cid);
    await checked(await db.from('coupon_reservations').insert({ coupon_id: cid, customer_email: email, expires_at: '2099-01-01T00:00:00Z' }));
    const tx = await place('bank_transfer', { coupon_id: cid }, [
      line({ quantity: 5, total_price: 500, discounted_total: 150, tax_behavior: 'exclusive', vat_rate: 23 }),
      line({ product_id: products[1], item_type: 'order_bump', order_bump_id: bump, quantity: 1, unit_price: 20, total_price: 20, discounted_total: 20, vat_exempt: true }),
    ]);
    expect(Number(tx.amount)).toBe(20450);
    expect(Number(tx.net_total)).toBe(17000);
    expect(Number(tx.tax_total)).toBe(3450);
    expect((await offline(tx, 20449)).data).toMatchObject({ success: false });
    for (let i = 0; i < 2; i++) expect((await offline(tx)).data).toMatchObject({ success: true });
    expect(await checked(await db.from('coupon_redemptions').select('id').eq('transaction_id', tx.id))).toHaveLength(1);
  });

  async function offline(tx: Record<string, unknown>, paid = tx.amount) {
    return db.rpc('complete_offline_order', { p_transaction_id: tx.id, p_paid_minor: paid });
  }
  async function user(address: string) {
    const r = await checked(await db.auth.admin.createUser({ email: address, email_confirm: true })); users.push(r.user.id); return r.user.id;
  }
  it('grants a bundle and saved bump, consumes no second coupon and completes once', async () => {
    const uid = await user(`offline-${crypto.randomUUID()}@example.com`);
    await checked(await db.from('products').update({ is_bundle: true, sale_price: 80, sale_quantity_sold: 0 }).eq('id', products[0]));
    await checked(await db.from('bundle_items').insert({ bundle_product_id: products[0], component_product_id: products[2] }));
    const cid = (await checked(await db.from('coupons').insert({ code: `OFF_${crypto.randomUUID()}`, discount_type: 'percentage', discount_value: 20 }).select('id').single())).id; coupons.push(cid);
    await checked(await db.from('coupon_reservations').insert({ coupon_id: cid, customer_email: email, expires_at: '2099-01-01T00:00:00Z' }));
    try {
      const tx = await place('bank_transfer', { user_id: uid, coupon_id: cid }, [line(), line({ product_id: products[1], item_type: 'order_bump', order_bump_id: bump, quantity: 1, unit_price: 20, total_price: 20, discounted_total: 16, access_duration_override: 7 })]);
      for (let i = 0; i < 2; i++) {
        const r = await offline(tx); expect(r.error).toBeNull(); expect(r.data).toMatchObject({ success: true, transaction_id: tx.id });
      }
      const access = await checked(await db.from('user_product_access').select('product_id,access_expires_at').eq('user_id', uid));
      expect(access.map(r => r.product_id).sort()).toEqual([...products].sort());
      expect(access.find(r => r.product_id === products[1])!.access_expires_at).not.toBeNull();
      expect((await checked(await db.from('coupons').select('current_usage_count').eq('id', cid).single())).current_usage_count).toBe(1);
      expect(await checked(await db.from('coupon_redemptions').select('id').eq('transaction_id', tx.id))).toHaveLength(1);
      expect((await checked(await db.from('products').select('sale_quantity_sold').eq('id', products[0]).single())).sale_quantity_sold).toBe(2);
    } finally {
      await checked(await db.from('bundle_items').delete().eq('bundle_product_id', products[0]));
      await checked(await db.from('products').update({ is_bundle: false }).eq('id', products[0]));
    }
  });
  it('records a guest by transaction and grants main and bump after confirmed registration', async () => {
    const address = `offline-guest-${crypto.randomUUID()}@example.com`;
    const tx = await place('bank_transfer', { customer_email: address }, [line(), line({ product_id: products[1], item_type: 'order_bump', order_bump_id: bump, quantity: 1, unit_price: 20, total_price: 20, discounted_total: 16 })]);
    const r = await offline(tx); expect(r.error).toBeNull(); expect(r.data.success).toBe(true);
    expect(await checked(await db.from('guest_purchases').select('transaction_id,session_id,claimed_by_user_id').eq('transaction_id', tx.id).single())).toMatchObject({ transaction_id: tx.id, session_id: null, claimed_by_user_id: null });
    const uid = await user(address);
    expect(await checked(await db.from('user_product_access').select('product_id').eq('user_id', uid))).toHaveLength(2);
    expect((await checked(await db.from('guest_purchases').select('claimed_by_user_id').eq('transaction_id', tx.id).single())).claimed_by_user_id).toBe(uid);
    expect((await checked(await db.from('payment_transactions').select('user_id').eq('id', tx.id).single())).user_id).toBe(uid);
  });
  it('rejects Stripe, cancelled, missing orders and amounts different from the saved charge', async () => {
    const stripe = await place(); expect((await offline(stripe)).data).toMatchObject({ success: false, error_kind: 'data' });
    const tx = await place('bank_transfer');
    for (const amount of [tx.amount - 1, tx.amount + 1, null]) expect((await offline(tx, amount)).data).toMatchObject({ success: false, error_kind: 'data' });
    await checked(await db.rpc('cancel_unpaid_order', { p_transaction_id: tx.id, p_reason: 'Test' }));
    expect((await offline(tx)).data).toMatchObject({ success: false, error_kind: 'data' });
    expect((await offline({ id: crypto.randomUUID(), amount: 1 })).data).toMatchObject({ success: false, error_kind: 'data' });
  });
  it('restricts completion helpers and claiming to service callers', async () => {
    const address = `order-role-${crypto.randomUUID()}@example.com`;
    const password = 'Order-role-test-123!';
    const u = await checked(await db.auth.admin.createUser({ email: address, password, email_confirm: true })); users.push(u.user.id);
    const signedIn = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    await checked(await signedIn.auth.signInWithPassword({ email: address, password }));
    for (const client of [anon, signedIn]) {
      expect((await client.rpc('complete_offline_order', { p_transaction_id: crypto.randomUUID(), p_paid_minor: 1 })).error?.code).toBe('42501');
      expect((await client.rpc('claim_guest_purchases_for_user', { p_user_id: u.user.id })).error?.code).toBe('42501');
      expect((await client.rpc('increment_sale_quantity_sold', { p_product_id: products[0], p_quantity: 2 })).error?.code).toBe('42501');
      expect((await client.rpc('_order_grant_and_record', { p_transaction_id: crypto.randomUUID(), p_user_id: null, p_existing_user_id: null, p_requested_user_id: null, p_coupon_id: null, p_coupon_mode: 'none' })).error?.code).toBe('42501');
    }
  });
});


describe('profile completeness on completion', () => {
  it.each([false, true])('completes normally and marks missing required details (%s)', async completeDetails => {
    const profile = { v: 1, modules: [{ id: 'buyer', types: ['person'], gus: false }, { id: 'phone', required: true }, { id: 'quantity', mode: 'checkout', min: 1, max: 5 }, { id: 'participants', required: true, prefill_from_buyer: true }] };
    await checked(await db.from('products').update({ checkout_profile: profile }).eq('id', products[0]));
    try {
      const details = completeDetails ? { buyer: { v: 1, type: 'person', first_name: 'Jan', last_name: 'Nowak', email }, phone: { v: 1, value: '+48500100200' }, quantity: { v: 1, value: 2 }, participants: { v: 1, people: [{ first_name: 'Jan', last_name: 'Nowak', email }, { first_name: 'Anna', last_name: 'Nowak', email: 'anna@example.com' }] } } : {};
      const tx = await place('stripe', { order_details: details });
      expect((await complete(tx)).data).toMatchObject({ success: true });
      const saved = await checked(await db.from('payment_transactions').select('status,order_details').eq('id', tx.id).single());
      expect(saved.status).toBe('completed');
      expect(saved.order_details.details_missing).toBe(completeDetails ? undefined : true);
    } finally { await checked(await db.from('products').update({ checkout_profile: null }).eq('id', products[0])); }
  });
});
