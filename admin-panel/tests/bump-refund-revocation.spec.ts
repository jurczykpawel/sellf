import { test, expect } from '@playwright/test';
import { supabaseAdmin } from './helpers/admin-auth';

/**
 * Bump Product Access Revocation on Refund — E2E Tests
 *
 * Tests the full cycle: purchase with bumps → verify access → refund → verify revocation.
 *
 * Uses the real database and the process_stripe_payment_completion_with_bump RPC
 * to create genuine payment_line_items, then simulates refund revocation directly
 * on the DB (same approach as refund-system.spec.ts — no real Stripe needed).
 *
 * The revokeTransactionAccess() service function runs in production code; here we
 * replicate its exact DB operations to verify the data model supports correct
 * revocation of main + bump products for both users and guests.
 *
 * @see src/lib/services/access-revocation.ts — shared revocation logic
 * @see tests/unit/lib/services/access-revocation.test.ts — unit tests with mocks
 */

test.describe.configure({ mode: 'serial' });

// ============================================================================
// TEST DATA
// ============================================================================

let TEST_USER: { id: string; email: string };

let mainProduct: { id: string; slug: string; name: string };
let bumpProduct1: { id: string; slug: string; name: string };
let bumpProduct2: { id: string; slug: string; name: string };

let orderBumpIds: string[] = [];
let allProductIds: string[] = [];

// ============================================================================
// HELPERS
// ============================================================================

