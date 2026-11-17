/**
 * A full refund of a bundle order ends every entitlement that order granted, including the bundle's
 * components, and keeps components the buyer holds from another source. Real local database; the
 * refund runs through the shared revocation service used by every refund path.
 * @see src/lib/services/access-revocation.ts
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readMigrationSource } from '../../../scripts/migration-source';
import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { revokeTransactionAccess } from '@/lib/services/access-revocation';
import { deleteAuthUsers, deleteBundleItemsFor } from '../../helpers/db-cleanup';
import { getTestDatabaseContainer } from '../../helpers/database-container';

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

async function user(): Promise<{ id: string; email: string; password: string }> {
  const email = `bundle-refund-${randomUUID()}@example.com`;
  const password = `Bundle-${randomUUID()}!`;
  const created = await checked(await db.auth.admin.createUser({ email, password, email_confirm: true }));
  userIds.push(created.user!.id);
  return { id: created.user!.id, email, password };
}

/** Completed order for `productId`, granted the way checkout completion grants a signed-in buyer. */
async function paidOrder(buyer: { id: string; email: string }, productId: string): Promise<{ id: string; session_id: string }> {
  const sessionId = `cs_${randomUUID().replaceAll('-', '')}`;
  const tx = await checked(await db.from('payment_transactions').insert({
    product_id: productId, customer_email: buyer.email, user_id: buyer.id, amount: 4000, currency: 'PLN',
    status: 'completed', payment_provider: 'stripe', session_id: sessionId,
  }).select('id,session_id').single());
  await checked(await db.rpc('grant_product_and_bundle_components', { user_id_param: buyer.id, product_id_param: productId, transaction_id_param: tx!.id }));
  return tx!;
}

/** Unpaid bank-transfer order for `productId`; `accessOnPlacement` mirrors the shop setting at placement. */
async function unpaidTransfer(buyer: { id: string; email: string }, productId: string, accessOnPlacement = false): Promise<{ id: string; session_id: string | null }> {
  const tx = await checked(await db.from('payment_transactions').insert({
    product_id: productId, customer_email: buyer.email, user_id: buyer.id, amount: 4000, currency: 'PLN',
    status: 'awaiting_payment', payment_provider: 'bank_transfer', pricing_snapshot_version: 1,
    metadata: { access_on_placement: accessOnPlacement },
  }).select('id,session_id').single());
  return tx!;
}

async function recompose(bundle: string, remove: string, add: string) {
  await checked(await db.from('bundle_items').delete().eq('bundle_product_id', bundle).eq('component_product_id', remove));
  await checked(await db.from('bundle_items').insert({ bundle_product_id: bundle, component_product_id: add, display_order: 9 }));
}

