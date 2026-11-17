/**
 * A full refund of a bundle order ends every entitlement that order granted, including the bundle's
 * components, and keeps components the buyer holds from another source. Real local database; the
 * refund runs through the shared revocation service used by every refund path.
 * @see src/lib/services/access-revocation.ts
 */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import { deleteAuthUsers, deleteBundleItemsFor } from '../../helpers/db-cleanup';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const productIds: string[] = [];
const userIds: string[] = [];

async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<T> {
  if (error) throw error;
  return data;
}

async function product(name: string, over: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const row = await checked(await db.from('products').insert({ name, slug: `${name}-${id}`, price: 40, currency: 'PLN', ...over }).select('id').single());
  productIds.push(row!.id);
  return row!.id;
}

async function bundleOf(components: string[]): Promise<string> {
  const bundle = await product('bundle', { is_bundle: true });
  await checked(await db.from('bundle_items').insert(components.map((component, i) => ({ bundle_product_id: bundle, component_product_id: component, display_order: i }))));
  return bundle;
}

async function user(): Promise<{ id: string; email: string }> {
  const email = `bundle-refund-${randomUUID()}@example.com`;
  const created = await checked(await db.auth.admin.createUser({ email, email_confirm: true }));
  userIds.push(created.user!.id);
  return { id: created.user!.id, email };
}

/** Completed order for `productId`, granted the way checkout completion grants a signed-in buyer. */
async function paidOrder(buyer: { id: string; email: string }, productId: string): Promise<{ id: string; session_id: string }> {
  const sessionId = `cs_${randomUUID().replaceAll('-', '')}`;
  const tx = await checked(await db.from('payment_transactions').insert({
    product_id: productId, customer_email: buyer.email, user_id: buyer.id, amount: 4000, currency: 'PLN',
    status: 'completed', payment_provider: 'stripe', session_id: sessionId,
  }).select('id,session_id').single());
  await checked(await db.rpc('grant_product_and_bundle_components', { user_id_param: buyer.id, product_id_param: productId }));
  return tx!;
}

async function fullRefund(tx: { id: string; session_id: string }, buyerId: string, productId: string) {
  await checked(await db.from('payment_transactions').update({ status: 'refunded', refunded_amount: 4000 }).eq('id', tx.id));
  return revokeTransactionAccess(db, { transactionId: tx.id, userId: buyerId, productId, sessionId: tx.session_id });
}

async function accessTo(userId: string, ids: string[]): Promise<string[]> {
  const rows = await checked(await db.from('user_product_access').select('product_id').eq('user_id', userId).in('product_id', ids));
  return rows!.map(r => r.product_id).sort();
}

afterAll(async () => {
  await db.from('payment_transactions').delete().in('product_id', productIds);
  await db.from('guest_purchases').delete().in('product_id', productIds);
  await db.from('user_product_access').delete().in('product_id', productIds);
  await deleteBundleItemsFor(db, productIds);
  await db.from('products').delete().in('id', productIds);
  await deleteAuthUsers(db, userIds);
});

describe('full refund of a bundle order @J34', () => {
  it('ends access to the bundle and to every component the order granted @J34', async () => {
    const [one, two] = [await product('comp-one'), await product('comp-two')];
    const bundle = await bundleOf([one, two]);
    const buyer = await user();
    const tx = await paidOrder(buyer, bundle);
    expect(await accessTo(buyer.id, [bundle, one, two])).toEqual([bundle, one, two].sort());

    const result = await fullRefund(tx, buyer.id, bundle);
    expect(result.success).toBe(true);
    expect(await accessTo(buyer.id, [bundle, one, two])).toEqual([]);
  });

  it('keeps a component the buyer bought separately @J34', async () => {
    const [own, other] = [await product('comp-own'), await product('comp-other')];
    const bundle = await bundleOf([own, other]);
    const buyer = await user();
    await paidOrder(buyer, own);
    const tx = await paidOrder(buyer, bundle);

    await fullRefund(tx, buyer.id, bundle);
    expect(await accessTo(buyer.id, [bundle, own, other])).toEqual([own]);
  });

  it('keeps a component another still-paid bundle order granted @J34', async () => {
    const [shared, onlyFirst] = [await product('comp-shared'), await product('comp-first')];
    const first = await bundleOf([shared, onlyFirst]);
    const second = await bundleOf([shared]);
    const buyer = await user();
    const refunded = await paidOrder(buyer, first);
    await paidOrder(buyer, second);

    await fullRefund(refunded, buyer.id, first);
    expect(await accessTo(buyer.id, [first, second, shared, onlyFirst])).toEqual([second, shared].sort());
  });

  it('ends component access for a guest buyer who claimed the order after signing up @J34', async () => {
    const [one, two] = [await product('guest-one'), await product('guest-two')];
    const bundle = await bundleOf([one, two]);
    const email = `bundle-guest-${randomUUID()}@example.com`;
    const sessionId = `cs_${randomUUID().replaceAll('-', '')}`;
    const tx = await checked(await db.from('payment_transactions').insert({
      product_id: bundle, customer_email: email, amount: 4000, currency: 'PLN', status: 'completed', payment_provider: 'stripe', session_id: sessionId,
    }).select('id,session_id').single());
    await checked(await db.from('guest_purchases').insert({ product_id: bundle, customer_email: email, transaction_amount: 4000, transaction_id: tx!.id, session_id: sessionId }));
    const created = await checked(await db.auth.admin.createUser({ email, email_confirm: true }));
    userIds.push(created.user!.id);
    await checked(await db.rpc('claim_guest_purchases_for_user', { p_user_id: created.user!.id }));
    expect(await accessTo(created.user!.id, [bundle, one, two])).toEqual([bundle, one, two].sort());

    await fullRefund(tx!, created.user!.id, bundle);
    expect(await accessTo(created.user!.id, [bundle, one, two])).toEqual([]);
  });

  it('ends the components the order granted even after the bundle was re-composed @J34', async () => {
    const [kept, removed, added] = [await product('comp-kept'), await product('comp-removed'), await product('comp-added')];
    const bundle = await bundleOf([kept, removed]);
    const buyer = await user();
    const tx = await paidOrder(buyer, bundle);
    await checked(await db.from('bundle_items').delete().eq('bundle_product_id', bundle).eq('component_product_id', removed));
    await checked(await db.from('bundle_items').insert({ bundle_product_id: bundle, component_product_id: added, display_order: 5 }));

    await fullRefund(tx, buyer.id, bundle);
    expect(await accessTo(buyer.id, [bundle, kept, removed, added])).toEqual([]);
  });
});