function generateSessionId(prefix: string): string {
  return `cs_test_bumprefund_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getUserAccess(userId: string, productId: string) {
  const { data } = await supabaseAdmin
    .from('user_product_access')
    .select('*')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .maybeSingle();
  return data;
}

async function getGuestPurchase(email: string, productId: string) {
  const { data } = await supabaseAdmin
    .from('guest_purchases')
    .select('*')
    .eq('customer_email', email)
    .eq('product_id', productId)
    .maybeSingle();
  return data;
}

async function getLineItems(transactionId: string) {
  const { data } = await supabaseAdmin
    .from('payment_line_items')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('item_type', { ascending: true });
  return data || [];
}

/**
 * Call process_stripe_payment_completion_with_bump RPC.
 * Returns the transaction ID from payment_transactions.
 */
async function createPaymentViaRpc(params: {
  sessionId: string;
  productId: string;
  email: string;
  amountCents: number;
  userId?: string;
  bumpProductIds?: string[];
}): Promise<{ transactionId: string; result: any }> {
  const { data: result, error } = await supabaseAdmin.rpc('process_stripe_payment_completion_with_bump', {
    session_id_param: params.sessionId,
    product_id_param: params.productId,
    customer_email_param: params.email,
    amount_total: params.amountCents,
    currency_param: 'usd',
    stripe_payment_intent_id: `pi_test_${params.sessionId}`,
    user_id_param: params.userId || null,
    bump_product_ids_param: params.bumpProductIds || null,
    coupon_id_param: null,
  });

  if (error) throw new Error(`RPC failed: ${error.message}`);
  if (!result?.success) throw new Error(`RPC rejected: ${result?.error}`);

  // Get transaction ID
  const { data: tx } = await supabaseAdmin
    .from('payment_transactions')
    .select('id')
    .eq('session_id', params.sessionId)
    .single();

  if (!tx) throw new Error('Transaction not found after RPC');

  return { transactionId: tx.id, result };
}

/**
 * Simulate the exact revocation logic from revokeTransactionAccess().
 * This replicates what the production service does — directly against the real DB.
 */
async function simulateRevocation(params: {
  transactionId: string;
  userId: string | null;
  productId: string;
  sessionId: string | null;
}) {
  // 1. Query bump product IDs from payment_line_items
  const { data: bumpLineItems } = await supabaseAdmin
    .from('payment_line_items')
    .select('product_id')
    .eq('transaction_id', params.transactionId)
    .eq('item_type', 'order_bump');

  const bumpProductIds = (bumpLineItems ?? []).map((item: { product_id: string }) => item.product_id);

  // 2. Revoke user_product_access (main + bumps)
  if (params.userId && params.productId) {
    await supabaseAdmin
      .from('user_product_access')
      .delete()
      .eq('user_id', params.userId)
      .eq('product_id', params.productId);

    for (const bumpProductId of bumpProductIds) {
      await supabaseAdmin
        .from('user_product_access')
        .delete()
        .eq('user_id', params.userId)
        .eq('product_id', bumpProductId);
    }
  }

  // 3. Revoke guest_purchases (main + bumps)
  if (params.sessionId && params.productId) {
    await supabaseAdmin
      .from('guest_purchases')
      .delete()
      .eq('session_id', params.sessionId)
      .eq('product_id', params.productId);

    for (const bumpProductId of bumpProductIds) {
      await supabaseAdmin
        .from('guest_purchases')
        .delete()
        .eq('session_id', params.sessionId)
        .eq('product_id', bumpProductId);
    }
  }

  return { bumpProductIds };
}

async function cleanupPayment(sessionId: string) {
  // Line items cascade from transaction deletion
  await supabaseAdmin.from('guest_purchases').delete().eq('session_id', sessionId);
  await supabaseAdmin.from('payment_transactions').delete().eq('session_id', sessionId);
}

// ============================================================================
// GLOBAL SETUP & TEARDOWN
// ============================================================================

test.beforeAll(async () => {
  const ts = Date.now();

  // Clear rate limits
  await supabaseAdmin.from('rate_limits').delete().neq('function_name', '');

  // Create test user
  const email = `bump-refund-${ts}@test.local`;
  const { data: { user }, error: userErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: 'TestPassword123!',
    email_confirm: true,
  });
  if (userErr) throw userErr;
  TEST_USER = { id: user!.id, email };

  // Main product
  const { data: main, error: mainErr } = await supabaseAdmin.from('products').insert({
    name: `Bump Refund Main ${ts}`,
    slug: `br-main-${ts}`,
    price: 99.00,
    currency: 'USD',
    is_active: true,
  }).select().single();
  if (mainErr) throw mainErr;
  mainProduct = { id: main.id, slug: main.slug, name: main.name };
  allProductIds.push(main.id);

  // Bump product 1
  const { data: b1, error: b1Err } = await supabaseAdmin.from('products').insert({
    name: `BR Bump1 ${ts}`,
    slug: `br-bump1-${ts}`,
    price: 49.00,
    currency: 'USD',
    is_active: true,
  }).select().single();
  if (b1Err) throw b1Err;
  bumpProduct1 = { id: b1.id, slug: b1.slug, name: b1.name };
  allProductIds.push(b1.id);

  // Bump product 2
  const { data: b2, error: b2Err } = await supabaseAdmin.from('products').insert({
    name: `BR Bump2 ${ts}`,
    slug: `br-bump2-${ts}`,
    price: 29.00,
    currency: 'USD',
    is_active: true,
  }).select().single();
  if (b2Err) throw b2Err;
  bumpProduct2 = { id: b2.id, slug: b2.slug, name: b2.name };
  allProductIds.push(b2.id);

  // Order bump relationships
  const bumps = [
    { main_product_id: main.id, bump_product_id: b1.id, bump_title: 'Add Bump 1', bump_price: 19.00, display_order: 0, is_active: true },
    { main_product_id: main.id, bump_product_id: b2.id, bump_title: 'Add Bump 2', bump_price: 9.00, display_order: 1, is_active: true },
  ];

  for (const bump of bumps) {
    const { data: ob, error: obErr } = await supabaseAdmin.from('order_bumps').insert(bump).select().single();
    if (obErr) throw obErr;
    orderBumpIds.push(ob.id);
  }
});

test.afterAll(async () => {
  // Delete user access
  if (TEST_USER?.id) {
    await supabaseAdmin.from('user_product_access').delete().eq('user_id', TEST_USER.id);
    await supabaseAdmin.from('payment_transactions').delete().eq('user_id', TEST_USER.id);
  }

  // Delete order bumps
  for (const obId of orderBumpIds) {
    await supabaseAdmin.from('order_bumps').delete().eq('id', obId);
  }

  // Delete products (cascades related data)
  for (const productId of allProductIds) {
    await supabaseAdmin.from('payment_line_items').delete().eq('product_id', productId);
    await supabaseAdmin.from('guest_purchases').delete().eq('product_id', productId);
    await supabaseAdmin.from('payment_transactions').delete().eq('product_id', productId);
    await supabaseAdmin.from('products').delete().eq('id', productId);
  }

  // Delete test user
  if (TEST_USER?.id) {
    await supabaseAdmin.from('profiles').delete().eq('id', TEST_USER.id);
    await supabaseAdmin.auth.admin.deleteUser(TEST_USER.id);
  }
});

// ============================================================================
// LOGGED-IN USER: Refund Revokes Bump Access
// ============================================================================

test.describe('Bump Access Revocation on Refund — Logged-in User', () => {
  test.afterEach(async () => {
    // Clean user access between tests
    for (const pid of allProductIds) {
      await supabaseAdmin.from('user_product_access').delete()
        .eq('user_id', TEST_USER.id).eq('product_id', pid);
    }
  });

  test('full refund revokes main + all bump product access', async () => {
    const sessionId = generateSessionId('user_full');
    // main=$99, bump1=$19, bump2=$9 → total=$127 → 12700 cents
    const totalCents = (99 + 19 + 9) * 100;

    try {
      // 1. Create payment with 2 bumps
      const { transactionId } = await createPaymentViaRpc({
        sessionId,
        productId: mainProduct.id,
        email: TEST_USER.email,
        amountCents: totalCents,
        userId: TEST_USER.id,
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id],
      });

      // 2. Verify access granted for all 3 products
      const mainBefore = await getUserAccess(TEST_USER.id, mainProduct.id);
      expect(mainBefore).toBeTruthy();

      const bump1Before = await getUserAccess(TEST_USER.id, bumpProduct1.id);
      expect(bump1Before).toBeTruthy();

      const bump2Before = await getUserAccess(TEST_USER.id, bumpProduct2.id);
      expect(bump2Before).toBeTruthy();

      // Verify payment_line_items created (3 items)
      const lineItems = await getLineItems(transactionId);
      expect(lineItems).toHaveLength(3);
      expect(lineItems.filter((i: any) => i.item_type === 'order_bump')).toHaveLength(2);

      // 3. Simulate full refund → revoke access
      await supabaseAdmin.from('payment_transactions').update({
        status: 'refunded',
        refund_id: `re_test_${Date.now()}`,
        refunded_amount: totalCents,
        refunded_at: new Date().toISOString(),
      }).eq('id', transactionId);

      const { bumpProductIds } = await simulateRevocation({
        transactionId,
        userId: TEST_USER.id,
        productId: mainProduct.id,
        sessionId: null,
      });

      expect(bumpProductIds).toHaveLength(2);

      // 4. Verify ALL access revoked
      const mainAfter = await getUserAccess(TEST_USER.id, mainProduct.id);
      expect(mainAfter).toBeNull();

      const bump1After = await getUserAccess(TEST_USER.id, bumpProduct1.id);
      expect(bump1After).toBeNull();

      const bump2After = await getUserAccess(TEST_USER.id, bumpProduct2.id);
      expect(bump2After).toBeNull();
    } finally {
      await cleanupPayment(sessionId);
    }
  });

  test('revocation with 1 bump only revokes that bump, not others', async () => {
    const sessionId = generateSessionId('user_1bump');
    // Only bump1 purchased: main=$99, bump1=$19 → 11800 cents
    const totalCents = (99 + 19) * 100;

    try {
      const { transactionId } = await createPaymentViaRpc({
        sessionId,
        productId: mainProduct.id,
        email: TEST_USER.email,
        amountCents: totalCents,
        userId: TEST_USER.id,
        bumpProductIds: [bumpProduct1.id],
      });

      // Grant bump2 access separately (simulating a different purchase)
      await supabaseAdmin.from('user_product_access').upsert({
        user_id: TEST_USER.id,
        product_id: bumpProduct2.id,
        access_granted_at: new Date().toISOString(),
      }, { onConflict: 'user_id,product_id' });

      // Verify: main, bump1, bump2 all have access
      expect(await getUserAccess(TEST_USER.id, mainProduct.id)).toBeTruthy();
      expect(await getUserAccess(TEST_USER.id, bumpProduct1.id)).toBeTruthy();
      expect(await getUserAccess(TEST_USER.id, bumpProduct2.id)).toBeTruthy();

      // Simulate refund → revokes main + bump1 only
      const { bumpProductIds } = await simulateRevocation({
        transactionId,
        userId: TEST_USER.id,
        productId: mainProduct.id,
        sessionId: null,
      });

      expect(bumpProductIds).toHaveLength(1);
      expect(bumpProductIds[0]).toBe(bumpProduct1.id);

      // Main: revoked
      expect(await getUserAccess(TEST_USER.id, mainProduct.id)).toBeNull();
      // Bump1: revoked (was part of this transaction)
      expect(await getUserAccess(TEST_USER.id, bumpProduct1.id)).toBeNull();
      // Bump2: STILL has access (separate purchase, not in this transaction's line_items)
      expect(await getUserAccess(TEST_USER.id, bumpProduct2.id)).toBeTruthy();
    } finally {
      await cleanupPayment(sessionId);
    }
  });

  test('revocation without bumps only revokes main product', async () => {
    const sessionId = generateSessionId('user_nobumps');
    const totalCents = 99 * 100;

    try {
      const { transactionId } = await createPaymentViaRpc({
        sessionId,
        productId: mainProduct.id,
        email: TEST_USER.email,
        amountCents: totalCents,
        userId: TEST_USER.id,
      });

      expect(await getUserAccess(TEST_USER.id, mainProduct.id)).toBeTruthy();

      // No bumps → payment_line_items has only 1 main_product row
      const lineItems = await getLineItems(transactionId);
      expect(lineItems).toHaveLength(1);
      expect(lineItems[0].item_type).toBe('main_product');

      const { bumpProductIds } = await simulateRevocation({
        transactionId,
        userId: TEST_USER.id,
        productId: mainProduct.id,
        sessionId: null,
      });

      expect(bumpProductIds).toHaveLength(0);
      expect(await getUserAccess(TEST_USER.id, mainProduct.id)).toBeNull();
    } finally {
      await cleanupPayment(sessionId);
    }
  });
});

// ============================================================================
// GUEST USER: Refund Revokes Bump Guest Purchases
// ============================================================================

test.describe('Bump Access Revocation on Refund — Guest User', () => {
  test('full refund revokes main guest_purchase (bumps tracked via payment_line_items)', async () => {
    const sessionId = generateSessionId('guest_full');
    const guestEmail = `guest-bumprefund-${Date.now()}@example.com`;
    const totalCents = (99 + 19 + 9) * 100;

    try {
      const { transactionId } = await createPaymentViaRpc({
        sessionId,
        productId: mainProduct.id,
        email: guestEmail,
        amountCents: totalCents,
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id],
      });

      // DB design: only ONE guest_purchases row per session (main product).
      // Bump products are tracked via payment_line_items, not separate guest_purchases rows.
      // guest_purchases.session_id has a UNIQUE constraint enforcing this.
      const mainGp = await getGuestPurchase(guestEmail, mainProduct.id);
      expect(mainGp, 'RPC should create main guest_purchase for guest checkout').toBeTruthy();

      // Verify payment_line_items exist for bumps (used by claim_guest_purchases_for_user)
      const lineItems = await getLineItems(transactionId);
      const bumpItems = lineItems.filter((i: any) => i.item_type === 'order_bump');
      expect(bumpItems).toHaveLength(2);

      // Simulate revocation
      await simulateRevocation({
        transactionId,
        userId: null,
        productId: mainProduct.id,
        sessionId,
      });

      // Verify main guest_purchase revoked
      expect(await getGuestPurchase(guestEmail, mainProduct.id)).toBeNull();

      // payment_line_items remain as historical records — revocation doesn't delete them
      const lineItemsAfter = await getLineItems(transactionId);
      expect(lineItemsAfter.filter((i: any) => i.item_type === 'order_bump')).toHaveLength(2);
    } finally {
      await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', guestEmail);
      await cleanupPayment(sessionId);
    }
  });
});

// ============================================================================
// PAYMENT LINE ITEMS INTEGRITY
// ============================================================================

test.describe('Bump Revocation — payment_line_items data integrity', () => {
  test.afterEach(async () => {
    for (const pid of allProductIds) {
      await supabaseAdmin.from('user_product_access').delete()
        .eq('user_id', TEST_USER.id).eq('product_id', pid);
    }
  });

  test('payment_line_items persist after revocation (audit trail)', async () => {
    const sessionId = generateSessionId('audit_trail');
    const totalCents = (99 + 19) * 100;

    try {
      const { transactionId } = await createPaymentViaRpc({
        sessionId,
        productId: mainProduct.id,
        email: TEST_USER.email,
        amountCents: totalCents,
        userId: TEST_USER.id,
        bumpProductIds: [bumpProduct1.id],
      });

      // Line items before revocation
      const lineItemsBefore = await getLineItems(transactionId);
      expect(lineItemsBefore).toHaveLength(2);

      // Revoke access
      await simulateRevocation({
        transactionId,
        userId: TEST_USER.id,
        productId: mainProduct.id,
        sessionId: null,
      });

      // Line items should STILL exist (they're the audit trail / receipt)
      const lineItemsAfter = await getLineItems(transactionId);
      expect(lineItemsAfter).toHaveLength(2);
      expect(lineItemsAfter[0].product_id).toBeTruthy();
      expect(lineItemsAfter[1].product_id).toBeTruthy();
    } finally {
      await cleanupPayment(sessionId);
    }
  });

  test('revocation is idempotent — calling twice does not error', async () => {
    const sessionId = generateSessionId('idempotent');
    const totalCents = (99 + 19 + 9) * 100;

    try {
      const { transactionId } = await createPaymentViaRpc({
        sessionId,
        productId: mainProduct.id,
        email: TEST_USER.email,
        amountCents: totalCents,
        userId: TEST_USER.id,
        bumpProductIds: [bumpProduct1.id, bumpProduct2.id],
      });

      // First revocation
      await simulateRevocation({
        transactionId,
        userId: TEST_USER.id,
        productId: mainProduct.id,
        sessionId: null,
      });

      // All revoked
      expect(await getUserAccess(TEST_USER.id, mainProduct.id)).toBeNull();
      expect(await getUserAccess(TEST_USER.id, bumpProduct1.id)).toBeNull();

      // Second revocation — should not throw
      await simulateRevocation({
        transactionId,
        userId: TEST_USER.id,
        productId: mainProduct.id,
        sessionId: null,
      });

      // Still revoked, no errors
      expect(await getUserAccess(TEST_USER.id, mainProduct.id)).toBeNull();
      expect(await getUserAccess(TEST_USER.id, bumpProduct1.id)).toBeNull();
      expect(await getUserAccess(TEST_USER.id, bumpProduct2.id)).toBeNull();
    } finally {
      await cleanupPayment(sessionId);
    }
  });
});
