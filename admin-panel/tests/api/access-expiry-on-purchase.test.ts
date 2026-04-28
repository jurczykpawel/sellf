/**
 * API Integration Tests: access_expires_at semantics on purchase RPC
 *
 * Drives `public.process_stripe_payment_completion_with_bump` directly with
 * the service-role client. The Stripe webhook is the only production caller
 * of this RPC and passes the same arguments — so validating the RPC's expiry
 * arithmetic is equivalent to validating what the webhook persists.
 *
 * Scenarios (8 total):
 *
 *   Main product:
 *     1. product unlimited (auto_grant_duration_days = NULL)
 *        → user_product_access.access_expires_at = NULL
 *     2. product limited 30d
 *        → access_expires_at ≈ NOW() + 30d
 *
 *   Order bump (3 modes × 2 product states = 6 combos):
 *     3. bump default + product unlimited            → NULL
 *     4. bump default + product 30d                  → NOW() + 30d
 *     5. bump custom 14d + product unlimited         → NOW() + 14d (override)
 *     6. bump custom 14d + product 30d               → NOW() + 14d (override)
 *     7. bump unlimited (0) + product 30d            → NULL (override)
 *     8. bump unlimited (0) + product unlimited      → NULL
 *
 * Encoding of order_bumps.access_duration_days:
 *   NULL → "Use default for product"   (fall back to bump product's auto_grant_duration_days)
 *      0 → "Unlimited override"        (force NULL access_expires_at)
 *    N>0 → "Custom override (N days)"
 *
 * Run: bun run test:api  (requires `npx supabase start` + `PORT=3777 bun run dev`).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in test env');
}

const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface CreatedProduct {
  id: string;
  slug: string;
  price: number;
  auto_grant_duration_days: number | null;
}

async function createProduct(opts: {
  suffix: string;
  price?: number;
  autoGrantDurationDays: number | null;
}): Promise<CreatedProduct> {
  const slug = `expiry-rpc-${opts.suffix}-${TEST_ID}`;
  const price = opts.price ?? 10;
  const { data, error } = await supabaseAdmin
    .schema('seller_main' as never)
    .from('products')
    .insert({
      name: `Expiry RPC ${opts.suffix}`,
      slug,
      price,
      currency: 'USD',
      is_active: true,
      auto_grant_duration_days: opts.autoGrantDurationDays,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createProduct(${opts.suffix}) failed: ${error.message}`);
  return { id: data.id, slug, price, auto_grant_duration_days: opts.autoGrantDurationDays };
}

async function createOrderBump(opts: {
  mainProductId: string;
  bumpProductId: string;
  accessDurationDays: number | null;
}): Promise<string> {
  const { data, error } = await supabaseAdmin
    .schema('seller_main' as never)
    .from('order_bumps')
    .insert({
      main_product_id: opts.mainProductId,
      bump_product_id: opts.bumpProductId,
      bump_title: `Test bump ${opts.bumpProductId.slice(0, 8)}`,
      is_active: true,
      access_duration_days: opts.accessDurationDays,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createOrderBump failed: ${error.message}`);
  return data.id;
}

async function clearAccess(userId: string, productId: string) {
  await supabaseAdmin
    .schema('seller_main' as never)
    .from('user_product_access')
    .delete()
    .eq('user_id', userId)
    .eq('product_id', productId);
}

async function readAccess(userId: string, productId: string) {
  const { data, error } = await supabaseAdmin
    .schema('seller_main' as never)
    .from('user_product_access')
    .select('access_granted_at, access_expires_at, access_duration_days')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .maybeSingle();
  if (error) throw new Error(`readAccess failed: ${error.message}`);
  return data;
}

interface RpcResult {
  success: boolean;
  scenario?: string;
  error?: string;
}

async function callPurchaseRpc(opts: {
  mainProductId: string;
  mainProductPrice: number;
  bumpProductIds?: string[];
  bumpTotalPrice?: number;
  userId: string;
  customerEmail: string;
}): Promise<RpcResult> {
  // RPC enforces format ^(cs_|pi_)[a-zA-Z0-9_]+$ — strip hyphens from IDs.
  const safeId = TEST_ID.replace(/-/g, '_');
  const rand = Math.random().toString(36).slice(2, 10);
  const sessionId = `cs_test_${safeId}_${rand}`;
  const paymentIntentId = `pi_test_${safeId}_${rand}`;
  const totalDollars = opts.mainProductPrice + (opts.bumpTotalPrice ?? 0);
  const amountTotal = Math.round(totalDollars * 100);

  const { data, error } = await supabaseAdmin.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: sessionId,
    product_id_param: opts.mainProductId,
    customer_email_param: opts.customerEmail,
    amount_total: amountTotal,
    currency_param: 'USD',
    stripe_payment_intent_id: paymentIntentId,
    user_id_param: opts.userId,
    bump_product_ids_param: opts.bumpProductIds && opts.bumpProductIds.length > 0 ? opts.bumpProductIds : null,
  });
  if (error) throw new Error(`RPC error: ${error.message}`);
  return data as RpcResult;
}

/** assert that `expires` is within ±30s of NOW()+expectedDays */
function assertWithinDays(expires: string | null, expectedDays: number) {
  expect(expires).not.toBeNull();
  const expiresMs = new Date(expires!).getTime();
  const expectedMs = Date.now() + expectedDays * 24 * 60 * 60 * 1000;
  const drift = Math.abs(expiresMs - expectedMs);
  expect(drift).toBeLessThan(30_000); // 30s tolerance
}

