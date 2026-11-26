import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { BundleArchivedError, upsertBundleItems } from '@/lib/services/bundle-items';
import { deleteChecked, deleteBundleItemsFor } from '../../helpers/db-cleanup';

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = URL && KEY ? createClient(URL, KEY) : null;
const ids: string[] = [];
const adminUsers: string[] = [];

async function mkProduct(over: Record<string, unknown> = {}) {
  const slug = `t-${crypto.randomUUID().slice(0, 8)}`;
  const { data, error } = await db!.from('products')
    .insert({ name: slug, slug, price: 100, currency: 'PLN', is_active: true, ...over })
    .select('id').single();
  if (error) throw error;
  ids.push(data!.id);
  return data!.id as string;
}

async function components(bundleId: string): Promise<string[]> {
  const { data, error } = await db!.from('bundle_items')
    .select('component_product_id,display_order')
    .eq('bundle_product_id', bundleId)
    .order('display_order');
  if (error) throw error;
  return (data ?? []).map((r) => r.component_product_id as string);
}

beforeAll(() => { if (!db) console.warn('[bundle-api] skip — needs Supabase env'); });
afterAll(async () => {
  if (!db) return;
  await deleteBundleItemsFor(db, ids);
  await deleteChecked('products', db.from('products').delete().in('id', ids));
  for (const id of adminUsers) {
    await db.from('admin_users').delete().eq('user_id', id);
    await db.auth.admin.deleteUser(id);
  }
});

describe.skipIf(!db)('upsertBundleItems', () => {
  it("replaces a bundle's components in order", async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const a = await mkProduct();
    const b = await mkProduct();
    const c = await mkProduct();

    await upsertBundleItems(db!, bundle, [a, b]);
    expect(await components(bundle)).toEqual([a, b]);

    // Replace with a different ordered set
    await upsertBundleItems(db!, bundle, [c, a]);
    expect(await components(bundle)).toEqual([c, a]);
  });

  it('clears all components when given an empty array', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const a = await mkProduct();
    const b = await mkProduct();

    await upsertBundleItems(db!, bundle, [a, b]);
    expect(await components(bundle)).toEqual([a, b]);

    await upsertBundleItems(db!, bundle, []);
    expect(await components(bundle)).toEqual([]);
  });

  it('assigns display_order by array index', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const a = await mkProduct();
    const b = await mkProduct();
    const c = await mkProduct();

    await upsertBundleItems(db!, bundle, [c, a, b]);

    const { data } = await db!.from('bundle_items')
      .select('component_product_id,display_order')
      .eq('bundle_product_id', bundle)
      .order('display_order');
    expect(data).toEqual([
      { component_product_id: c, display_order: 0 },
      { component_product_id: a, display_order: 1 },
      { component_product_id: b, display_order: 2 },
    ]);
  });

  it('propagates the DB trigger error for an invalid component (nested bundle)', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const inner = await mkProduct({ is_bundle: true });
    const original = await mkProduct();
    await upsertBundleItems(db!, bundle, [original]);

    await expect(upsertBundleItems(db!, bundle, [inner])).rejects.toBeTruthy();
    expect(await components(bundle)).toEqual([original]);
  });
  it('rejects archived components in direct writes and replacements without changing the set', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const original = await mkProduct();
    const archived = await mkProduct({ archived_at: new Date().toISOString(), is_active: false });
    await upsertBundleItems(db!, bundle, [original]);
    const direct = await db!.from('bundle_items').insert({ bundle_product_id: bundle, component_product_id: archived });
    expect(direct.error?.code).toBe('23514');
    await expect(upsertBundleItems(db!, bundle, [archived])).rejects.toMatchObject({ details: { bundleItemIds: ['archived'] } });
    expect(await components(bundle)).toEqual([original]);
    const archive = await db!.from('products').update({ archived_at: new Date().toISOString(), is_active: false }).eq('id', original);
    expect(archive.error?.code).toBe('2BP01');
    expect((await db!.from('products').select('archived_at').eq('id', original).single()).data?.archived_at).toBeNull();
  });

  it('keeps the composition of an archived bundle unchanged (replacement and direct insert)', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const original = await mkProduct();
    const other = await mkProduct();
    await upsertBundleItems(db!, bundle, [original]);
    const archived = await db!.from('products').update({ archived_at: new Date().toISOString(), is_active: false }).eq('id', bundle);
    expect(archived.error).toBeNull();
    await expect(upsertBundleItems(db!, bundle, [])).rejects.toBeInstanceOf(BundleArchivedError);
    await expect(upsertBundleItems(db!, bundle, [other])).rejects.toBeInstanceOf(BundleArchivedError);
    const direct = await db!.from('bundle_items').insert({ bundle_product_id: bundle, component_product_id: other });
    expect(direct.error?.details).toBe('bundle_archived');
    expect(await components(bundle)).toEqual([original]);
  });

  it('saves fields and composition together, and an archived bundle keeps both unchanged (W343r P2)', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const original = await mkProduct();
    const other = await mkProduct();
    await upsertBundleItems(db!, bundle, [original]);
    // Own admin fixture, not whichever admin the shared database holds.
    const created = await db!.auth.admin.createUser({ email: `bundle-admin-${crypto.randomUUID()}@example.com`, email_confirm: true });
    const adminId = created.data.user!.id;
    adminUsers.push(adminId);
    expect((await db!.from('admin_users').upsert({ user_id: adminId })).error).toBeNull();
    const actor = { event_actor: { type: 'user', id: adminId }, actor_id: adminId };
    const ok = await db!.rpc('mutate_bundle_product_as', { ...actor, product_data: { name: 'Saved together' }, p_product_id: bundle, p_component_ids: [other] }).select('name').single();
    expect(ok.error).toBeNull();
    expect(ok.data?.name).toBe('Saved together');
    expect(await components(bundle)).toEqual([other]);
    await db!.from('products').update({ archived_at: new Date().toISOString(), is_active: false }).eq('id', bundle);
    const refused = await db!.rpc('mutate_bundle_product_as', { ...actor, product_data: { name: 'Must not stick' }, p_product_id: bundle, p_component_ids: [original] }).select('name').single();
    expect(refused.error?.details).toBe('bundle_archived');
    expect((await db!.from('products').select('name').eq('id', bundle).single()).data?.name).toBe('Saved together');
    expect(await components(bundle)).toEqual([other]);
  });

  it('requires a service client to replace the component set', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const original = await mkProduct();
    await upsertBundleItems(db!, bundle, [original]);
    const publicClient = createClient(URL, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await publicClient.rpc('replace_bundle_items', { p_bundle_id: bundle, p_component_ids: [] });
    expect(error?.code).toBe('42501');
    expect(await components(bundle)).toEqual([original]);
  });

});
