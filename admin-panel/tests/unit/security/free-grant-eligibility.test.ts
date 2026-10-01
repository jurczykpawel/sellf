/**
 * DB TEST: which products grant_free_product_access hands out
 *
 * REQUIRES: Supabase running locally (npx supabase start)
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteChecked, deleteBundleItemsFor, deleteAuthUsers } from '../../helpers/db-cleanup';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const CLIENT_OPTS = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, CLIENT_OPTS);
const PASSWORD = 'free-grant-Test-123!';
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = 24 * 60 * 60 * 1000;

let user: { id: string; client: SupabaseClient };
const productIds: string[] = [];
const couponIds: string[] = [];

async function product(fields: Record<string, unknown>): Promise<{ id: string; slug: string }> {
  const slug = `free-grant-${RUN}-${productIds.length}`;
  const { data, error } = await admin
    .from('products')
    .insert({ name: `Free grant ${slug}`, slug, price: 0, currency: 'USD', is_active: true, ...fields })
    .select('id, slug')
    .single();
  if (error) throw error;
  productIds.push(data.id);
  return data;
}

async function grant(slug: string, coupon?: string) {
  const { data, error } = await user.client.rpc('grant_free_product_access', {
    product_slug_param: slug,
    ...(coupon ? { coupon_code_param: coupon } : {}),
  });
  if (error) throw error;
  return data as boolean;
}

async function hasAccess(productId: string): Promise<boolean> {
  const { data } = await admin
    .from('user_product_access')
    .select('id')
    .eq('user_id', user.id)
    .eq('product_id', productId);
  return (data ?? []).length > 0;
}

beforeAll(async () => {
  const email = `free-grant-${RUN}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('createUser failed');
  const client = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  user = { id: data.user.id, client };
});

afterAll(async () => {
  await deleteChecked('coupon_redemptions', admin.from('coupon_redemptions').delete().in('coupon_id', couponIds));
  await deleteChecked('coupon_reservations', admin.from('coupon_reservations').delete().in('coupon_id', couponIds));
  await deleteChecked('coupons', admin.from('coupons').delete().in('id', couponIds));
  // Bundle links must go first — component_product_id is ON DELETE RESTRICT.
  await deleteBundleItemsFor(admin, productIds);
  await deleteChecked('user_product_access', admin.from('user_product_access').delete().in('product_id', productIds));
  await deleteChecked('products', admin.from('products').delete().in('id', productIds));
  if (user) await deleteAuthUsers(admin, [user.id]);
});

describe('grant_free_product_access eligibility', () => {
  it('grants an available free product', async () => {
    const p = await product({});
    expect(await grant(p.slug)).toBe(true);
    expect(await hasAccess(p.id)).toBe(true);
  });

  it('does not grant a product whose sales window has ended', async () => {
    const p = await product({ available_until: new Date(Date.now() - DAY).toISOString() });
    expect(await grant(p.slug)).toBe(false);
    expect(await hasAccess(p.id)).toBe(false);
  });

  it('does not grant a product whose sales window has not started', async () => {
    const p = await product({ available_from: new Date(Date.now() + DAY).toISOString() });
    expect(await grant(p.slug)).toBe(false);
    expect(await hasAccess(p.id)).toBe(false);
  });

  it('does not grant a subscription product with a full-discount coupon', async () => {
    const p = await product({
      price: 20,
      product_type: 'subscription',
      billing_interval: 'month',
      billing_interval_count: 1,
      recurring_price: 20,
    });
    const code = `FREESUB${RUN.replace(/[^a-z0-9]/gi, '')}`.toUpperCase();
    const { data: coupon, error } = await admin
      .from('coupons')
      .insert({
        code,
        name: code,
        discount_type: 'percentage',
        discount_value: 100,
        is_active: true,
        usage_limit_global: 10,
        usage_limit_per_user: 1,
        current_usage_count: 0,
        starts_at: new Date(Date.now() - DAY).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    couponIds.push(coupon.id);

    expect(await grant(p.slug, code)).toBe(false);
    expect(await hasAccess(p.id)).toBe(false);
  });

  it('grants the components of a bundle claimed with a full-discount coupon', async () => {
    const componentA = await product({ price: 15 });
    const componentB = await product({ price: 25 });
    const bundle = await product({ price: 30, is_bundle: true });
    const { error: itemsError } = await admin.from('bundle_items').insert([
      { bundle_product_id: bundle.id, component_product_id: componentA.id, display_order: 0 },
      { bundle_product_id: bundle.id, component_product_id: componentB.id, display_order: 1 },
    ]);
    if (itemsError) throw itemsError;
    const code = `FREEBUNDLE${RUN.replace(/[^a-z0-9]/gi, '')}`.toUpperCase();
    const { data: coupon, error } = await admin
      .from('coupons')
      .insert({
        code,
        name: code,
        discount_type: 'percentage',
        discount_value: 100,
        is_active: true,
        usage_limit_global: 10,
        usage_limit_per_user: 1,
        current_usage_count: 0,
        starts_at: new Date(Date.now() - DAY).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    couponIds.push(coupon.id);

    expect(await grant(bundle.slug, code)).toBe(true);
    expect(await hasAccess(bundle.id)).toBe(true);
    expect(await hasAccess(componentA.id)).toBe(true);
    expect(await hasAccess(componentB.id)).toBe(true);
  });

  it('keeps confirming access the user already holds after the window ends', async () => {
    const p = await product({});
    expect(await grant(p.slug)).toBe(true);
    await admin
      .from('products')
      .update({ available_until: new Date(Date.now() - DAY).toISOString() })
      .eq('id', p.id);

    expect(await grant(p.slug)).toBe(true);
  });
});
