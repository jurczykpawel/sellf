/** Completion contract exercised through the local order RPCs. */
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
