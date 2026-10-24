/** Coupon accounting through the shared completion RPC. @see tests/stripe-live/embed-completion.spec.ts */
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';

interface CouponCheckResult {
  valid: boolean;
  error?: string;
}

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
let productId: string, couponId: string, code: string, email: string;
async function complete(session: string, buyer = email, amount = 9000) {
  return db.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: session, product_id_param: productId, customer_email_param: buyer,
    amount_total: amount, currency_param: 'PLN', coupon_id_param: couponId,
  });
}
const sessionId = () => `cs_${crypto.randomUUID().replaceAll('-', '')}`;
beforeEach(async () => {
  expect((await db.from('rate_limits').delete().eq('function_name', 'verify_coupon')).error).toBeNull();
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
  it.each(['email', 'product', 'currency', 'amount'])('keeps %s rejection atomic', async kind => {
    if (kind === 'currency') await db.from('coupons').update({ discount_type: 'fixed', discount_value: 10, currency: 'USD' }).eq('id', couponId);
    if (kind === 'email') await db.from('coupons').update({ allowed_emails: ['other@example.com'] }).eq('id', couponId);
    if (kind === 'product') await db.from('coupons').update({ allowed_product_ids: [crypto.randomUUID()] }).eq('id', couponId);
    const session = sessionId(); const result = await complete(session, email, kind === 'amount' ? 10001 : 9000);
    expect(result.error || !result.data?.success).toBeTruthy();
    expect((await db.from('payment_transactions').select('id').eq('session_id', session)).data).toEqual([]);
    expect((await db.from('coupons').select('current_usage_count').eq('id', couponId).single()).data?.current_usage_count).toBe(0);
    expect((await db.from('coupon_reservations').select('id').eq('coupon_id', couponId)).data).toEqual([]);
  });
});

async function preparePayment(form: boolean): Promise<string> {
  const session = sessionId();
  const verified = await db.rpc('verify_coupon', { code_param: code, product_id_param: productId,
    customer_email_param: form ? email : undefined, currency_param: 'PLN' });
  expect(verified.error).toBeNull(); expect(verified.data).toMatchObject({ valid: true });
  if (form) {
    const placed = await db.rpc('place_order', {
      p_order: { payment_provider: 'stripe', product_id: productId, customer_email: email,
        session_id: session, coupon_id: couponId, currency: 'PLN' },
      p_lines: [{ product_id: productId, item_type: 'main_product', product_name: 'Embedded course',
        quantity: 1, unit_price: 100, total_price: 100, discounted_total: 90,
        currency: 'PLN', tax_behavior: 'inclusive', vat_rate: 0, vat_exempt: true }],
    });
    expect(placed.error).toBeNull(); expect(placed.data).toMatchObject({ success: true });
  }
  return session;
}
async function expectCompleted(session: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await complete(session);
    expect(result.error).toBeNull(); expect(result.data).toMatchObject({ success: true });
  }
  expect((await db.from('payment_transactions').select('status,amount').eq('session_id', session)).data)
    .toEqual([{ status: 'completed', amount: 9000 }]);
  expect((await db.from('coupon_redemptions').select('customer_email').eq('coupon_id', couponId)).data)
    .toEqual([{ customer_email: email }]);
  expect((await db.from('coupons').select('current_usage_count').eq('id', couponId).single()).data?.current_usage_count).toBe(1);
}
for (const form of [false, true]) describe(form ? 'reserved form payment' : 'embed email collected during payment', () => {
  it.each([5, 101])('completes after %i earlier coupon checks', async count => {
    const session = await preparePayment(form);
    const checks: CouponCheckResult[] = JSON.parse(execFileSync('docker', [
      'exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1',
      '-v', `coupon_code=${code}`, '-v', `product_id=${productId}`, '-v', `buyer_email=${email}`, '-v', `check_count=${count}`,
    ], { encoding: 'utf8', input: `
      BEGIN;
      SET LOCAL ROLE anon;
      SET LOCAL request.jwt.claims = '{"role":"anon"}';
      SELECT jsonb_agg(public.verify_coupon(
        CASE WHEN :check_count = 5 THEN :'coupon_code' ELSE 'CHECK-' || i || '-' || :'coupon_code' END,
        :'product_id'::uuid, CASE WHEN :check_count = 5 THEN :'buyer_email' ELSE NULL END, 'PLN'
      )) FROM generate_series(1, :check_count) i;
      COMMIT;
    ` }));
    if (count === 5) expect(checks.every(check => check.valid)).toBe(true);
    else expect(checks.map(check => check.error)).toContain('Too many attempts. Please try again later.');
    await expectCompleted(session);
  });
  it.each(['expired', 'inactive', 'future'])('completes a paid session after coupon becomes %s', async state => {
    const session = await preparePayment(form);
    const changed = await db.from('coupons').update(state === 'expired' ? { expires_at: '2000-01-01T00:00:00Z' }
      : state === 'future' ? { starts_at: '2099-01-01T00:00:00Z' } : { is_active: false }).eq('id', couponId);
    expect(changed.error).toBeNull();
    const selectedAgain = await db.rpc('verify_coupon', { code_param: code, product_id_param: productId, customer_email_param: email, currency_param: 'PLN' });
    expect(selectedAgain.error).toBeNull(); expect(selectedAgain.data).toMatchObject({ valid: false });
    await expectCompleted(session);
  });
});

describe('completion reservation constraints', () => {
  it('can reserve a second buyer while completing a buyer with an expired hold', async () => {
    expect((await db.from('coupon_reservations').insert({ coupon_id: couponId, customer_email: email,
      expires_at: '2000-01-01T00:00:00Z' })).error).toBeNull();
    const [reserved, completed] = await Promise.all([
      db.rpc('verify_coupon', { code_param: code, product_id_param: productId, customer_email_param: 'reserved@example.com', currency_param: 'PLN' }),
      complete(sessionId()),
    ]);
    expect(reserved.error).toBeNull(); expect(reserved.data).toMatchObject({ valid: true });
    expect(completed.error).toBeNull(); expect(completed.data).toMatchObject({ success: true });
  });
  it('keeps the reservation helper private', async () => {
    const result = await anon.rpc('_reserve_coupon', { coupon_id_param: couponId, product_id_param: productId,
      customer_email_param: email, currency_param: 'PLN' });
    expect(result.error?.code).toBe('42501');
  });
  it.each(['person', 'global'])('retains the %s limit after coupon expiry', async limit => {
    const pending = await preparePayment(false);
    expect((await complete(sessionId(), limit === 'person' ? email : 'other@example.com')).data).toMatchObject({ success: true });
    if (limit === 'global') {
      const reserved = await db.rpc('verify_coupon', { code_param: code, product_id_param: productId,
        customer_email_param: 'reserved@example.com', currency_param: 'PLN' });
      expect(reserved.data).toMatchObject({ valid: true });
    }
    expect((await db.from('coupons').update({ expires_at: '2000-01-01T00:00:00Z' }).eq('id', couponId)).error).toBeNull();
    const result = await complete(pending);
    expect(result.error).toBeNull(); expect(result.data).toMatchObject({ success: false });
    expect((await db.from('coupons').select('current_usage_count').eq('id', couponId).single()).data?.current_usage_count).toBe(1);
  });
});