describe('process_stripe_payment_completion_with_bump — access_expires_at semantics', () => {
  const userEmail = `expiry-rpc-${TEST_ID}@example.com`;
  let userId: string;

  // Main products
  let pMainUnlimited: CreatedProduct;     // for scenarios 1, 3, 5, 8 (and reused as main for bumps)
  let pMainLimited30: CreatedProduct;     // for scenario 2

  // Bump products (one per bump scenario, attached to pMainUnlimited via order_bumps)
  let pBump3: CreatedProduct;             // auto_grant=null, override=null
  let pBump4: CreatedProduct;             // auto_grant=30, override=null
  let pBump5: CreatedProduct;             // auto_grant=null, override=14
  let pBump6: CreatedProduct;             // auto_grant=30, override=14
  let pBump7: CreatedProduct;             // auto_grant=30, override=0 (unlimited)
  let pBump8: CreatedProduct;             // auto_grant=null, override=0 (unlimited)

  const orderBumpIds: string[] = [];

  beforeAll(async () => {
    // Create test user
    const { data: created, error: userErr } = await supabaseAdmin.auth.admin.createUser({
      email: userEmail,
      password: 'TestPassword123!',
      email_confirm: true,
    });
    if (userErr) throw userErr;
    userId = created.user!.id;

    // Main products
    pMainUnlimited = await createProduct({ suffix: 'main-unl', autoGrantDurationDays: null });
    pMainLimited30 = await createProduct({ suffix: 'main-30d', autoGrantDurationDays: 30 });

    // Bump products
    pBump3 = await createProduct({ suffix: 'b3-unl', price: 5, autoGrantDurationDays: null });
    pBump4 = await createProduct({ suffix: 'b4-30d', price: 5, autoGrantDurationDays: 30 });
    pBump5 = await createProduct({ suffix: 'b5-unl', price: 5, autoGrantDurationDays: null });
    pBump6 = await createProduct({ suffix: 'b6-30d', price: 5, autoGrantDurationDays: 30 });
    pBump7 = await createProduct({ suffix: 'b7-30d', price: 5, autoGrantDurationDays: 30 });
    pBump8 = await createProduct({ suffix: 'b8-unl', price: 5, autoGrantDurationDays: null });

    // Order bumps — all attached to pMainUnlimited so the main expiry assertion in scenario 1
    // is independent of subsequent bump tests (permanent access never downgrades).
    orderBumpIds.push(await createOrderBump({ mainProductId: pMainUnlimited.id, bumpProductId: pBump3.id, accessDurationDays: null }));
    orderBumpIds.push(await createOrderBump({ mainProductId: pMainUnlimited.id, bumpProductId: pBump4.id, accessDurationDays: null }));
    orderBumpIds.push(await createOrderBump({ mainProductId: pMainUnlimited.id, bumpProductId: pBump5.id, accessDurationDays: 14 }));
    orderBumpIds.push(await createOrderBump({ mainProductId: pMainUnlimited.id, bumpProductId: pBump6.id, accessDurationDays: 14 }));
    orderBumpIds.push(await createOrderBump({ mainProductId: pMainUnlimited.id, bumpProductId: pBump7.id, accessDurationDays: 0 }));
    orderBumpIds.push(await createOrderBump({ mainProductId: pMainUnlimited.id, bumpProductId: pBump8.id, accessDurationDays: 0 }));
  });

  afterAll(async () => {
    if (!userId) return;

    // user_product_access rows for this user
    await supabaseAdmin.schema('seller_main' as never).from('user_product_access').delete().eq('user_id', userId);

    // payment line items + transactions for this email
    const { data: txs } = await supabaseAdmin
      .schema('seller_main' as never)
      .from('payment_transactions')
      .select('id')
      .eq('customer_email', userEmail);
    if (txs && txs.length > 0) {
      const txIds = txs.map((t: { id: string }) => t.id);
      await supabaseAdmin.schema('seller_main' as never).from('payment_line_items').delete().in('transaction_id', txIds);
      await supabaseAdmin.schema('seller_main' as never).from('payment_transactions').delete().in('id', txIds);
    }
    await supabaseAdmin.schema('seller_main' as never).from('guest_purchases').delete().eq('customer_email', userEmail);

    for (const obId of orderBumpIds) {
      await supabaseAdmin.schema('seller_main' as never).from('order_bumps').delete().eq('id', obId);
    }
    const productIds = [pMainUnlimited, pMainLimited30, pBump3, pBump4, pBump5, pBump6, pBump7, pBump8]
      .filter(Boolean)
      .map((p) => p.id);
    for (const pid of productIds) {
      await supabaseAdmin.schema('seller_main' as never).from('products').delete().eq('id', pid);
    }

    await supabaseAdmin.auth.admin.deleteUser(userId);
  });

  // ===========================================================================
  // Main product (no bump) — drives the existing-and-known-good path.
  // ===========================================================================

  describe('main product purchase', () => {
    it('1. product unlimited → access_expires_at is NULL', async () => {
      await clearAccess(userId, pMainUnlimited.id);
      const result = await callPurchaseRpc({
        mainProductId: pMainUnlimited.id,
        mainProductPrice: pMainUnlimited.price,
        userId,
        customerEmail: userEmail,
      });
      expect(result.success).toBe(true);

      const access = await readAccess(userId, pMainUnlimited.id);
      expect(access).not.toBeNull();
      expect(access!.access_expires_at).toBeNull();
      expect(access!.access_duration_days).toBeNull();
    });

    it('2. product limited 30d → access_expires_at ≈ NOW() + 30d', async () => {
      await clearAccess(userId, pMainLimited30.id);
      const result = await callPurchaseRpc({
        mainProductId: pMainLimited30.id,
        mainProductPrice: pMainLimited30.price,
        userId,
        customerEmail: userEmail,
      });
      expect(result.success).toBe(true);

      const access = await readAccess(userId, pMainLimited30.id);
      expect(access).not.toBeNull();
      assertWithinDays(access!.access_expires_at, 30);
      expect(access!.access_duration_days).toBe(30);
    });
  });

  // ===========================================================================
  // Order bump — verifies override resolution per (bump.access_duration_days,
  // bumpProduct.auto_grant_duration_days). Six combinations.
  // ===========================================================================

  describe('order bump purchase — duration override resolution', () => {
    beforeEach(async () => {
      // Strip stale bump access for every bump product so the renewal/extension
      // path inside grant_product_access_service_role doesn't blur assertions.
      await Promise.all(
        [pBump3, pBump4, pBump5, pBump6, pBump7, pBump8].map((p) => clearAccess(userId, p.id)),
      );
    });

    it('3. bump.override=null + bumpProduct.auto_grant=null → NULL', async () => {
      const result = await callPurchaseRpc({
        mainProductId: pMainUnlimited.id,
        mainProductPrice: pMainUnlimited.price,
        bumpProductIds: [pBump3.id],
        bumpTotalPrice: pBump3.price,
        userId,
        customerEmail: userEmail,
      });
      expect(result.success).toBe(true);

      const access = await readAccess(userId, pBump3.id);
      expect(access).not.toBeNull();
      expect(access!.access_expires_at).toBeNull();
    });

    it('4. bump.override=null + bumpProduct.auto_grant=30 → NOW() + 30d', async () => {
      const result = await callPurchaseRpc({
        mainProductId: pMainUnlimited.id,
        mainProductPrice: pMainUnlimited.price,
        bumpProductIds: [pBump4.id],
        bumpTotalPrice: pBump4.price,
        userId,
        customerEmail: userEmail,
      });
      expect(result.success).toBe(true);

      const access = await readAccess(userId, pBump4.id);
      expect(access).not.toBeNull();
      assertWithinDays(access!.access_expires_at, 30);
    });

    it('5. bump.override=14 + bumpProduct.auto_grant=null → NOW() + 14d (override wins)', async () => {
      const result = await callPurchaseRpc({
        mainProductId: pMainUnlimited.id,
        mainProductPrice: pMainUnlimited.price,
        bumpProductIds: [pBump5.id],
        bumpTotalPrice: pBump5.price,
        userId,
        customerEmail: userEmail,
      });
      expect(result.success).toBe(true);

      const access = await readAccess(userId, pBump5.id);
      expect(access).not.toBeNull();
      assertWithinDays(access!.access_expires_at, 14);
    });

    it('6. bump.override=14 + bumpProduct.auto_grant=30 → NOW() + 14d (override wins)', async () => {
      const result = await callPurchaseRpc({
        mainProductId: pMainUnlimited.id,
        mainProductPrice: pMainUnlimited.price,
        bumpProductIds: [pBump6.id],
        bumpTotalPrice: pBump6.price,
        userId,
        customerEmail: userEmail,
      });
      expect(result.success).toBe(true);

      const access = await readAccess(userId, pBump6.id);
      expect(access).not.toBeNull();
      assertWithinDays(access!.access_expires_at, 14);
    });

    it('7. bump.override=0 (unlimited) + bumpProduct.auto_grant=30 → NULL (override wins)', async () => {
      const result = await callPurchaseRpc({
        mainProductId: pMainUnlimited.id,
        mainProductPrice: pMainUnlimited.price,
        bumpProductIds: [pBump7.id],
        bumpTotalPrice: pBump7.price,
        userId,
        customerEmail: userEmail,
      });
      expect(result.success).toBe(true);

      const access = await readAccess(userId, pBump7.id);
      expect(access).not.toBeNull();
      expect(access!.access_expires_at).toBeNull();
    });

    it('8. bump.override=0 (unlimited) + bumpProduct.auto_grant=null → NULL', async () => {
      const result = await callPurchaseRpc({
        mainProductId: pMainUnlimited.id,
        mainProductPrice: pMainUnlimited.price,
        bumpProductIds: [pBump8.id],
        bumpTotalPrice: pBump8.price,
        userId,
        customerEmail: userEmail,
      });
      expect(result.success).toBe(true);

      const access = await readAccess(userId, pBump8.id);
      expect(access).not.toBeNull();
      expect(access!.access_expires_at).toBeNull();
    });
  });
});
