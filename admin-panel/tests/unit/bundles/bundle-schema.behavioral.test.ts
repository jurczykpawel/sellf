import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const db = URL && KEY ? createClient(URL, KEY) : null;
const ids: string[] = [];
const users: string[] = [];

async function mkProduct(over: Record<string, unknown> = {}) {
  const slug = `t-${crypto.randomUUID().slice(0, 8)}`;
  const { data, error } = await db!.from('products')
    .insert({ name: slug, slug, price: 100, currency: 'PLN', is_active: true, ...over })
    .select('id').single();
  if (error) throw error;
  ids.push(data!.id);
  return data!.id as string;
}

beforeAll(() => { if (!db) console.warn('[bundle-schema] skip — needs Supabase env'); });
afterAll(async () => {
  if (!db) return;
  await db.from('user_product_access').delete().in('product_id', ids);
  await db.from('bundle_items').delete().in('component_product_id', ids);
  await db.from('bundle_items').delete().in('bundle_product_id', ids);
  await db.from('products').delete().in('id', ids);
  for (const u of users) await db.auth.admin.deleteUser(u).catch(() => {});
});

describe.skipIf(!db)('bundle_items schema + guards', () => {
  it('accepts a valid component link', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const comp = await mkProduct({ is_bundle: false });
    const { error } = await db!.from('bundle_items')
      .insert({ bundle_product_id: bundle, component_product_id: comp, display_order: 0 });
    expect(error).toBeNull();
  });

  it('rejects a nested bundle (component is a bundle)', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const inner = await mkProduct({ is_bundle: true });
    const { error } = await db!.from('bundle_items')
      .insert({ bundle_product_id: bundle, component_product_id: inner });
    expect(error).not.toBeNull();
  });

  it('rejects self-reference and a non-bundle parent', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const self = await db!.from('bundle_items')
      .insert({ bundle_product_id: bundle, component_product_id: bundle });
    expect(self.error).not.toBeNull();
    const plain = await mkProduct({ is_bundle: false });
    const comp = await mkProduct({ is_bundle: false });
    const badParent = await db!.from('bundle_items')
      .insert({ bundle_product_id: plain, component_product_id: comp });
    expect(badParent.error).not.toBeNull();
  });

  it('rejects a subscription component', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    // A valid subscription product requires full recurring config (products_subscription_complete
    // constraint), so supply it here — otherwise the product INSERT fails before we ever reach the
    // bundle_items guard this test is meant to exercise.
    const sub = await mkProduct({
      is_bundle: false,
      product_type: 'subscription',
      billing_interval: 'month',
      billing_interval_count: 1,
      recurring_price: 100,
    });
    const { error } = await db!.from('bundle_items')
      .insert({ bundle_product_id: bundle, component_product_id: sub });
    expect(error).not.toBeNull();
  });

  it('rejects duplicate component and restricts deleting a component in use', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const comp = await mkProduct({ is_bundle: false });
    await db!.from('bundle_items').insert({ bundle_product_id: bundle, component_product_id: comp });
    const dup = await db!.from('bundle_items').insert({ bundle_product_id: bundle, component_product_id: comp });
    expect(dup.error).not.toBeNull();
    const del = await db!.from('products').delete().eq('id', comp);
    expect(del.error).not.toBeNull(); // on delete restrict
  });

  it('grant_product_and_bundle_components grants the bundle + every component, idempotently', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const a = await mkProduct({ is_bundle: false });
    const b = await mkProduct({ is_bundle: false });
    await db!.from('bundle_items').insert([
      { bundle_product_id: bundle, component_product_id: a, display_order: 0 },
      { bundle_product_id: bundle, component_product_id: b, display_order: 1 },
    ]);
    const { data: user } = await db!.auth.admin.createUser({ email: `b-${crypto.randomUUID().slice(0,8)}@t.dev`, email_confirm: true });
    users.push(user!.user!.id);

    for (let i = 0; i < 2; i++) {
      const { error } = await db!.rpc('grant_product_and_bundle_components', {
        user_id_param: user!.user!.id, product_id_param: bundle,
      });
      expect(error).toBeNull();
    }
    const { data: access } = await db!.from('user_product_access')
      .select('product_id').eq('user_id', user!.user!.id);
    const owned = new Set((access ?? []).map((r) => r.product_id));
    expect(owned.has(bundle)).toBe(true);
    expect(owned.has(a)).toBe(true);
    expect(owned.has(b)).toBe(true);
  });

  it('grants an inactive component (is_active governs standalone sale, not bundle membership)', async () => {
    const bundle = await mkProduct({ is_bundle: true });
    const active = await mkProduct({ is_bundle: false, is_active: true });
    const inactive = await mkProduct({ is_bundle: false, is_active: false });
    await db!.from('bundle_items').insert([
      { bundle_product_id: bundle, component_product_id: active, display_order: 0 },
      { bundle_product_id: bundle, component_product_id: inactive, display_order: 1 },
    ]);
    const { data: user } = await db!.auth.admin.createUser({ email: `i-${crypto.randomUUID().slice(0,8)}@t.dev`, email_confirm: true });
    users.push(user!.user!.id);

    const { error } = await db!.rpc('grant_product_and_bundle_components', {
      user_id_param: user!.user!.id, product_id_param: bundle,
    });
    expect(error).toBeNull();

    const { data: access } = await db!.from('user_product_access')
      .select('product_id').eq('user_id', user!.user!.id);
    const owned = new Set((access ?? []).map((r) => r.product_id));
    expect(owned.has(bundle)).toBe(true);
    expect(owned.has(active)).toBe(true);
    expect(owned.has(inactive)).toBe(true); // inactive component MUST still be granted
  });

  it('grants only the product for a non-bundle', async () => {
    const plain = await mkProduct({ is_bundle: false });
    const { data: user } = await db!.auth.admin.createUser({ email: `p-${crypto.randomUUID().slice(0,8)}@t.dev`, email_confirm: true });
    users.push(user!.user!.id);
    await db!.rpc('grant_product_and_bundle_components', { user_id_param: user!.user!.id, product_id_param: plain });
    const { data: access } = await db!.from('user_product_access').select('product_id').eq('user_id', user!.user!.id);
    expect((access ?? []).length).toBe(1);
  });
});
