/**
 * Checking a code on the storefront does not hold one of a limited coupon's slots; the slot is held
 * when the payment session is created. The database function is called by the server only.
 * Real local database.
 * @see supabase/migrations/20261117140000_order_entitlement_fixes.sql
 */
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anon = createClient(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const run = crypto.randomUUID().slice(0, 8);
const productIds: string[] = [];
const couponIds: string[] = [];

async function setup(limit: number) {
  const product = await admin.from('products').insert({ name: 'Preview', slug: `preview-${run}-${productIds.length}`, price: 50, currency: 'PLN', is_active: true }).select('id').single();
  if (product.error) throw product.error;
  productIds.push(product.data.id);
  const coupon = await admin.from('coupons').insert({
    code: `PREVIEW-${run}-${couponIds.length}`.toUpperCase(), name: 'Preview', discount_type: 'percentage', discount_value: 10,
    is_active: true, usage_limit_global: limit, usage_limit_per_user: 1, current_usage_count: 0,
    starts_at: new Date(Date.now() - 3_600_000).toISOString(),
  }).select('id,code').single();
  if (coupon.error) throw coupon.error;
  couponIds.push(coupon.data.id);
  return { productId: product.data.id, coupon: coupon.data };
}
const reservations = async (couponId: string) => (await admin.from('coupon_reservations').select('customer_email').eq('coupon_id', couponId)).data ?? [];

beforeEach(async () => { await admin.from('rate_limits').delete().like('function_name', '%verify_coupon%'); });
afterAll(async () => {
  await admin.from('coupon_reservations').delete().in('coupon_id', couponIds);
  await admin.from('coupons').delete().in('id', couponIds);
  await admin.from('products').delete().in('id', productIds);
});

describe('coupon preview and reservation @J124', () => {
  it('a preview check with an email holds no slot, so the last slot stays available to a paying buyer @J124', async () => {
    const { productId, coupon } = await setup(1);
    for (const email of ['a@example.com', 'b@example.com', 'c@example.com']) {
      const { data, error } = await admin.rpc('verify_coupon', { code_param: coupon.code, product_id_param: productId, customer_email_param: `${run}-${email}`, currency_param: 'PLN', reserve_param: false });
      expect(error).toBeNull();
      expect(data.valid).toBe(true);
    }
    expect(await reservations(coupon.id)).toEqual([]);

    const paying = await admin.rpc('verify_coupon', { code_param: coupon.code, product_id_param: productId, customer_email_param: `${run}-buyer@example.com`, currency_param: 'PLN' });
    expect(paying.data.valid).toBe(true);
    expect(await reservations(coupon.id)).toEqual([{ customer_email: `${run}-buyer@example.com` }]);
  });

  it('the storefront roles cannot call the coupon function directly @J124', async () => {
    const { productId, coupon } = await setup(5);
    const { error } = await anon.rpc('verify_coupon', { code_param: coupon.code, product_id_param: productId, customer_email_param: `${run}-anon@example.com` });
    expect(error?.code).toBe('42501');
    expect(await reservations(coupon.id)).toEqual([]);
  });
});
