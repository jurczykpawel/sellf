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
describe('saved pricing completion', () => {
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
