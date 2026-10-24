/** Coupon accounting through the shared completion RPC. @see tests/stripe-live/embed-completion.spec.ts */
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let productId: string, couponId: string, code: string, email: string;
async function complete(session: string, buyer = email, amount = 9000) {
  return db.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: session, product_id_param: productId, customer_email_param: buyer,
    amount_total: amount, currency_param: 'PLN', coupon_id_param: couponId,
  });
}
const sessionId = () => `cs_${crypto.randomUUID().replaceAll('-', '')}`;
beforeEach(async () => {
  email = `embed-${crypto.randomUUID()}@example.com`; code = `EMBED-${crypto.randomUUID()}`;
  const product = await db.from('products').insert({ slug: `embed-${crypto.randomUUID()}`, name: 'Embedded course', price: 100,
    currency: 'PLN', is_active: true, vat_exempt: true, price_includes_vat: true }).select('id').single();
  expect(product.error).toBeNull(); productId = product.data!.id;
  const coupon = await db.from('coupons').insert({ code, discount_type: 'percentage', discount_value: 10,
    usage_limit_per_user: 1, usage_limit_global: 2, allowed_product_ids: [productId] }).select('id').single();
  expect(coupon.error).toBeNull(); couponId = coupon.data!.id;
});
afterEach(async () => {
  for (const table of ['coupon_redemptions', 'coupon_reservations']) await db.from(table).delete().eq('coupon_id', couponId);
  for (const table of ['guest_purchases', 'payment_transactions']) await db.from(table).delete().eq('product_id', productId);
  await db.from('coupons').delete().eq('id', couponId);
  await db.from('products').delete().eq('id', productId);
});
describe('embedded coupon completion', () => {
  it('reserves at completion for a newly collected email and completes once', async () => {
    const session = sessionId();
    const results = await Promise.all([complete(session), complete(session)]);
    for (const result of results) { expect(result.error).toBeNull(); expect(result.data).toMatchObject({ success: true }); }
    expect((await db.from('coupon_redemptions').select('customer_email').eq('coupon_id', couponId)).data).toEqual([{ customer_email: email }]);
    expect((await db.from('coupons').select('current_usage_count').eq('id', couponId).single()).data?.current_usage_count).toBe(1);
    expect((await complete(sessionId())).data).toMatchObject({ success: false });
  });
  it('serializes separate purchases for the same person', async () => {
    const results = await Promise.all([complete(sessionId()), complete(sessionId())]);
    expect(results.filter(result => result.data?.success)).toHaveLength(1);
    expect((await db.from('coupon_redemptions').select('id').eq('coupon_id', couponId)).data).toHaveLength(1);
  });
  it('honors another buyer reservation and the global limit', async () => {
    expect((await db.rpc('verify_coupon', { code_param: code, product_id_param: productId, customer_email_param: 'reserved@example.com', currency_param: 'PLN' })).data).toMatchObject({ valid: true });
    expect((await complete(sessionId())).data).toMatchObject({ success: true });
    expect((await complete(sessionId(), 'other@example.com')).data).toMatchObject({ success: false });
    expect((await complete(sessionId(), 'reserved@example.com')).data).toMatchObject({ success: true });
  });
  it.each(['inactive', 'expired', 'email', 'product', 'amount'])('keeps %s rejection atomic', async kind => {
    if (kind === 'inactive') await db.from('coupons').update({ is_active: false }).eq('id', couponId);
    if (kind === 'expired') await db.from('coupons').update({ expires_at: '2000-01-01T00:00:00Z' }).eq('id', couponId);
    if (kind === 'email') await db.from('coupons').update({ allowed_emails: ['other@example.com'] }).eq('id', couponId);
    if (kind === 'product') await db.from('coupons').update({ allowed_product_ids: [crypto.randomUUID()] }).eq('id', couponId);
    const session = sessionId(); const result = await complete(session, email, kind === 'amount' ? 10001 : 9000);
    expect(result.error || !result.data?.success).toBeTruthy();
    expect((await db.from('payment_transactions').select('id').eq('session_id', session)).data).toEqual([]);
    expect((await db.from('coupons').select('current_usage_count').eq('id', couponId).single()).data?.current_usage_count).toBe(0);
    expect((await db.from('coupon_reservations').select('id').eq('coupon_id', couponId)).data).toEqual([]);
  });
});
