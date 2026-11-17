/**
 * Cart change on an open Stripe checkout: the saved order snapshot is replaced in place,
 * so the webhook validates the payment against the new cart (W219).
 * @see supabase/migrations/20261117120000_replace_pending_order.sql
 * @see src/app/api/create-payment-intent/route.ts
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const products: string[] = []; const txs: string[] = []; const coupons: string[] = [];
let bump: string;
const email = `replace-${crypto.randomUUID()}@example.com`;

async function checked<T>(r: { data: T; error: unknown }): Promise<NonNullable<T>> {
  if (r.error) throw r.error; return r.data!;
}
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const slug = `replace-${crypto.randomUUID()}`;
    products.push((await checked(await db.from('products').insert({ name: slug, slug, price: 100, currency: 'PLN', is_active: true, price_includes_vat: true }).select('id').single())).id);
  }
  bump = (await checked(await db.from('order_bumps').insert({ main_product_id: products[0], bump_product_id: products[1], bump_title: 'Extra', bump_price: 20 }).select('id').single())).id;
});
afterAll(async () => {
  await db.from('guest_purchases').delete().in('transaction_id', txs);
  await db.from('coupon_reservations').delete().in('coupon_id', coupons);
  await db.from('payment_transactions').delete().in('id', txs);
  await db.from('coupons').delete().in('id', coupons);
  await db.from('order_bumps').delete().eq('id', bump);
  await db.from('products').delete().in('id', products);
});

function main(quantity: number, discounted = 100 * quantity) {
  return { product_id: products[0], item_type: 'main_product', quantity, unit_price: 100, total_price: 100 * quantity, discounted_total: discounted, currency: 'PLN', product_name: 'Main', tax_behavior: 'inclusive', vat_rate: 23 };
}
const extra = (orderBumpId: string) => ({ product_id: products[1], item_type: 'order_bump', order_bump_id: orderBumpId, quantity: 1, unit_price: 20, total_price: 20, discounted_total: 20, currency: 'PLN', product_name: 'Extra', tax_behavior: 'inclusive', vat_rate: 23 });

async function place(lines: Record<string, unknown>[] = [main(1)]) {
  const order = { payment_provider: 'stripe', product_id: products[0], customer_email: email, currency: 'PLN', session_id: `cs_test_${crypto.randomUUID().replaceAll('-', '')}`, metadata: { first: 'kept', coupon_id: '' } };
  const r = await checked(await db.rpc('place_order', { p_order: order, p_lines: lines }));
  txs.push(r.transaction_id);
  return { order, id: r.transaction_id as string };
}
const replace = (order: Record<string, unknown>, lines: Record<string, unknown>[]) => db.rpc('replace_pending_order', { p_order: order, p_lines: lines });
const savedLines = (id: string) => db.from('payment_line_items').select('item_type,product_id,quantity,discounted_total').eq('transaction_id', id).order('item_type');
const complete = (order: Record<string, unknown>, amount: number, extraArgs: Record<string, unknown> = {}) => db.rpc('process_stripe_payment_completion_with_bump', {
  session_id_param: order.session_id, product_id_param: products[0], customer_email_param: email, amount_total: amount, currency_param: 'PLN', ...extraArgs,
});

describe('replace_pending_order', () => {
  it('replaces quantity, bumps and amount of a pending order, and completion follows the new cart', async () => {
    const { order, id } = await place();
    const r = await replace({ ...order, metadata: { coupon_id: '', bump_product_ids_full: [products[1]] } }, [main(3), extra(bump)]);
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ success: true, transaction_id: id, amount: 32000 });
    expect(await checked(await savedLines(id))).toEqual([
      { item_type: 'main_product', product_id: products[0], quantity: 3, discounted_total: 300 },
      { item_type: 'order_bump', product_id: products[1], quantity: 1, discounted_total: 20 },
    ]);
    const tx = await checked(await db.from('payment_transactions').select('id,status,amount,metadata').eq('id', id).single());
    expect(tx).toMatchObject({ status: 'pending', amount: 32000, metadata: { first: 'kept', bump_product_ids_full: [products[1]] } });
    expect((await complete(order, 10000)).data).toMatchObject({ success: false, error: 'Saved order amount does not match' });
    expect((await complete(order, 32000, { bump_product_ids_param: [products[1]] })).data).toMatchObject({ success: true, pricing_source: 'snapshot' });
  });

  it('moves the coupon onto the saved order so completion requires it', async () => {
    const cid = (await checked(await db.from('coupons').insert({ code: `HALF_${crypto.randomUUID()}`, discount_type: 'percentage', discount_value: 50 }).select('id').single())).id;
    coupons.push(cid);
    await checked(await db.from('coupon_reservations').insert({ coupon_id: cid, customer_email: email, expires_at: '2099-01-01T00:00:00Z' }));
    const { order, id } = await place([main(2)]);
    expect((await replace({ ...order, coupon_id: cid }, [main(2, 100)])).data).toMatchObject({ success: true, amount: 10000 });
    expect((await checked(await db.from('payment_transactions').select('coupon_id').eq('id', id).single())).coupon_id).toBe(cid);
    expect((await complete(order, 10000)).data).toMatchObject({ success: false, error: 'Saved order details do not match' });
    expect((await complete(order, 10000, { coupon_id_param: cid })).data).toMatchObject({ success: true });
  });

  it('keeps the previous snapshot when the new lines are invalid', async () => {
    const { order, id } = await place([main(2)]);
    const r = await replace(order, [extra(crypto.randomUUID()), main(1)]);
    expect(r.error?.message).toBe('Invalid order line binding');
    expect(await checked(await savedLines(id))).toEqual([{ item_type: 'main_product', product_id: products[0], quantity: 2, discounted_total: 200 }]);
  });

  it.each([
    ['a paid order', async (order: Record<string, unknown>) => { await complete(order, 10000); return order; }],
    ['another product', async (order: Record<string, unknown>) => ({ ...order, product_id: products[1] })],
    ['another buyer', async (order: Record<string, unknown>) => ({ ...order, customer_email: 'someone@example.com' })],
    ['an unknown session', async (order: Record<string, unknown>) => ({ ...order, session_id: 'cs_test_missing' })],
  ])('refuses to replace %s', async (_label, arrange) => {
    const { order, id } = await place();
    const target = await arrange(order);
    expect((await replace(target, [main(4)])).data).toMatchObject({ success: false, error: 'order_not_replaceable' });
    expect((await checked(await savedLines(id)))[0]).toMatchObject({ quantity: 1 });
  });

  it('is available only to the service role', async () => {
    const { order } = await place();
    expect((await anon.rpc('replace_pending_order', { p_order: order, p_lines: [main(2)] })).error?.code).toBe('42501');
  });
});