async function fullRefund(tx: { id: string; session_id: string | null }, buyerId: string, productId: string) {
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

  it('grants and ends the same components when the bundle changes between placing and paying the order @J34', async () => {
    const [before, after] = [await product('comp-before'), await product('comp-after')];
    const bundle = await bundleOf([before]);
    const buyer = await user();
    const tx = await unpaidTransfer(buyer, bundle);
    await recompose(bundle, before, after);

    const paid = await checked(await db.rpc('complete_offline_order', { p_transaction_id: tx.id, p_paid_minor: 4000 }));
    expect((paid as { success: boolean }).success).toBe(true);
    expect(await accessTo(buyer.id, [bundle, before, after])).toEqual([bundle, after].sort());

    await fullRefund(tx, buyer.id, bundle);
    expect(await accessTo(buyer.id, [bundle, before, after])).toEqual([]);
  });

  it('grants a claiming guest the components paid for and ends exactly those on refund @J34', async () => {
    const [paidFor, addedLater] = [await product('guest-paid-for'), await product('guest-added-later')];
    const bundle = await bundleOf([paidFor]);
    const email = `bundle-guest-${randomUUID()}@example.com`;
    const sessionId = `cs_${randomUUID().replaceAll('-', '')}`;
    const tx = await checked(await db.from('payment_transactions').insert({
      product_id: bundle, customer_email: email, amount: 4000, currency: 'PLN', status: 'completed', payment_provider: 'stripe', session_id: sessionId,
    }).select('id,session_id').single());
    await checked(await db.from('guest_purchases').insert({ product_id: bundle, customer_email: email, transaction_amount: 4000, transaction_id: tx!.id, session_id: sessionId }));
    await recompose(bundle, paidFor, addedLater);
    const created = await checked(await db.auth.admin.createUser({ email, email_confirm: true }));
    userIds.push(created.user!.id);
    await checked(await db.rpc('claim_guest_purchases_for_user', { p_user_id: created.user!.id }));
    expect(await accessTo(created.user!.id, [bundle, paidFor, addedLater])).toEqual([bundle, paidFor].sort());

    await fullRefund(tx!, created.user!.id, bundle);
    expect(await accessTo(created.user!.id, [bundle, paidFor, addedLater])).toEqual([]);
  });

  it('ends a component when the buyer only has an unpaid order for it @J34', async () => {
    const [one, two] = [await product('comp-unpaid'), await product('comp-unpaid-two')];
    const bundle = await bundleOf([one, two]);
    const buyer = await user();
    const tx = await paidOrder(buyer, bundle);
    await unpaidTransfer(buyer, one);

    await fullRefund(tx, buyer.id, bundle);
    expect(await accessTo(buyer.id, [bundle, one, two])).toEqual([]);
  });

  it('keeps a component the buyer holds through another bundle granted without an order @J34', async () => {
    const [shared, onlyRefunded] = [await product('comp-manual-shared'), await product('comp-manual-only')];
    const refundedBundle = await bundleOf([shared, onlyRefunded]);
    const grantedBundle = await bundleOf([shared]);
    const buyer = await user();
    const tx = await paidOrder(buyer, refundedBundle);
    await checked(await db.rpc('grant_product_and_bundle_components', { user_id_param: buyer.id, product_id_param: grantedBundle }));

    await fullRefund(tx, buyer.id, refundedBundle);
    expect(await accessTo(buyer.id, [refundedBundle, grantedBundle, shared, onlyRefunded])).toEqual([grantedBundle, shared].sort());
  });
  it('uses the purchased composition of the other bundle when ending component access @J34', async () => {
    const [one, two] = [await product('comp-first-order'), await product('comp-second-order')];
    const first = await bundleOf([one]);
    const second = await bundleOf([two]);
    const buyer = await user();
    const refunded = await paidOrder(buyer, first);
    const retained = await paidOrder(buyer, second);
    expect(await checked(await db.rpc('order_granted_components', { p_transaction_id: retained.id }))).toEqual([two]);
    await recompose(second, two, one);

    await fullRefund(refunded, buyer.id, first);
    expect(await accessTo(buyer.id, [first, second, one, two])).toEqual([second, two].sort());
  });

  it('keeps an empty paid composition when a guest registers and claims the order @J34', async () => {
    const [before, later] = [await product('comp-empty-before'), await product('comp-empty-later')];
    const bundle = await bundleOf([before]);
    const email = `bundle-empty-${randomUUID()}@example.com`;
    const sessionId = `cs_${randomUUID().replaceAll('-', '')}`;
    const tx = await checked(await db.from('payment_transactions').insert({
      product_id: bundle, customer_email: email, amount: 4000, currency: 'PLN',
      status: 'pending', payment_provider: 'stripe', session_id: sessionId,
    }).select('id').single());
    await checked(await db.from('bundle_items').delete().eq('bundle_product_id', bundle));
    const completed = await checked(await db.rpc('process_stripe_payment_completion_with_bump', {
      session_id_param: sessionId, product_id_param: bundle, customer_email_param: email,
      amount_total: 4000, currency_param: 'PLN',
    }));
    expect(completed.success).toBe(true);
    expect(await checked(await db.from('order_bundle_components').select('component_product_id').eq('transaction_id', tx!.id))).toEqual([]);
    await checked(await db.from('bundle_items').insert({ bundle_product_id: bundle, component_product_id: later }));
    const created = await checked(await db.auth.admin.createUser({ email, email_confirm: true }));
    userIds.push(created.user!.id);
    expect(await accessTo(created.user!.id, [bundle, before, later])).toEqual([bundle]);
    await checked(await db.rpc('claim_guest_purchases_for_user', { p_user_id: created.user!.id }));
    expect(await checked(await db.rpc('order_granted_components', { p_transaction_id: tx!.id }))).toEqual([]);
    expect(await accessTo(created.user!.id, [bundle, before, later])).toEqual([bundle]);
  });

  it('retains a shared component recorded by another order after its catalogue composition changes @J34', async () => {
    const [shared, later] = [await product('comp-recorded-shared'), await product('comp-catalogue-later')];
    const first = await bundleOf([shared]);
    const second = await bundleOf([shared]);
    const buyer = await user();
    const refunded = await paidOrder(buyer, first);
    await paidOrder(buyer, second);
    await recompose(second, shared, later);

    await fullRefund(refunded, buyer.id, first);
    expect(await accessTo(buyer.id, [first, second, shared, later])).toEqual([second, shared].sort());
  });

  it('uses the catalogue for an order without a component record until its first grant @J34', async () => {
    const [before, after] = [await product('comp-unrecorded-before'), await product('comp-unrecorded-after')];
    const bundle = await bundleOf([before]);
    const buyer = await user();
    const tx = await unpaidTransfer(buyer, bundle);
    expect(await checked(await db.rpc('order_granted_components', { p_transaction_id: tx.id }))).toEqual([before]);
    await recompose(bundle, before, after);
    expect(await checked(await db.rpc('order_granted_components', { p_transaction_id: tx.id }))).toEqual([after]);
    const paid = await checked(await db.rpc('complete_offline_order', { p_transaction_id: tx.id, p_paid_minor: 4000 }));
    expect(paid.success).toBe(true);
    await recompose(bundle, after, before);
    expect(await checked(await db.rpc('order_granted_components', { p_transaction_id: tx.id }))).toEqual([after]);
    expect(await accessTo(buyer.id, [bundle, before, after])).toEqual([bundle, after].sort());
  });

  it('keeps components from a free bundle grant after an earlier order of that bundle ended @J34', async () => {
    const shared = await product('comp-free-after-order');
    const retainedBundle = await bundleOf([shared]);
    const refundedBundle = await bundleOf([shared]);
    const buyer = await user();
    const earlier = await paidOrder(buyer, retainedBundle);
    await fullRefund(earlier, buyer.id, retainedBundle);
    expect(await accessTo(buyer.id, [retainedBundle, shared])).toEqual([]);
    const row = await checked(await db.from('products').update({ price: 0 }).eq('id', retainedBundle).select('slug').single());
    const buyerClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await checked(await buyerClient.auth.signInWithPassword({ email: buyer.email, password: buyer.password }));
    expect(await checked(await buyerClient.rpc('grant_free_product_access', { product_slug_param: row!.slug }))).toBe(true);
    expect(await accessTo(buyer.id, [retainedBundle, shared])).toEqual([retainedBundle, shared].sort());
    const refunded = await paidOrder(buyer, refundedBundle);

    await fullRefund(refunded, buyer.id, refundedBundle);
    expect(await accessTo(buyer.id, [refundedBundle, retainedBundle, shared])).toEqual([retainedBundle, shared].sort());
  });

  it('retains the catalogue fallback for historical orders whose bundle is empty during migration @J34', async () => {
    const later = await product('comp-historical-later');
    const bundle = await product('bundle-historical-empty', { is_bundle: true });
    const buyer = await user();
    const tx = await paidOrder(buyer, bundle);
    const migration = readMigrationSource('20261117140000_order_entitlement_fixes.sql');
    const start = migration.indexOf('DO $$\nDECLARE tx record;');
    expect(start).toBeGreaterThan(0);
    const backfill = migration.slice(start, migration.indexOf('END $$;', start) + 'END $$;'.length);
    const result = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
      input: `UPDATE public.payment_transactions SET bundle_components_recorded_at = NULL WHERE id = '${tx.id}';
        ${backfill}
        SELECT bundle_components_recorded_at IS NULL FROM public.payment_transactions WHERE id = '${tx.id}';`,
      encoding: 'utf8',
    });
    expect(result.trim()).toBe('t');
    await checked(await db.from('bundle_items').insert({ bundle_product_id: bundle, component_product_id: later }));
    expect(await checked(await db.rpc('order_granted_components', { p_transaction_id: tx.id }))).toEqual([later]);
    await checked(await db.rpc('grant_product_and_bundle_components', {
      user_id_param: buyer.id, product_id_param: bundle, transaction_id_param: tx.id,
    }));
    expect(await accessTo(buyer.id, [bundle, later])).toEqual([bundle, later].sort());
  });

});
