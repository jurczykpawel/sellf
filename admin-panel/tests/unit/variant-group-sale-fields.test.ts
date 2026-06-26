/**
 * The public variant selector page (/v/[group]) must be able to show
 * promotional prices on each variant, exactly like the single-product
 * checkout page. That requires the get_variant_group / _by_slug RPCs to
 * project the Omnibus sale columns (sale_price, sale_price_until,
 * sale_quantity_limit, sale_quantity_sold) — previously they did not, so the
 * client never had the data to render a sale.
 *
 * Behavioral test against the local Supabase DB (mirrors
 * product-vat-defaults-inherit.test.ts). Creates a product + variant group,
 * asserts the RPC returns the sale fields, then cleans up.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

describe('get_variant_group RPCs project Omnibus sale fields', () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const groupSlug = `vg-sale-${stamp}`;
  let productId: string;
  let groupId: string;
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  beforeAll(async () => {
    const { data: product, error: pErr } = await admin
      .from('products')
      .insert({
        name: `Variant sale test ${stamp}`,
        slug: `vg-sale-prod-${stamp}`,
        price: 100,
        currency: 'USD',
        is_active: true,
        sale_price: 60,
        sale_price_until: future,
      })
      .select('id')
      .single();
    if (pErr) throw pErr;
    productId = product!.id;

    const { data: group, error: gErr } = await admin
      .from('variant_groups')
      .insert({ slug: groupSlug, name: `Group ${stamp}`, is_active: true })
      .select('id')
      .single();
    if (gErr) throw gErr;
    groupId = group!.id;

    const { error: linkErr } = await admin
      .from('product_variant_groups')
      .insert({ group_id: groupId, product_id: productId, display_order: 0, is_featured: false });
    if (linkErr) throw linkErr;
  });

  afterAll(async () => {
    await admin.from('product_variant_groups').delete().eq('group_id', groupId);
    await admin.from('variant_groups').delete().eq('id', groupId);
    await admin.from('products').delete().eq('id', productId);
  });

  it('get_variant_group_by_slug returns the active sale price', async () => {
    const { data, error } = await admin.rpc('get_variant_group_by_slug', { p_slug: groupSlug });
    expect(error).toBeNull();
    const variant = (data as any[]).find((v) => v.id === productId);
    expect(variant).toBeTruthy();
    expect(Number(variant.price)).toBe(100);
    expect(Number(variant.sale_price)).toBe(60);
    expect(variant.sale_price_until).toBeTruthy();
    expect(variant).toHaveProperty('sale_quantity_limit');
    expect(variant).toHaveProperty('sale_quantity_sold');
  });

  it('get_variant_group (by UUID) returns the active sale price', async () => {
    const { data, error } = await admin.rpc('get_variant_group', { p_group_id: groupId });
    expect(error).toBeNull();
    const variant = (data as any[]).find((v) => v.id === productId);
    expect(variant).toBeTruthy();
    expect(Number(variant.sale_price)).toBe(60);
  });
});
