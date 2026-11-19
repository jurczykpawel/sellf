/** Repeat purchases keep access until their last entitlement ends. */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, expect, it } from 'vitest';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import { deleteBundleItemsFor, deleteAuthUsers } from '../../helpers/db-cleanup';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const products: string[] = [], users: string[] = [];
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<T> { if (error) throw error; return data; }
afterAll(async () => {
  await db.from('payment_transactions').delete().in('product_id', products);
  await deleteBundleItemsFor(db, products);
  await db.from('subscriptions').delete().in('user_id', users);
  await deleteAuthUsers(db, users);
  await db.from('products').delete().in('id', products);
});
it.each(['repeat', 'bank', 'bundle', 'subscription', 'bump'] as const)('keeps the original access with another %s source @J34', async source => {
  const email = `repeat-${randomUUID()}@example.com`;
  const buyer = (await checked(await db.auth.admin.createUser({ email, email_confirm: true }))).user!; users.push(buyer.id);
  async function product(bundle = false) {
    const p = await checked(await db.from('products').insert({ name: 'Repeat purchase', slug: `repeat-${randomUUID()}`, price: 40, currency: 'PLN', is_bundle: bundle, allow_repeat_purchase: true }).select('id').single());
    products.push(p!.id); return p!.id;
  }
  const p = await product();
  async function paid(productId: string, provider = 'stripe') {
    const t = await checked(await db.from('payment_transactions').insert({ product_id: productId, user_id: buyer.id, customer_email: email, amount: 4000, currency: 'PLN', status: 'completed', payment_provider: provider, session_id: provider === 'stripe' ? `cs_${randomUUID().replaceAll('-', '')}` : null, pricing_snapshot_version: 1 }).select('id,session_id').single());
    await checked(await db.rpc('grant_product_and_bundle_components', { user_id_param: buyer.id, product_id_param: productId, transaction_id_param: t!.id })); return t!;
  }
  const first = await paid(p);
  const original = await checked(await db.from('user_product_access').select('id').eq('user_id', buyer.id).eq('product_id', p).single());
  let other: { id: string; session_id: string | null } | undefined, otherProduct = p, subId: string | undefined;
  if (source === 'subscription') {
    const sub = await checked(await db.from('subscriptions').insert({ user_id: buyer.id, product_id: p, stripe_customer_id: `cus_${randomUUID()}`, stripe_subscription_id: `sub_${randomUUID()}`, status: 'active' }).select('id').single());
    subId = sub!.id;
    await checked(await db.from('user_product_access').update({ subscription_id: subId }).eq('id', original!.id));
  } else {
    if (source === 'bundle' || source === 'bump') {
      otherProduct = await product(source === 'bundle');
      if (source === 'bundle') await checked(await db.from('bundle_items').insert({ bundle_product_id: otherProduct, component_product_id: p }));
    }
    other = await paid(otherProduct, source === 'bank' ? 'bank_transfer' : 'stripe');
    if (source === 'bump') await checked(await db.from('payment_line_items').insert({ transaction_id: other.id, product_id: p, item_type: 'order_bump', quantity: 1, unit_price: 40, total_price: 40, currency: 'PLN' }));
  }
  async function refund(t: { id: string; session_id: string | null }, productId: string) {
    await checked(await db.from('payment_transactions').update({ status: 'refunded', refunded_amount: 4000 }).eq('id', t.id));
    const r = await revokeTransactionAccess(db, { transactionId: t.id, userId: buyer.id, productId, sessionId: t.session_id }); expect(r.success).toBe(true);
  }
  await refund(first, p);
  expect(await checked(await db.from('user_product_access').select('id').eq('user_id', buyer.id).eq('product_id', p))).toEqual([original]);
  if (other) {
    await refund(other, otherProduct);
    expect(await checked(await db.from('user_product_access').select('id').eq('user_id', buyer.id).eq('product_id', p))).toEqual([]);
  }
  if (subId) await checked(await db.from('subscriptions').delete().eq('id', subId));
});
