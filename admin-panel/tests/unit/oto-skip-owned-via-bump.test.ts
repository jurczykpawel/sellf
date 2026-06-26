/**
 * generate_oto_coupon must NOT re-offer the OTO product to a customer who
 * already owns it — including the case where a GUEST bought the OTO product as
 * an order bump. The completion RPC only writes the MAIN product into
 * guest_purchases; a guest's bump lands solely in payment_line_items
 * (item_type='order_bump'). The pre-existing ownership checks (Check 1:
 * user_product_access via auth.users.email; Check 2: guest_purchases) miss that
 * row, so a third check reads payment_line_items by email.
 *
 * Behavioral test against the local Supabase DB (same service-role harness as
 * product-vat-defaults-inherit.test.ts). All rows created here are cleaned up.
 *
 * @see supabase/migrations/20260625010000_product_vat_defaults_inherit.sql
 * @see supabase/migrations/20260515110000_funnel_downsell_and_attribution.sql
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const newEmail = () => `oto-bump-test-${uniq()}@example.com`;

async function createProduct(suffix: string): Promise<string> {
  const u = uniq();
  const { data, error } = await admin
    .from('products')
    .insert({
      name: `OTO bump test ${suffix} ${u}`,
      slug: `oto-bump-${suffix}-${u}`,
      price: 25,
      currency: 'USD',
      is_active: true,
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

describe('generate_oto_coupon skips OTO when product already owned via order bump', () => {
  // Track everything we insert so afterEach can tear it down deterministically.
  const productIds: string[] = [];
  const offerIds: string[] = [];
  const txnIds: string[] = [];
  const emails: string[] = [];

  async function setupOffer(): Promise<{ source: string; oto: string; offer: string }> {
    const source = await createProduct('src');
    const oto = await createProduct('oto');
    productIds.push(source, oto);

    const { data, error } = await admin
      .from('oto_offers')
      .insert({
        source_product_id: source,
        oto_product_id: oto,
        discount_type: 'percentage',
        discount_value: 20,
        duration_minutes: 15,
        is_active: true,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    offerIds.push(data!.id);
    return { source, oto, offer: data!.id as string };
  }

  async function insertCompletedTxn(email: string, productId: string): Promise<string> {
    const { data, error } = await admin
      .from('payment_transactions')
      .insert({
        session_id: `cs_test_${uniq().replace(/[^a-zA-Z0-9_]/g, '')}`,
        user_id: null,
        product_id: productId,
        customer_email: email,
        amount: 25,
        currency: 'USD',
        status: 'completed',
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    txnIds.push(data!.id);
    return data!.id as string;
  }

  afterEach(async () => {
    // Coupons minted as a side effect of the control case (no FK to our rows).
    for (const email of emails) {
      await admin.from('coupons').delete().contains('allowed_emails', [email]);
    }
    emails.length = 0;
    // line_items + guest_purchases + user_product_access cascade off these.
    if (txnIds.length) await admin.from('payment_transactions').delete().in('id', txnIds);
    txnIds.length = 0;
    if (offerIds.length) await admin.from('oto_offers').delete().in('id', offerIds);
    offerIds.length = 0;
    if (productIds.length) await admin.from('products').delete().in('id', productIds);
    productIds.length = 0;
  });

  it('skips the OTO when a guest bought the OTO product as an order bump', async () => {
    const { source, oto } = await setupOffer();
    const email = newEmail();
    emails.push(email);

    // Guest bought the SOURCE product; the OTO product rode along as a bump.
    // Per the completion RPC, the guest's bump is recorded ONLY in line_items.
    const txn = await insertCompletedTxn(email, source);
    const { error: liErr } = await admin.from('payment_line_items').insert({
      transaction_id: txn,
      product_id: oto,
      item_type: 'order_bump',
      quantity: 1,
      unit_price: 25,
      total_price: 25,
      currency: 'USD',
    });
    expect(liErr).toBeNull();

    const { data, error } = await admin.rpc('generate_oto_coupon', {
      source_product_id_param: source,
      customer_email_param: email,
      transaction_id_param: txn,
    });
    expect(error).toBeNull();
    expect(data.has_oto).toBe(false);
    expect(data.reason).toBe('already_owns_oto_product');
  });

  it('offers the OTO when there is no prior ownership (control)', async () => {
    const { source } = await setupOffer();
    const email = newEmail();
    emails.push(email); // afterEach deletes the coupon this call mints.

    const { data, error } = await admin.rpc('generate_oto_coupon', {
      source_product_id_param: source,
      customer_email_param: email,
      transaction_id_param: null,
    });
    expect(error).toBeNull();
    expect(data.has_oto).toBe(true);
  });

  it('skips the OTO when a logged-in customer already owns it via user_product_access (Check 1)', async () => {
    const { source, oto } = await setupOffer();
    const email = newEmail();
    emails.push(email);

    // Create an auth user with this email, then grant them the OTO product.
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    expect(userErr).toBeNull();
    const userId = userData!.user!.id;

    const { error: upaErr } = await admin.from('user_product_access').insert({
      user_id: userId,
      product_id: oto,
      access_granted_at: new Date().toISOString(),
    });
    expect(upaErr).toBeNull();

    const { data, error } = await admin.rpc('generate_oto_coupon', {
      source_product_id_param: source,
      customer_email_param: email,
      transaction_id_param: null,
    });
    expect(error).toBeNull();
    expect(data.has_oto).toBe(false);
    expect(data.reason).toBe('already_owns_oto_product');

    // Tidy up the auth user (cascades user_product_access).
    await admin.auth.admin.deleteUser(userId);
  });

  afterAll(async () => {
    // Belt-and-suspenders: nothing should remain, but guard against a failed
    // assertion short-circuiting afterEach mid-run.
    if (txnIds.length) await admin.from('payment_transactions').delete().in('id', txnIds);
    if (offerIds.length) await admin.from('oto_offers').delete().in('id', offerIds);
    if (productIds.length) await admin.from('products').delete().in('id', productIds);
  });
});
