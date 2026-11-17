/**
 * Cart change on an open Stripe checkout (W219/W219b): every cart the session may carry is kept as a
 * numbered version until the order is paid, one update runs per session, and a payment settles
 * against the version Stripe charged — whatever the order of update, failure and payment.
 * @see supabase/migrations/20261118000000_release_2026_11_1.sql
 * @see src/app/api/create-payment-intent/route.ts
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const products: string[] = []; const txs: string[] = []; const coupons: string[] = [];
let bump: string;
const email = `versions-${crypto.randomUUID()}@example.com`;

async function checked<T>(r: { data: T; error: unknown }): Promise<NonNullable<T>> {
  if (r.error) throw r.error; return r.data!;
}
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const slug = `versions-${crypto.randomUUID()}`;
    products.push((await checked(await db.from('products').insert({ name: slug, slug, price: 100, currency: 'PLN', is_active: true, price_includes_vat: true }).select('id').single())).id);
  }
  bump = (await checked(await db.from('order_bumps').insert({ main_product_id: products[0], bump_product_id: products[1], bump_title: 'Extra', bump_price: 20 }).select('id').single())).id;
});
afterAll(async () => {
  await db.from('guest_purchases').delete().in('transaction_id', txs);
  await db.from('coupon_reservations').delete().in('coupon_id', coupons);
  await db.from('coupon_redemptions').delete().in('coupon_id', coupons);
  await db.from('payment_transactions').delete().in('id', txs);
  await db.from('coupons').delete().in('id', coupons);
  await db.from('order_bumps').delete().eq('id', bump);
  await db.from('products').delete().in('id', products);
});

function main(quantity: number, discounted = 100 * quantity) {
  return { product_id: products[0], item_type: 'main_product', quantity, unit_price: 100, total_price: 100 * quantity, discounted_total: discounted, currency: 'PLN', product_name: 'Main', tax_behavior: 'inclusive', vat_rate: 23 };
}
const extra = (orderBumpId: string) => ({ product_id: products[1], item_type: 'order_bump', order_bump_id: orderBumpId, quantity: 1, unit_price: 20, total_price: 20, discounted_total: 20, currency: 'PLN', product_name: 'Extra', tax_behavior: 'inclusive', vat_rate: 23 });

async function place(lines: Record<string, unknown>[] = [main(1)], coupon_id: string | null = null) {
  const order = { payment_provider: 'stripe', product_id: products[0], customer_email: email, currency: 'PLN', coupon_id, session_id: `cs_test_${crypto.randomUUID().replaceAll('-', '')}`, metadata: { first: 'kept', coupon_id: coupon_id ?? '' } };
  const r = await checked(await db.rpc('place_order', { p_order: order, p_lines: lines }));
  txs.push(r.transaction_id);
  return { order, id: r.transaction_id as string };
}
const begin = (order: Record<string, unknown>, lines: Record<string, unknown>[]) => db.rpc('begin_pending_order_update', { p_order: order, p_lines: lines });
const finish = (order: Record<string, unknown>, version: number, confirmed: boolean) =>
  db.rpc('finish_pending_order_update', { p_session_id: order.session_id as string, p_version: version, p_confirmed: confirmed });
const savedLines = (id: string) => db.from('payment_line_items').select('item_type,product_id,quantity,discounted_total').eq('transaction_id', id).order('item_type');
const saved = async (id: string) => checked(await db.from('payment_transactions').select('status,amount,coupon_id,metadata').eq('id', id).single());
const complete = (order: Record<string, unknown>, amount: number, extraArgs: Record<string, unknown> = {}) => db.rpc('process_stripe_payment_completion_with_bump', {
  session_id_param: order.session_id as string, product_id_param: products[0], customer_email_param: email, amount_total: amount, currency_param: 'PLN', ...extraArgs,
});
const newCart = (order: Record<string, unknown>, bumps: string[] = []) => ({ ...order, metadata: { coupon_id: '', bump_product_ids_full: bumps } });

describe('checkout cart versions', () => {
  it('stores the new cart as version 2 without touching the saved order until Stripe confirms it', async () => {
    const { order, id } = await place();
    expect((await begin(newCart(order, [products[1]]), [main(3), extra(bump)])).data).toMatchObject({ success: true, transaction_id: id, version: 2, amount: 32000 });
    expect(await checked(await savedLines(id))).toEqual([{ item_type: 'main_product', product_id: products[0], quantity: 1, discounted_total: 100 }]);
    const versions = await checked(await db.from('checkout_cart_versions').select('version,state,amount').eq('transaction_id', id).order('version'));
    expect(versions).toEqual([{ version: 1, state: 'placed', amount: 10000 }, { version: 2, state: 'updating', amount: 32000 }]);
    expect((await finish(order, 2, true)).data).toMatchObject({ success: true, version: 2 });
    expect(await checked(await savedLines(id))).toEqual([
      { item_type: 'main_product', product_id: products[0], quantity: 3, discounted_total: 300 },
      { item_type: 'order_bump', product_id: products[1], quantity: 1, discounted_total: 20 },
    ]);
    expect(await saved(id)).toMatchObject({ status: 'pending', amount: 32000, metadata: { first: 'kept', bump_product_ids_full: [products[1]] } });
    expect((await complete(order, 10000, { cart_version_param: 2 })).data).toMatchObject({ success: false, error: 'Saved order amount does not match' });
    expect((await complete(order, 32000, { cart_version_param: 2, bump_product_ids_param: [products[1]] })).data).toMatchObject({ success: true, pricing_source: 'snapshot' });
  });

  it.each([
    ['in flight', null],
    ['unconfirmed', false],
  ])('settles the old cart (no version in Stripe) while the update is %s', async (_label, confirmed) => {
    const { order, id } = await place();
    await checked(await begin(newCart(order), [main(2)]));
    if (confirmed !== null) await finish(order, 2, confirmed);
    expect((await complete(order, 10000)).data).toMatchObject({ success: true });
    expect(await saved(id)).toMatchObject({ status: 'completed', amount: 10000 });
    expect((await checked(await savedLines(id)))[0]).toMatchObject({ quantity: 1 });
  });

  it.each([
    ['in flight', null],
    ['unconfirmed', false],
  ])('settles the new cart Stripe charged while the update is %s', async (_label, confirmed) => {
    const { order, id } = await place();
    await checked(await begin(newCart(order), [main(2)]));
    if (confirmed !== null) await finish(order, 2, confirmed);
    expect((await complete(order, 20000, { cart_version_param: 2 })).data).toMatchObject({ success: true });
    expect(await saved(id)).toMatchObject({ status: 'completed', amount: 20000 });
    expect((await checked(await savedLines(id)))[0]).toMatchObject({ quantity: 2 });
    expect((await finish(order, 2, true)).data).toMatchObject({ success: false });
  });

  it('settles a version paid after its order was abandoned', async () => {
    const { order, id } = await place();
    await checked(await begin(newCart(order), [main(2)]));
    await finish(order, 2, false);
    await checked(await db.from('payment_transactions').update({ status: 'abandoned' }).eq('id', id));
    expect((await complete(order, 20000, { cart_version_param: 2 })).data).toMatchObject({ success: true });
    expect(await saved(id)).toMatchObject({ status: 'completed', amount: 20000 });
  });

  it('runs one update per session; a stale lock (no answer for 60 s) is taken over and its cart stays payable', async () => {
    const { order, id } = await place();
    await checked(await begin(newCart(order), [main(2)]));
    expect((await begin(newCart(order), [main(3)])).data).toMatchObject({ success: false, error: 'update_in_progress' });
    await checked(await db.from('checkout_cart_versions').update({ created_at: new Date(Date.now() - 61_000).toISOString() }).eq('transaction_id', id).eq('version', 2));
    expect((await begin(newCart(order), [main(3)])).data).toMatchObject({ success: true, version: 3 });
    expect((await finish(order, 2, true)).data).toMatchObject({ success: false, error: 'update_not_in_progress' });
    expect((await finish(order, 3, true)).data).toMatchObject({ success: true });
    expect((await begin(newCart(order), [main(4)])).data).toMatchObject({ success: true, version: 4 });
    expect((await complete(order, 20000, { cart_version_param: 2 })).data).toMatchObject({ success: true });
  });

  it('moves the coupon onto the saved order and releases the reservation of a coupon the confirmed cart dropped', async () => {
    const cid = (await checked(await db.from('coupons').insert({ code: `HALF_${crypto.randomUUID()}`, discount_type: 'percentage', discount_value: 50, usage_limit_global: 1 }).select('id').single())).id;
    coupons.push(cid);
    await checked(await db.from('coupon_reservations').insert({ coupon_id: cid, customer_email: email, expires_at: '2099-01-01T00:00:00Z' }));
    const reserved = async () => (await checked(await db.from('coupon_reservations').select('id').eq('coupon_id', cid))).length;
    const { order, id } = await place([main(2, 100)], cid);
    const withoutCoupon = { ...order, coupon_id: null };
    await checked(await begin(withoutCoupon, [main(2)]));
    await finish(order, 2, false);
    expect(await reserved()).toBe(1); // Stripe may still charge the cart with the coupon
    await checked(await begin(withoutCoupon, [main(2)]));
    await finish(order, 3, true);
    expect(await saved(id)).toMatchObject({ coupon_id: null, amount: 20000 });
    expect(await reserved()).toBe(0);
    await checked(await begin({ ...order, coupon_id: cid }, [main(2, 100)]));
    await finish(order, 4, true);
    expect((await saved(id)).coupon_id).toBe(cid);
    expect((await complete(order, 10000, { cart_version_param: 4 })).data).toMatchObject({ success: false, error: 'Saved order details do not match' });
    expect((await complete(order, 10000, { cart_version_param: 4, coupon_id_param: cid })).data).toMatchObject({ success: true });
  });

  it('keeps the saved order and stores nothing when the new lines are invalid', async () => {
    const { order, id } = await place([main(2)]);
    const r = await begin(order, [extra(crypto.randomUUID()), main(1)]);
    expect(r.error?.message).toBe('Invalid order line binding');
    expect(await checked(await savedLines(id))).toEqual([{ item_type: 'main_product', product_id: products[0], quantity: 2, discounted_total: 200 }]);
    expect(await checked(await db.from('checkout_cart_versions').select('version').eq('transaction_id', id))).toEqual([]);
  });

  it.each([
    ['a paid order', async (order: Record<string, unknown>) => { await complete(order, 10000); return order; }],
    ['another product', async (order: Record<string, unknown>) => ({ ...order, product_id: products[1] })],
    ['another buyer', async (order: Record<string, unknown>) => ({ ...order, customer_email: 'someone@example.com' })],
    ['an unknown session', async (order: Record<string, unknown>) => ({ ...order, session_id: 'cs_test_missing' })],
  ])('refuses to update %s', async (_label, arrange) => {
    const { order, id } = await place();
    const target = await arrange(order);
    expect((await begin(target, [main(4)])).data).toMatchObject({ success: false, error: 'order_not_replaceable' });
    expect((await checked(await savedLines(id)))[0]).toMatchObject({ quantity: 1 });
  });

  it('is available only to the service role', async () => {
    const { order } = await place();
    expect((await anon.rpc('begin_pending_order_update', { p_order: order, p_lines: [main(2)] })).error?.code).toBe('42501');
    expect((await anon.rpc('finish_pending_order_update', { p_session_id: order.session_id, p_version: 2, p_confirmed: true })).error?.code).toBe('42501');
    expect((await anon.from('checkout_cart_versions').select('version')).error?.code).toBe('42501');
  });
});
