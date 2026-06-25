import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { upsertBundleItems } from '@/lib/services/bundle-items';

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = URL && KEY ? createClient(URL, KEY) : null;
const ids: string[] = [];

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
  await db.from('bundle_items').delete().in('component_product_id', ids);
  await db.from('bundle_items').delete().in('bundle_product_id', ids);
  await db.from('products').delete().in('id', ids);
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

    await expect(upsertBundleItems(db!, bundle, [inner])).rejects.toBeTruthy();
    // failed insert leaves the bundle with no components
    expect(await components(bundle)).toEqual([]);
  });
});
