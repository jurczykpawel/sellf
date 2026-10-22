/** Placement and cancellation use the real service-role order RPCs. */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL!;
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const products: string[] = []; const txs: string[] = []; const coupons: string[] = [];
let bumpId: string; let userId: string; let signedIn: SupabaseClient;
const email = `order-${crypto.randomUUID()}@example.com`;
async function checked<T>(result: { data: T; error: unknown }): Promise<NonNullable<T>> {
  if (result.error) throw result.error; return result.data!;
}
beforeAll(async () => {
  for (const currency of ['PLN', 'PLN', 'PLN', 'EUR', 'JPY']) {
    const slug = `place-${crypto.randomUUID()}`;
    products.push((await checked(await db.from('products').insert({ name: slug, slug, price: 100, currency, is_active: true }).select('id').single())).id);
  }
  bumpId = (await checked(await db.from('order_bumps').insert({ main_product_id: products[0], bump_product_id: products[1], bump_title: 'Extra' }).select('id').single())).id;
  userId = (await checked(await db.auth.admin.createUser({ email, password: 'Order-test-password-123!', email_confirm: true }))).user.id;
  signedIn = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await checked(await signedIn.auth.signInWithPassword({ email, password: 'Order-test-password-123!' }));
});
afterAll(async () => {
  await db.from('coupon_redemptions').delete().in('coupon_id', coupons);
  await db.from('coupon_reservations').delete().in('coupon_id', coupons);
  await db.from('payment_transactions').delete().in('id', txs);
  await db.from('coupons').delete().in('id', coupons);
  await db.from('order_bumps').delete().eq('id', bumpId);
  await db.from('products').delete().in('id', products);
  if (userId) await db.auth.admin.deleteUser(userId);
});
function line(extra: Record<string, unknown> = {}) {
  return { product_id: products[0], item_type: 'main_product', quantity: 2, unit_price: 100, total_price: 200,
    discounted_total: 180, currency: 'PLN', product_name: 'Saved name', vat_rate: 23, tax_behavior: 'exclusive', vat_exempt: false, ...extra };
}
function order(extra: Record<string, unknown> = {}) {
  return { payment_provider: 'bank_transfer', product_id: products[0], customer_email: email, currency: 'PLN', ...extra };
}
async function place(p_order = order(), p_lines = [line()]) {
  const result = await db.rpc('place_order', { p_order, p_lines });
  if (result.data?.transaction_id) txs.push(result.data.transaction_id);
  return result;
}
async function coupon(limit = 10) {
  const id = (await checked(await db.from('coupons').insert({ code: `ORDER_${crypto.randomUUID()}`, discount_type: 'percentage', discount_value: 10, usage_limit_global: limit }).select('id').single())).id;
  coupons.push(id);
  await checked(await db.from('coupon_reservations').insert({ coupon_id: id, customer_email: email, expires_at: '2099-01-01T00:00:00Z' }));
  return id;
}
describe('place_order', () => {
  it('atomically stores order, list prices, discounted prices, local VAT and buyer details', async () => {
    const result = await place(order({ amount: 1, order_details: { buyer: { full_name: 'Buyer' } } }), [line(), line({ product_id: products[1], item_type: 'order_bump', order_bump_id: bumpId, quantity: 1, unit_price: 20, total_price: 20, discounted_total: 18, tax_behavior: 'inclusive', vat_rate: 8 })]);
    expect(result.error).toBeNull(); expect(result.data.success).toBe(true);
    const tx = await checked(await db.from('payment_transactions').select('*').eq('id', result.data.transaction_id).single());
    expect(tx).toMatchObject({ payment_provider: 'bank_transfer', status: 'awaiting_payment', pricing_snapshot_version: 1, amount: 23940, net_total: 19667, tax_total: 4273, tax_snapshot_status: 'local', order_details: { buyer: { full_name: 'Buyer' } } });
    const rows = await checked(await db.from('payment_line_items').select('*').eq('transaction_id', tx.id));
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.item_type === 'main_product')).toMatchObject({ quantity: 2, unit_price: 100, total_price: 200, discounted_total: 180, net_amount: 18000, tax_amount: 4140 });
  });
  it('places Stripe pending without redeeming a coupon', async () => {
    const id = await coupon();
    const r = await place(order({ payment_provider: 'stripe', session_id: `cs_${crypto.randomUUID().replaceAll('-', '')}`, coupon_id: id }));
    expect(r.error).toBeNull();
    expect((await checked(await db.from('payment_transactions').select('status,tax_snapshot_status').eq('id', r.data.transaction_id).single())).status).toBe('pending');
    expect((await checked(await db.from('coupons').select('current_usage_count').eq('id', id).single())).current_usage_count).toBe(0);
    expect(await checked(await db.from('coupon_reservations').select('id').eq('coupon_id', id))).toHaveLength(1);
  });
  const invalid = [
    ['wrong main product', () => [line({ product_id: products[2] })]],
    ['missing main', () => [line({ product_id: products[1], item_type: 'order_bump', order_bump_id: bumpId })]],
    ['two main lines', () => [line(), line({ product_id: products[2] })]],
    ['foreign bump', () => [line(), line({ product_id: products[2], item_type: 'order_bump', order_bump_id: bumpId, quantity: 1 })]],
    ['mixed currency', () => [line(), line({ product_id: products[3], item_type: 'order_bump', currency: 'EUR', quantity: 1 })]],
    ['line currency differs from product', () => [line({ currency: 'EUR' })]],
    ['bump quantity above one', () => [line(), line({ product_id: products[1], item_type: 'order_bump', order_bump_id: bumpId })]],
    ['negative discount total', () => [line({ discounted_total: -1 })]],
    ['missing discount total', () => [line({ discounted_total: null })]],
    ['fractional minor units', () => [line({ discounted_total: 10.001 })]],
    ['incorrect list total', () => [line({ total_price: 1 })]],
    ['unsupported item type', () => [line({ item_type: 'cart_item' })]],
    ['no lines', () => []],
  ] as const;
  it.each(invalid)('rejects %s without partial rows', async (_label, lines) => {
    const before = await checked(await db.from('payment_transactions').select('id').eq('customer_email', email));
    expect((await place(order(), lines())).error).not.toBeNull();
    expect(await checked(await db.from('payment_transactions').select('id').eq('customer_email', email))).toHaveLength(before.length);
  });
  it.each(['inclusive', 'exclusive', null])('computes JPY VAT and zero/exempt lines (%s)', async behavior => {
    const r = await place(order({ product_id: products[4], currency: 'JPY' }), [line({ product_id: products[4], currency: 'JPY', unit_price: 101, total_price: 202, discounted_total: 202, tax_behavior: behavior, vat_rate: behavior ? 10 : 0 })]);
    expect(r.error).toBeNull();
    const tx = await checked(await db.from('payment_transactions').select('amount,net_total,tax_total').eq('id', r.data.transaction_id).single());
    expect(tx).toMatchObject(behavior === 'exclusive' ? { amount: 222, net_total: 202, tax_total: 20 } : behavior === 'inclusive' ? { amount: 202, net_total: 184, tax_total: 18 } : { amount: 202, net_total: 202, tax_total: 0 });
  });
  it('redeems offline coupon and removes reservation', async () => {
    const id = await coupon(); const r = await place(order({ coupon_id: id }));
    expect(r.error).toBeNull();
    expect((await checked(await db.from('coupons').select('current_usage_count').eq('id', id).single())).current_usage_count).toBe(1);
    expect(await checked(await db.from('coupon_reservations').select('*').eq('coupon_id', id))).toHaveLength(0);
    const redemptions = await checked(await db.from('coupon_redemptions').select('*').eq('transaction_id', r.data.transaction_id));
    expect(redemptions).toHaveLength(1); expect(redemptions[0]).toMatchObject({ coupon_id: id, user_id: userId, discount_amount: 0 });
  });
  it('rolls back the whole order and reservation when the coupon limit is reached', async () => {
    const id = await coupon(0);
    expect((await place(order({ coupon_id: id }))).error).not.toBeNull();
    expect(await checked(await db.from('coupon_reservations').select('id').eq('coupon_id', id))).toHaveLength(1);
    expect(await checked(await db.from('payment_transactions').select('id').eq('coupon_id', id))).toHaveLength(0);
  });
  it('rejects offline coupon without a valid reservation', async () => {
    const id = await coupon(); await checked(await db.from('coupon_reservations').delete().eq('coupon_id', id));
    expect((await place(order({ coupon_id: id }))).error).not.toBeNull();
  });
  it('cancels once, returns the coupon and records the reason', async () => {
    const id = await coupon(); const r = await place(order({ coupon_id: id })); expect(r.error).toBeNull();
    for (let i = 0; i < 2; i++) expect((await db.rpc('cancel_unpaid_order', { p_transaction_id: r.data.transaction_id, p_reason: 'Buyer request' })).error).toBeNull();
    expect((await checked(await db.from('coupons').select('current_usage_count').eq('id', id).single())).current_usage_count).toBe(0);
    expect(await checked(await db.from('coupon_redemptions').select('id').eq('transaction_id', r.data.transaction_id))).toHaveLength(0);
    expect((await checked(await db.from('payment_transactions').select('status').eq('id', r.data.transaction_id).single())).status).toBe('cancelled');
    const logs = await checked(await db.from('admin_actions').select('*').eq('target_id', r.data.transaction_id).eq('action', 'cancel_unpaid_order'));
    expect(logs).toHaveLength(1); expect(logs[0].details).toMatchObject({ reason: 'Buyer request', coupon_id: id });
  });
  it('rejects cancellation of Stripe and completed transfers', async () => {
    const stripe = await place(order({ payment_provider: 'stripe', session_id: `cs_${crypto.randomUUID().replaceAll('-', '')}` }));
    expect(stripe.error).toBeNull();
    expect((await db.rpc('cancel_unpaid_order', { p_transaction_id: stripe.data.transaction_id, p_reason: 'Test' })).error).not.toBeNull();
    const paid = await place(); expect(paid.error).toBeNull();
    await checked(await db.from('payment_transactions').update({ status: 'completed' }).eq('id', paid.data.transaction_id));
    expect((await db.rpc('cancel_unpaid_order', { p_transaction_id: paid.data.transaction_id, p_reason: 'Test' })).error).not.toBeNull();
  });
  it('denies all three RPCs to anon and authenticated clients', async () => {
    for (const client of [anon, signedIn]) {
      for (const [name, args] of [
        ['place_order', { p_order: order(), p_lines: [line()] }],
        ['cancel_unpaid_order', { p_transaction_id: crypto.randomUUID(), p_reason: 'Test' }],
        ['_redeem_coupon_for_order', { coupon_id_param: crypto.randomUUID(), current_user_id: null, existing_user_id: null, customer_email_param: email, transaction_id_var: crypto.randomUUID() }],
      ] as const) expect((await client.rpc(name, args)).error?.code).toBe('42501');
    }
  });
});
