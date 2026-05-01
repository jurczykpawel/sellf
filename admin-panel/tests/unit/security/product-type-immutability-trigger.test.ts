/**
 * DB-level guard for product_type immutability after first sale.
 *
 * Asserts the trigger `enforce_product_type_immutable_after_sale` is in
 * place and behaves correctly: the application-level check in
 * `src/lib/validations/product-type-guard.ts` is best-effort, the trigger
 * makes the invariant hold for every writer.
 *
 * REQUIRES: Supabase running locally (`npx supabase start`).
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const canRun = !!SUPABASE_URL && !!SERVICE_ROLE_KEY;

function getAllMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'))
    .join('\n');
}

describe('product_type immutability — DB trigger (static SQL grep)', () => {
  const allSql = getAllMigrationSql();

  it('defines the trigger function in seller_main schema', () => {
    expect(allSql).toMatch(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+seller_main\.enforce_product_type_immutable_after_sale\s*\(/i,
    );
  });

  it('trigger function uses SECURITY DEFINER + SET search_path = ""', () => {
    // Per Sellf SQL Rule #4 — every SECURITY DEFINER function must pin search_path.
    const re = new RegExp(
      String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+seller_main\.enforce_product_type_immutable_after_sale[\s\S]*?SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*''[\s\S]*?\$\$`,
      'i',
    );
    expect(allSql).toMatch(re);
  });

  it('attaches a BEFORE UPDATE trigger to seller_main.products', () => {
    // Match either form: `BEFORE UPDATE OF product_type ON ...` or
    // `BEFORE UPDATE ON ...` (the function self-guards on column delta).
    expect(allSql).toMatch(
      /CREATE\s+TRIGGER\s+\w+\s+BEFORE\s+UPDATE(?:\s+OF\s+product_type)?\s+ON\s+seller_main\.products/i,
    );
  });
});

describe.skipIf(!canRun)('product_type immutability — DB trigger (runtime)', () => {
  const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    db: { schema: 'seller_main' },
  });
  const platform: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const TS = Date.now();
  let createdAuthUserId = '';
  let cleanProductId = '';
  let soldProductId = '';

  beforeAll(async () => {
    // Materialize a real auth user so user_product_access FK doesn't blow up
    // when we exercise the access-row branch in another test variant later.
    const { data: u } = await platform.auth.admin.createUser({
      email: `pt-trigger-${TS}@sellf-test.local`,
      email_confirm: true,
    });
    createdAuthUserId = u?.user?.id ?? '';

    // Two products: one with no sold rows (clean) and one with a subscription row (sold).
    const clean = await supabaseAdmin
      .from('products')
      .insert({
        name: 'PT Trigger Clean',
        slug: `pt-trigger-clean-${TS}`,
        price: 0,
        currency: 'USD',
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 9.99,
      })
      .select('id')
      .single();
    if (clean.error) throw clean.error;
    cleanProductId = clean.data.id;

    const sold = await supabaseAdmin
      .from('products')
      .insert({
        name: 'PT Trigger Sold',
        slug: `pt-trigger-sold-${TS}`,
        price: 0,
        currency: 'USD',
        product_type: 'subscription',
        billing_interval: 'month',
        billing_interval_count: 1,
        recurring_price: 9.99,
      })
      .select('id')
      .single();
    if (sold.error) throw sold.error;
    soldProductId = sold.data.id;

    // Insert a subscriptions row referencing soldProductId so the trigger
    // has something to find.
    const sub = await supabaseAdmin.from('subscriptions').insert({
      user_id: createdAuthUserId,
      product_id: soldProductId,
      stripe_customer_id: `cus_pt_trigger_${TS}`,
      stripe_subscription_id: `sub_pt_trigger_${TS}`,
      stripe_price_id: `price_pt_trigger_${TS}`,
      status: 'active',
      cancel_at_period_end: false,
    });
    if (sub.error) throw sub.error;
  });

  afterAll(async () => {
    if (cleanProductId) {
      await supabaseAdmin.from('products').delete().eq('id', cleanProductId);
    }
    if (soldProductId) {
      await supabaseAdmin.from('subscriptions').delete().eq('product_id', soldProductId);
      await supabaseAdmin.from('products').delete().eq('id', soldProductId);
    }
    if (createdAuthUserId) {
      await platform.auth.admin.deleteUser(createdAuthUserId);
    }
  });

  it('allows non-product_type updates on a sold product', async () => {
    // Sanity: trigger must not fire for unrelated column changes.
    const { error } = await supabaseAdmin
      .from('products')
      .update({ name: 'PT Trigger Sold (renamed)' })
      .eq('id', soldProductId);
    expect(error).toBeNull();
  });

  it('allows product_type flip on a clean product (no sold rows)', async () => {
    const { error } = await supabaseAdmin
      .from('products')
      .update({ product_type: 'one_time' })
      .eq('id', cleanProductId);
    expect(error).toBeNull();
  });

  it('rejects product_type flip on a product with a subscription row', async () => {
    const { error } = await supabaseAdmin
      .from('products')
      .update({ product_type: 'one_time' })
      .eq('id', soldProductId);
    expect(error).not.toBeNull();
    // Trigger raises a clear, recognizable message regardless of SQLSTATE choice.
    expect(error?.message ?? '').toMatch(/product_type cannot be changed/i);
  });
});
