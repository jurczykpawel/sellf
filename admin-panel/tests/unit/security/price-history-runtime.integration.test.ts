/**
 * Live PostgREST integration test for the narrowed price-history surface.
 *
 * Static SQL grep tests cover the migration shape; THIS test exercises the
 * real anon path end-to-end, which is what production traffic uses. Catches
 * regressions where the migration is correct but PostgREST schema resolution
 * (`schemas = ["public", "public", ...]` order, default Accept-Profile,
 * etc.) routes the call somewhere unsafe.
 *
 * REQUIRES: Supabase running locally (`npx supabase start`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const supabaseAnon: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY);

const TS = Date.now();
let listedProductId = '';
let unlistedProductId = '';
let inactiveProductId = '';

describe('Price-history runtime exposure (live PostgREST probe)', () => {
  beforeAll(async () => {
    // Listed + active product — should appear in public.omnibus_price_history.
    const listed = await supabaseAdmin.from('products').insert({
      name: 'Pricehist Listed',
      slug: `pricehist-listed-${TS}`,
      price: 100,
      currency: 'USD',
      stripe_price_id: `price_pricehist_listed_${TS}`,
      is_active: true,
      is_listed: true,
    }).select('id').single();
    if (listed.error) throw listed.error;
    listedProductId = listed.data.id;

    // Active but UNLISTED — must be hidden.
    const unlisted = await supabaseAdmin.from('products').insert({
      name: 'Pricehist Unlisted',
      slug: `pricehist-unlisted-${TS}`,
      price: 200,
      currency: 'USD',
      stripe_price_id: `price_pricehist_unlisted_${TS}`,
      is_active: true,
      is_listed: false,
    }).select('id').single();
    if (unlisted.error) throw unlisted.error;
    unlistedProductId = unlisted.data.id;

    // Inactive — must be hidden.
    const inactive = await supabaseAdmin.from('products').insert({
      name: 'Pricehist Inactive',
      slug: `pricehist-inactive-${TS}`,
      price: 300,
      currency: 'USD',
      stripe_price_id: `price_pricehist_inactive_${TS}`,
      is_active: false,
      is_listed: true,
    }).select('id').single();
    if (inactive.error) throw inactive.error;
    inactiveProductId = inactive.data.id;
  });

  afterAll(async () => {
    if (listedProductId) await supabaseAdmin.from('products').delete().eq('id', listedProductId);
    if (unlistedProductId) await supabaseAdmin.from('products').delete().eq('id', unlistedProductId);
    if (inactiveProductId) await supabaseAdmin.from('products').delete().eq('id', inactiveProductId);
  });

  it('anon can read narrowed columns for active+listed products via the public view', async () => {
    const { data, error } = await supabaseAnon
      .from('omnibus_price_history')
      .select('product_id, price, sale_price, currency, effective_from')
      .eq('product_id', listedProductId);
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.length).toBeGreaterThanOrEqual(1);
    const row = data![0];
    expect(row.product_id).toBe(listedProductId);
    expect(typeof row.price).toBe('number');
    expect(row.currency).toBe('USD');
    // Internal columns must not be selectable from this view.
    expect(Object.keys(row).sort()).toEqual(
      ['currency', 'effective_from', 'price', 'product_id', 'sale_price'].sort()
    );
  });

  it('anon receives 0 rows for active-but-unlisted products (filtered by view WHERE)', async () => {
    const { data, error } = await supabaseAnon
      .from('omnibus_price_history')
      .select('product_id')
      .eq('product_id', unlistedProductId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('anon receives 0 rows for inactive products (filtered by view WHERE)', async () => {
    const { data, error } = await supabaseAnon
      .from('omnibus_price_history')
      .select('product_id')
      .eq('product_id', inactiveProductId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('anon cannot select internal columns through the public view (column does not exist)', async () => {
    const { error } = await supabaseAnon
      .from('omnibus_price_history')
      .select('changed_by, change_reason, vat_rate')
      .limit(1);
    expect(error).not.toBeNull();
    // PostgREST error code for unknown column.
    expect(error!.code).toBe('42703');
  });

  it('anon is denied direct access to the raw public.product_price_history table', async () => {
    const { error } = await supabaseAnon
      .schema('public')
      .from('product_price_history')
      .select('id, product_id, price, changed_by')
      .limit(1);
    expect(error).not.toBeNull();
    // 42501 = insufficient_privilege; service_role is the only role allowed.
    expect(error!.code).toBe('42501');
  });
});
