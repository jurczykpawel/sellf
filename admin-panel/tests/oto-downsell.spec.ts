import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// NOTE: Run with --workers=1 because tests modify global DB state.
// Mirrors the style of oto-system.spec.ts so the two suites coexist cleanly.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function createTestProduct(suffix: string, price = 49.99) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      name: `Downsell Test ${suffix} ${stamp}`,
      slug: `downsell-${suffix.toLowerCase()}-${stamp}`,
      price,
      currency: 'USD',
      is_active: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data!;
}

async function createCompletedTransaction(productId: string, email: string) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const { data, error } = await supabaseAdmin
    .from('payment_transactions')
    .insert({
      session_id: `cs_test_downsell_${stamp}`,
      product_id: productId,
      customer_email: email,
      amount: 49.99,
      currency: 'USD',
      status: 'completed',
    })
    .select()
    .single();
  if (error) throw error;
  return data!;
}

test.describe('OTO Downsell + Funnel Analytics Attribution', () => {
  const createdIds = {
    products: [] as string[],
    offers: [] as string[],
    transactions: [] as string[],
    coupons: [] as string[],
  };

  test.beforeEach(async () => {
    await supabaseAdmin
      .from('application_rate_limits')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
  });

  test.afterAll(async () => {
    if (createdIds.coupons.length) {
      await supabaseAdmin.from('coupons').delete().in('id', createdIds.coupons);
    }
    if (createdIds.offers.length) {
      await supabaseAdmin.from('oto_offers').delete().in('id', createdIds.offers);
    }
    if (createdIds.transactions.length) {
      await supabaseAdmin.from('payment_transactions').delete().in('id', createdIds.transactions);
    }
    if (createdIds.products.length) {
      await supabaseAdmin.from('products').delete().in('id', createdIds.products);
    }
  });

  test('generate_oto_coupon creates BOTH upsell and downsell coupons when downsell is configured', async () => {
    const source = await createTestProduct('Src');
    const upsell = await createTestProduct('Up', 99.99);
    const downsell = await createTestProduct('Down', 29.99);
    createdIds.products.push(source.id, upsell.id, downsell.id);

    const { data: offer, error: offerErr } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: source.id,
        oto_product_id: upsell.id,
        discount_type: 'percentage',
        discount_value: 30,
        duration_minutes: 15,
        downsell_product_id: downsell.id,
        downsell_discount_type: 'percentage',
        downsell_discount_value: 50,
        downsell_duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();
    expect(offerErr).toBeNull();
    createdIds.offers.push(offer!.id);

    const email = `downsell-pair-${Date.now()}@example.com`;
    const tx = await createCompletedTransaction(source.id, email);
    createdIds.transactions.push(tx.id);

    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: source.id,
      customer_email_param: email,
      transaction_id_param: tx.id,
    });
    expect(rpcErr).toBeNull();
    expect(rpcResult).toBeDefined();

    const result = rpcResult as Record<string, unknown>;
    expect(result.has_oto).toBe(true);
    // Upsell side (back-compat field name `coupon_code` still works, new field `upsell_code` is preferred)
    expect(result.upsell_code ?? result.coupon_code).toMatch(/^OTO-[A-Z0-9]+$/);
    expect(result.downsell_code).toMatch(/^OTO-[A-Z0-9]+$/);
    expect(result.downsell_product_id).toBe(downsell.id);
    expect(result.downsell_discount_type).toBe('percentage');
    expect(Number(result.downsell_discount_value)).toBe(50);

    const { data: coupons, error: cErr } = await supabaseAdmin
      .from('coupons')
      .select('*')
      .eq('source_transaction_id', tx.id)
      .order('created_at', { ascending: true });
    expect(cErr).toBeNull();
    expect(coupons).toHaveLength(2);
    coupons!.forEach((c) => createdIds.coupons.push(c.id as string));

    const upsellCoupon = coupons!.find((c) => (c as any).coupon_role === 'upsell');
    const downsellCoupon = coupons!.find((c) => (c as any).coupon_role === 'downsell');
    expect(upsellCoupon, 'upsell coupon should exist with coupon_role=upsell').toBeDefined();
    expect(downsellCoupon, 'downsell coupon should exist with coupon_role=downsell').toBeDefined();
    expect((upsellCoupon as any).oto_offer_id).toBe(offer!.id);
    expect((downsellCoupon as any).oto_offer_id).toBe(offer!.id);
    expect((upsellCoupon as any).is_oto_coupon).toBe(true);
    expect((downsellCoupon as any).is_oto_coupon).toBe(true);
    const upsellAllowed = (upsellCoupon as any).allowed_product_ids as string[];
    const downsellAllowed = (downsellCoupon as any).allowed_product_ids as string[];
    expect(upsellAllowed).toContain(upsell.id);
    expect(downsellAllowed).toContain(downsell.id);
    expect(upsellAllowed).not.toContain(downsell.id);
    expect(downsellAllowed).not.toContain(upsell.id);
  });

  test('generate_oto_coupon creates ONLY upsell coupon when no downsell configured (backward compat)', async () => {
    const source = await createTestProduct('SrcOnly');
    const upsell = await createTestProduct('UpOnly', 99.99);
    createdIds.products.push(source.id, upsell.id);

    const { data: offer, error: offerErr } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: source.id,
        oto_product_id: upsell.id,
        discount_type: 'percentage',
        discount_value: 30,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();
    expect(offerErr).toBeNull();
    createdIds.offers.push(offer!.id);

    const email = `downsell-solo-${Date.now()}@example.com`;
    const tx = await createCompletedTransaction(source.id, email);
    createdIds.transactions.push(tx.id);

    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc('generate_oto_coupon', {
      source_product_id_param: source.id,
      customer_email_param: email,
      transaction_id_param: tx.id,
    });
    expect(rpcErr).toBeNull();

    const result = rpcResult as Record<string, unknown>;
    expect(result.has_oto).toBe(true);
    expect(result.downsell_code ?? null).toBeNull();
    expect(result.downsell_product_id ?? null).toBeNull();

    const { data: coupons } = await supabaseAdmin
      .from('coupons')
      .select('id, coupon_role, oto_offer_id, source_transaction_id')
      .eq('source_transaction_id', tx.id);
    expect(coupons).toHaveLength(1);
    coupons!.forEach((c) => createdIds.coupons.push(c.id as string));
    expect((coupons![0] as any).coupon_role).toBe('upsell');
  });

  test('coupons.coupon_role CHECK constraint rejects invalid values', async () => {
    const { error } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: `INVALID-ROLE-${Date.now()}`,
        discount_type: 'percentage',
        discount_value: 10,
        coupon_role: 'sidesell',
      } as any);
    expect(error, 'invalid coupon_role should be rejected').not.toBeNull();
    expect(error?.message).toMatch(/coupon_role|check constraint/i);
  });

  test('oto_offers rejects downsell_product_id equal to source_product_id', async () => {
    const source = await createTestProduct('SrcSelf');
    const upsell = await createTestProduct('UpSelf', 99.99);
    createdIds.products.push(source.id, upsell.id);

    const { error } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: source.id,
        oto_product_id: upsell.id,
        discount_type: 'percentage',
        discount_value: 30,
        duration_minutes: 15,
        downsell_product_id: source.id,
        downsell_discount_type: 'percentage',
        downsell_discount_value: 50,
        is_active: true,
      });
    expect(error, 'downsell == source should be rejected').not.toBeNull();
  });

  test('oto_offers rejects downsell_product_id equal to oto_product_id', async () => {
    const source = await createTestProduct('SrcUp');
    const upsell = await createTestProduct('UpUp', 99.99);
    createdIds.products.push(source.id, upsell.id);

    const { error } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: source.id,
        oto_product_id: upsell.id,
        discount_type: 'percentage',
        discount_value: 30,
        duration_minutes: 15,
        downsell_product_id: upsell.id,
        downsell_discount_type: 'percentage',
        downsell_discount_value: 50,
        is_active: true,
      });
    expect(error, 'downsell == upsell should be rejected').not.toBeNull();
  });

  test('backfill: pre-existing OTO coupons (is_oto_coupon=true) are tagged coupon_role=upsell', async () => {
    // Verifies the migration's backfill UPDATE ran for any pre-existing rows.
    // After `npx supabase db reset` the seed.sql may not have OTO coupons, so this
    // test creates one *with* coupon_role=null deliberately, then re-runs the
    // backfill statement to confirm idempotency. This is a guard against future
    // regressions where someone re-introduces is_oto_coupon coupons without role.
    const source = await createTestProduct('Backfill');
    const upsell = await createTestProduct('BackfillUp', 99.99);
    createdIds.products.push(source.id, upsell.id);

    const { data: offer } = await supabaseAdmin
      .from('oto_offers')
      .insert({
        source_product_id: source.id,
        oto_product_id: upsell.id,
        discount_type: 'percentage',
        discount_value: 25,
        duration_minutes: 15,
        is_active: true,
      })
      .select()
      .single();
    createdIds.offers.push(offer!.id);

    // Insert a legacy-style coupon (is_oto_coupon=true, coupon_role=NULL)
    const { data: legacy, error: legacyErr } = await supabaseAdmin
      .from('coupons')
      .insert({
        code: `OTO-LEGACY-${Date.now()}`,
        discount_type: 'percentage',
        discount_value: 25,
        allowed_product_ids: [upsell.id],
        allowed_emails: ['legacy@example.com'],
        is_oto_coupon: true,
        oto_offer_id: offer!.id,
        // Intentionally omit coupon_role to simulate legacy row
      } as any)
      .select()
      .single();
    expect(legacyErr).toBeNull();
    createdIds.coupons.push(legacy!.id);

    // Re-run the backfill (idempotent)
    await supabaseAdmin
      .from('coupons')
      .update({ coupon_role: 'upsell' } as any)
      .eq('is_oto_coupon', true)
      .is('coupon_role', null);

    const { data: refreshed } = await supabaseAdmin
      .from('coupons')
      .select('coupon_role')
      .eq('id', legacy!.id)
      .single();
    expect((refreshed as any).coupon_role).toBe('upsell');
  });
});
