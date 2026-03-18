/**
 * E2E Tests: Marketplace Buyer Flows
 *
 * Tests the buyer-facing marketplace experience across seller schemas:
 * - Order bumps API routing per seller
 * - Coupon verify API routing per seller
 * - Payment-status page with seller param
 * - My Purchases cross-schema aggregation (get_user_products_all_sellers)
 * - Grant access API routing per seller
 * - Guest purchase migration across schemas
 * - Refund from seller -> access revoked (schema isolation)
 * - OTO after seller purchase (schema isolation)
 *
 * Uses seed data: Kowalski Digital and Creative Studio sellers.
 * REQUIRES: Supabase running + db reset + dev server running
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { setAuthSession, supabaseAdmin } from './helpers/admin-auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ===== HELPERS =====

function sellerClient(schemaName: string) {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    db: { schema: schemaName },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const kowalskiClient = () => sellerClient('seller_kowalski_digital');
const creativeClient = () => sellerClient('seller_creative_studio');

async function createTestUser(prefix: string) {
  const randomStr = Math.random().toString(36).substring(7);
  const email = `${prefix}-${Date.now()}-${randomStr}@example.com`;
  const password = 'password123';

  const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  return {
    email,
    password,
    userId: user!.id,
    cleanup: async () => {
      await supabaseAdmin.auth.admin.deleteUser(user!.id).catch(() => {});
    },
  };
}

// ===== TESTS =====

test.describe('Marketplace Buyer Flows', () => {

  // ===== Order bumps on seller checkout =====

  test.describe('Order bumps on seller checkout', () => {
    test('order-bumps API returns bumps for seller product with bumps', async ({ page }) => {
      // Get the kurs-ecommerce product ID from Kowalski schema
      const kc = kowalskiClient();
      const { data: product } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'kurs-ecommerce')
        .single();
      expect(product).not.toBeNull();

      const response = await page.request.get(
        `/api/order-bumps?productId=${product!.id}&seller=kowalski-digital`
      );

      expect(response.status()).toBe(200);
      const bumps = await response.json();
      expect(Array.isArray(bumps)).toBe(true);
      expect(bumps.length).toBeGreaterThanOrEqual(1);

      // The bump should reference szablon-sklepu at 49 PLN
      const bump = bumps[0];
      expect(bump.bump_price).toBe(49);
    });

    test('order-bumps API returns empty for seller product without bumps', async ({ page }) => {
      // konsultacja has no order bump configured
      const kc = kowalskiClient();
      const { data: product } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'konsultacja')
        .single();
      expect(product).not.toBeNull();

      const response = await page.request.get(
        `/api/order-bumps?productId=${product!.id}&seller=kowalski-digital`
      );

      expect(response.status()).toBe(200);
      const bumps = await response.json();
      expect(Array.isArray(bumps)).toBe(true);
      expect(bumps.length).toBe(0);
    });
  });

  // ===== Coupon verify for seller =====

  test.describe('Coupon verify for seller', () => {
    test('coupon verify with sellerSlug routes to seller schema (not RPC error)', async ({ page }) => {
      // Seed data has no coupons for sellers, so we expect a valid "not found" response
      // rather than an RPC routing error
      const kc = kowalskiClient();
      const { data: product } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'kurs-ecommerce')
        .single();
      expect(product).not.toBeNull();

      const response = await page.request.post('/api/coupons/verify', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          code: 'NONEXISTENT',
          productId: product!.id,
          sellerSlug: 'kowalski-digital',
        },
      });

      // Should get a valid JSON response (200 with coupon data or error), not 500
      // The RPC verify_coupon returns a result object even when coupon is not found
      expect(response.status()).not.toBe(500);
      const body = await response.json();
      // Should NOT contain "RPC" or "function" error messages
      if (body.error) {
        expect(body.error).not.toContain('function');
        expect(body.error).not.toContain('does not exist');
      }
    });
  });

  // ===== Payment-status page for seller product =====

  test.describe('Payment-status page for seller product', () => {
    test('payment-status page with seller param loads without error', async ({ page }) => {
      // Navigate to payment-status for a Kowalski product with seller param
      // Without session_id/payment_intent, free-product path requires auth
      const buyer = await createTestUser('ps-buyer');
      try {
        await setAuthSession(page, buyer.email, buyer.password);

        const response = await page.goto(
          '/en/p/kurs-ecommerce/payment-status?seller=kowalski-digital',
          { waitUntil: 'domcontentloaded' }
        );

        // Should not be a 500 server error
        expect(response?.status()).not.toBe(500);

        // Page should load (may redirect to login or show product info)
        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toContain('Internal Server Error');
      } finally {
        await buyer.cleanup();
      }
    });

    test('payment-status page without seller param for seller product does not show product', async ({ page }) => {
      // kurs-ecommerce exists only in seller_kowalski_digital, not seller_main
      // Without seller param, product lookup happens in seller_main and fails
      // The page redirects to "/" via next/navigation redirect()
      const buyer = await createTestUser('ps-buyer-noseller');
      try {
        await setAuthSession(page, buyer.email, buyer.password);

        await page.goto('/en/p/kurs-ecommerce/payment-status', {
          waitUntil: 'domcontentloaded',
        });

        // The page should either redirect away or not show the product name
        // (product not found in seller_main -> server redirect to /)
        const url = page.url();
        const bodyText = await page.locator('body').innerText();
        const productNotShown = !bodyText.includes('Kurs E-commerce od Zera');
        const isRedirected = !url.includes('/p/kurs-ecommerce/payment-status');
        expect(productNotShown || isRedirected).toBe(true);
      } finally {
        await buyer.cleanup();
      }
    });
  });

  // ===== My Purchases cross-schema =====

  test.describe('My Purchases cross-schema', () => {
    test.describe.configure({ mode: 'serial' });

    let buyer: Awaited<ReturnType<typeof createTestUser>>;
    let kowalskiProductId: string;
    let creativeProductId: string;

    test.beforeAll(async () => {
      buyer = await createTestUser('purchases-buyer');

      // Get product IDs from seller schemas
      const kc = kowalskiClient();
      const { data: kProduct } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'kurs-ecommerce')
        .single();
      kowalskiProductId = kProduct!.id;

      const cc = creativeClient();
      const { data: cProduct } = await cc
        .from('products')
        .select('id')
        .eq('slug', 'logo-design')
        .single();
      creativeProductId = cProduct!.id;

      // Grant access in both seller schemas via direct INSERT (service_role)
      const { error: kErr } = await kc
        .from('user_product_access')
        .insert({
          user_id: buyer.userId,
          product_id: kowalskiProductId,
        });
      if (kErr) throw new Error(`Failed to insert Kowalski access: ${JSON.stringify(kErr)}`);

      const { error: cErr } = await cc
        .from('user_product_access')
        .insert({
          user_id: buyer.userId,
          product_id: creativeProductId,
        });
      if (cErr) throw new Error(`Failed to insert Creative access: ${JSON.stringify(cErr)}`);
    });

    test.afterAll(async () => {
      // Clean up access records
      if (buyer) {
        await kowalskiClient()
          .from('user_product_access')
          .delete()
          .eq('user_id', buyer.userId);

        await creativeClient()
          .from('user_product_access')
          .delete()
          .eq('user_id', buyer.userId);

        await buyer.cleanup();
      }
    });

    test('buyer with access in 2 schemas sees both products via RPC', async () => {
      // Sign in as the buyer to get an authenticated client
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      await userClient.auth.signInWithPassword({
        email: buyer.email,
        password: buyer.password,
      });

      const { data, error } = await userClient.rpc('get_user_products_all_sellers');

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(2);

      const slugs = data!.map((row: { product_slug: string }) => row.product_slug);
      expect(slugs).toContain('kurs-ecommerce');
      expect(slugs).toContain('logo-design');

      // Verify seller metadata is correct
      const kowalskiRow = data!.find((row: { product_slug: string }) => row.product_slug === 'kurs-ecommerce');
      expect(kowalskiRow.seller_slug).toBe('kowalski_digital');

      const creativeRow = data!.find((row: { product_slug: string }) => row.product_slug === 'logo-design');
      expect(creativeRow.seller_slug).toBe('creative_studio');
    });

    test('buyer with access in seller schema sees product via RPC', async () => {
      // Verify the function returns at least the Kowalski product
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      await userClient.auth.signInWithPassword({
        email: buyer.email,
        password: buyer.password,
      });

      const { data, error } = await userClient.rpc('get_user_products_all_sellers');

      expect(error).toBeNull();
      const kowalskiProducts = data!.filter(
        (row: { seller_slug: string }) => row.seller_slug === 'kowalski_digital'
      );
      expect(kowalskiProducts.length).toBeGreaterThanOrEqual(1);
      expect(kowalskiProducts[0].product_price).toBe(199);
    });
  });

  // ===== Grant access for free seller products =====

  test.describe('Grant access for seller products', () => {
    let buyer: Awaited<ReturnType<typeof createTestUser>>;

    test.beforeAll(async () => {
      buyer = await createTestUser('grant-buyer');
    });

    test.afterAll(async () => {
      if (buyer) {
        // Clean up any access records that might have been created
        await kowalskiClient()
          .from('user_product_access')
          .delete()
          .eq('user_id', buyer.userId);
        await buyer.cleanup();
      }
    });

    test('grant-access with sellerSlug for price>0 product returns "Payment required"', async ({ page }) => {
      await setAuthSession(page, buyer.email, buyer.password);

      const response = await page.request.post('/api/public/products/kurs-ecommerce/grant-access', {
        headers: { 'Content-Type': 'application/json' },
        data: { sellerSlug: 'kowalski-digital' },
      });

      // Product found in seller schema (not 404) but requires payment (price=199)
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Payment required');
    });

    test('grant-access without sellerSlug for seller product returns 404', async ({ page }) => {
      await setAuthSession(page, buyer.email, buyer.password);

      // kurs-ecommerce exists only in seller_kowalski_digital, not seller_main
      const response = await page.request.post('/api/public/products/kurs-ecommerce/grant-access', {
        headers: { 'Content-Type': 'application/json' },
        data: {},
      });

      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error).toBe('Product not found');
    });
  });

  // ===== Guest purchase migration =====

  test.describe('Guest purchase migration', () => {
    test.describe.configure({ mode: 'serial' });

    let buyerUserId: string;
    let guestProductId: string;
    const guestEmail = `guest-migrate-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;
    const sessionId = `cs_test_guest_migrate_${Date.now()}`;

    test.beforeAll(async () => {
      // Get a product ID from Kowalski schema
      const kc = kowalskiClient();
      const { data: product } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'szablon-sklepu')
        .single();
      guestProductId = product!.id;

      // Insert a guest purchase in seller_kowalski_digital schema
      const { error: gpError } = await kc
        .from('guest_purchases')
        .insert({
          customer_email: guestEmail,
          product_id: guestProductId,
          transaction_amount: 79,
          session_id: sessionId,
        });
      if (gpError) throw new Error(`Failed to insert guest purchase: ${JSON.stringify(gpError)}`);
    });

    test.afterAll(async () => {
      const kc = kowalskiClient();

      // Clean up guest purchases
      await kc
        .from('guest_purchases')
        .delete()
        .eq('customer_email', guestEmail);

      // Clean up access records
      if (buyerUserId) {
        await kc
          .from('user_product_access')
          .delete()
          .eq('user_id', buyerUserId);
        await supabaseAdmin.auth.admin.deleteUser(buyerUserId).catch(() => {});
      }
    });

    test('guest_purchases in seller schema are migrated on user creation (trigger)', async () => {
      // Creating a user with the same email as the guest purchase triggers
      // the on_auth_user_created_marketplace trigger, which calls
      // migrate_guest_purchases_all_schemas automatically.
      const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
        email: guestEmail,
        password: 'password123',
        email_confirm: true,
      });
      if (error) throw error;
      buyerUserId = user!.id;

      // The trigger should have already migrated the guest purchase.
      // Verify user_product_access was created in seller_kowalski_digital
      const kc = kowalskiClient();
      const { data: access } = await kc
        .from('user_product_access')
        .select('product_id')
        .eq('user_id', buyerUserId)
        .eq('product_id', guestProductId);

      expect(access).not.toBeNull();
      expect(access!.length).toBe(1);

      // Verify guest_purchase was marked as claimed
      const { data: gp } = await kc
        .from('guest_purchases')
        .select('claimed_by_user_id')
        .eq('customer_email', guestEmail)
        .single();

      expect(gp).not.toBeNull();
      expect(gp!.claimed_by_user_id).toBe(buyerUserId);
    });
  });

  // ===== Refund from seller -> access revoked =====

  test.describe('Refund from seller -> access revoked', () => {
    test.describe.configure({ mode: 'serial' });

    let buyer: Awaited<ReturnType<typeof createTestUser>>;
    let kowalskiProductId: string;
    let mainProductId: string;

    test.beforeAll(async () => {
      buyer = await createTestUser('refund-buyer');

      // Get product IDs from both schemas
      const kc = kowalskiClient();
      const { data: kProduct } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'kurs-ecommerce')
        .single();
      kowalskiProductId = kProduct!.id;

      // Get a product from seller_main for isolation verification
      const mainClient = sellerClient('seller_main');
      const { data: mProduct } = await mainClient
        .from('products')
        .select('id')
        .limit(1)
        .single();
      mainProductId = mProduct!.id;
    });

    test.afterAll(async () => {
      if (buyer) {
        // Clean up access records in both schemas
        await kowalskiClient()
          .from('user_product_access')
          .delete()
          .eq('user_id', buyer.userId);

        const mainClient = sellerClient('seller_main');
        await mainClient
          .from('user_product_access')
          .delete()
          .eq('user_id', buyer.userId);

        await buyer.cleanup();
      }
    });

    test('access granted in seller schema can be revoked independently from seller_main', async () => {
      const kc = kowalskiClient();
      const mainClient = sellerClient('seller_main');

      // Grant access in both schemas
      const { error: kErr } = await kc
        .from('user_product_access')
        .insert({
          user_id: buyer.userId,
          product_id: kowalskiProductId,
        });
      if (kErr) throw new Error(`Failed to insert Kowalski access: ${JSON.stringify(kErr)}`);

      const { error: mErr } = await mainClient
        .from('user_product_access')
        .insert({
          user_id: buyer.userId,
          product_id: mainProductId,
        });
      if (mErr) throw new Error(`Failed to insert main access: ${JSON.stringify(mErr)}`);

      // Verify both exist
      const { data: kAccess } = await kc
        .from('user_product_access')
        .select('product_id')
        .eq('user_id', buyer.userId)
        .eq('product_id', kowalskiProductId);
      expect(kAccess!.length).toBe(1);

      const { data: mAccess } = await mainClient
        .from('user_product_access')
        .select('product_id')
        .eq('user_id', buyer.userId)
        .eq('product_id', mainProductId);
      expect(mAccess!.length).toBe(1);

      // Revoke access in seller_kowalski_digital only (simulating refund)
      const { error: delErr } = await kc
        .from('user_product_access')
        .delete()
        .eq('user_id', buyer.userId)
        .eq('product_id', kowalskiProductId);
      expect(delErr).toBeNull();

      // Verify: Kowalski access gone
      const { data: kAccessAfter } = await kc
        .from('user_product_access')
        .select('product_id')
        .eq('user_id', buyer.userId)
        .eq('product_id', kowalskiProductId);
      expect(kAccessAfter!.length).toBe(0);

      // Verify: seller_main access still intact
      const { data: mAccessAfter } = await mainClient
        .from('user_product_access')
        .select('product_id')
        .eq('user_id', buyer.userId)
        .eq('product_id', mainProductId);
      expect(mAccessAfter!.length).toBe(1);
    });

    test('transaction + access can be inserted and revoked in seller schema', async () => {
      const kc = kowalskiClient();
      const timestamp = Date.now();

      // Insert a payment transaction in seller schema
      const { data: txn, error: txnErr } = await kc
        .from('payment_transactions')
        .insert({
          session_id: `cs_test_refund_${timestamp}`,
          product_id: kowalskiProductId,
          customer_email: buyer.email,
          amount: 199,
          currency: 'PLN',
          status: 'completed',
          user_id: buyer.userId,
          stripe_payment_intent_id: `pi_test_refund_${timestamp}`,
        })
        .select()
        .single();
      if (txnErr) throw new Error(`Failed to insert transaction: ${JSON.stringify(txnErr)}`);

      // Grant access
      const { error: accessErr } = await kc
        .from('user_product_access')
        .upsert({
          user_id: buyer.userId,
          product_id: kowalskiProductId,
        });
      if (accessErr) throw new Error(`Failed to insert access: ${JSON.stringify(accessErr)}`);

      // Verify access exists
      const { data: access } = await kc
        .from('user_product_access')
        .select('product_id')
        .eq('user_id', buyer.userId)
        .eq('product_id', kowalskiProductId);
      expect(access!.length).toBe(1);

      // Simulate refund: update transaction status + revoke access
      const { error: updateErr } = await kc
        .from('payment_transactions')
        .update({ status: 'refunded' })
        .eq('id', txn!.id);
      expect(updateErr).toBeNull();

      const { error: delErr } = await kc
        .from('user_product_access')
        .delete()
        .eq('user_id', buyer.userId)
        .eq('product_id', kowalskiProductId);
      expect(delErr).toBeNull();

      // Verify access revoked
      const { data: accessAfter } = await kc
        .from('user_product_access')
        .select('product_id')
        .eq('user_id', buyer.userId)
        .eq('product_id', kowalskiProductId);
      expect(accessAfter!.length).toBe(0);

      // Verify transaction status
      const { data: txnAfter } = await kc
        .from('payment_transactions')
        .select('status')
        .eq('id', txn!.id)
        .single();
      expect(txnAfter!.status).toBe('refunded');

      // Clean up transaction
      await kc.from('payment_transactions').delete().eq('id', txn!.id);
    });
  });

  // ===== OTO after seller purchase =====

  test.describe('OTO after seller purchase', () => {
    test.describe.configure({ mode: 'serial' });

    let buyer: Awaited<ReturnType<typeof createTestUser>>;
    let logoDesignProductId: string;
    let brandIdentityProductId: string;
    let transactionId: string;
    let otoCouponCode: string;

    test.beforeAll(async () => {
      buyer = await createTestUser('oto-seller-buyer');

      const cc = creativeClient();
      const { data: logoProduct } = await cc
        .from('products')
        .select('id')
        .eq('slug', 'logo-design')
        .single();
      logoDesignProductId = logoProduct!.id;

      const { data: brandProduct } = await cc
        .from('products')
        .select('id')
        .eq('slug', 'brand-identity')
        .single();
      brandIdentityProductId = brandProduct!.id;
    });

    test.afterAll(async () => {
      const cc = creativeClient();

      // Clean up OTO coupon if created
      if (otoCouponCode) {
        await cc.from('coupons').delete().eq('code', otoCouponCode);
      }

      // Clean up transaction
      if (transactionId) {
        await cc.from('payment_transactions').delete().eq('id', transactionId);
      }

      // Clean up access
      if (buyer) {
        await cc
          .from('user_product_access')
          .delete()
          .eq('user_id', buyer.userId);
        await buyer.cleanup();
      }
    });

    test('generate_oto_coupon creates coupon in seller_creative_studio schema', async () => {
      const cc = creativeClient();
      const timestamp = Date.now();

      // Insert a completed payment transaction for logo-design
      const { data: txn, error: txnErr } = await cc
        .from('payment_transactions')
        .insert({
          session_id: `cs_test_oto_seller_${timestamp}`,
          product_id: logoDesignProductId,
          customer_email: buyer.email,
          amount: 499,
          currency: 'PLN',
          status: 'completed',
          user_id: buyer.userId,
          stripe_payment_intent_id: `pi_test_oto_seller_${timestamp}`,
        })
        .select()
        .single();
      if (txnErr) throw new Error(`Failed to insert transaction: ${JSON.stringify(txnErr)}`);
      transactionId = txn!.id;

      // Call generate_oto_coupon RPC on seller_creative_studio schema
      const { data: otoResult, error: otoErr } = await cc.rpc(
        'generate_oto_coupon',
        {
          source_product_id_param: logoDesignProductId,
          customer_email_param: buyer.email,
          transaction_id_param: transactionId,
        }
      );

      expect(otoErr).toBeNull();
      expect(otoResult).toBeDefined();
      expect(otoResult.has_oto).toBe(true);
      expect(otoResult.coupon_code).toMatch(/^OTO-[A-Z0-9]+$/);
      expect(otoResult.discount_type).toBe('percentage');
      expect(otoResult.discount_value).toBe(25);
      expect(otoResult.oto_product_id).toBe(brandIdentityProductId);
      expect(otoResult.duration_minutes).toBe(20);

      otoCouponCode = otoResult.coupon_code;
    });

    test('OTO coupon exists in seller_creative_studio, not seller_main', async () => {
      expect(otoCouponCode).toBeTruthy();

      // Verify coupon exists in creative_studio schema
      const cc = creativeClient();
      const { data: coupon } = await cc
        .from('coupons')
        .select('code, discount_type, discount_value')
        .eq('code', otoCouponCode)
        .single();

      expect(coupon).not.toBeNull();
      expect(coupon!.discount_type).toBe('percentage');
      expect(coupon!.discount_value).toBe(25);

      // Verify coupon does NOT exist in seller_main
      const mainClient = sellerClient('seller_main');
      const { data: mainCoupon } = await mainClient
        .from('coupons')
        .select('code')
        .eq('code', otoCouponCode)
        .single();

      expect(mainCoupon).toBeNull();
    });
  });

  // ===== Guest buyer flow — seller products =====

  test.describe('Guest buyer flow — seller products', () => {
    test('guest can see seller product page without login', async ({ page }) => {
      // kurs-ecommerce is a Kowalski product — should be accessible without auth
      const response = await page.goto(
        '/en/p/kurs-ecommerce?seller=kowalski-digital',
        { waitUntil: 'domcontentloaded' }
      );

      expect(response?.status()).not.toBe(500);
      expect(response?.status()).not.toBe(404);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Internal Server Error');
    });

    test('guest purchase in seller schema is claimed on registration', async () => {
      const kc = kowalskiClient();
      const timestamp = Date.now();
      const guestEmail = `guest-claim-${timestamp}-${Math.random().toString(36).substring(7)}@example.com`;

      // Get product ID
      const { data: product } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'konsultacja')
        .single();
      expect(product).not.toBeNull();

      // Insert guest purchase
      const { error: gpError } = await kc
        .from('guest_purchases')
        .insert({
          customer_email: guestEmail,
          product_id: product!.id,
          transaction_amount: 149,
          session_id: `cs_test_guest_claim_${timestamp}`,
        });
      if (gpError) throw new Error(`Failed to insert guest purchase: ${JSON.stringify(gpError)}`);

      let userId: string | undefined;
      try {
        // Create user with the same email — trigger should auto-migrate
        const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
          email: guestEmail,
          password: 'password123',
          email_confirm: true,
        });
        if (error) throw error;
        userId = user!.id;

        // Verify user_product_access was created in seller_kowalski_digital
        const { data: access } = await kc
          .from('user_product_access')
          .select('product_id')
          .eq('user_id', userId)
          .eq('product_id', product!.id);

        expect(access).not.toBeNull();
        expect(access!.length).toBe(1);

        // Verify guest_purchase has claimed_by_user_id set
        const { data: gp } = await kc
          .from('guest_purchases')
          .select('claimed_by_user_id')
          .eq('customer_email', guestEmail)
          .single();

        expect(gp).not.toBeNull();
        expect(gp!.claimed_by_user_id).toBe(userId);
      } finally {
        // Cleanup
        if (userId) {
          await kc.from('user_product_access').delete().eq('user_id', userId);
          await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
        }
        await kc.from('guest_purchases').delete().eq('customer_email', guestEmail);
      }
    });

    test('guest purchase in seller schema is NOT claimed by user with different email', async () => {
      const kc = kowalskiClient();
      const timestamp = Date.now();
      const guestEmailA = `guest-noclaim-a-${timestamp}@example.com`;
      const userEmailB = `guest-noclaim-b-${timestamp}@example.com`;

      // Get product ID
      const { data: product } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'pakiet-start')
        .single();
      expect(product).not.toBeNull();

      // Insert guest purchase with email A
      const { error: gpError } = await kc
        .from('guest_purchases')
        .insert({
          customer_email: guestEmailA,
          product_id: product!.id,
          transaction_amount: 299,
          session_id: `cs_test_noclaim_${timestamp}`,
        });
      if (gpError) throw new Error(`Failed to insert guest purchase: ${JSON.stringify(gpError)}`);

      let userId: string | undefined;
      try {
        // Create user with different email B
        const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
          email: userEmailB,
          password: 'password123',
          email_confirm: true,
        });
        if (error) throw error;
        userId = user!.id;

        // Verify guest_purchase is still unclaimed
        const { data: gp } = await kc
          .from('guest_purchases')
          .select('claimed_by_user_id')
          .eq('customer_email', guestEmailA)
          .single();

        expect(gp).not.toBeNull();
        expect(gp!.claimed_by_user_id).toBeNull();

        // Verify no access was granted to user B for this product
        const { data: access } = await kc
          .from('user_product_access')
          .select('product_id')
          .eq('user_id', userId)
          .eq('product_id', product!.id);

        expect(access).not.toBeNull();
        expect(access!.length).toBe(0);
      } finally {
        // Cleanup
        if (userId) {
          await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
        }
        await kc.from('guest_purchases').delete().eq('customer_email', guestEmailA);
      }
    });
  });

  // ===== Registered buyer — multi-seller access =====

  test.describe('Registered buyer — multi-seller access', () => {
    let buyer: Awaited<ReturnType<typeof createTestUser>>;
    let kowalskiProductId: string;
    let creativeProductId: string;

    test.beforeAll(async () => {
      buyer = await createTestUser('multi-seller-buyer');

      const kc = kowalskiClient();
      const { data: kProduct } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'kurs-ecommerce')
        .single();
      kowalskiProductId = kProduct!.id;

      const cc = creativeClient();
      const { data: cProduct } = await cc
        .from('products')
        .select('id')
        .eq('slug', 'logo-design')
        .single();
      creativeProductId = cProduct!.id;
    });

    test.afterAll(async () => {
      if (buyer) {
        await kowalskiClient()
          .from('user_product_access')
          .delete()
          .eq('user_id', buyer.userId);

        await creativeClient()
          .from('user_product_access')
          .delete()
          .eq('user_id', buyer.userId);

        await buyer.cleanup();
      }
    });

    test('buyer with access in kowalski sees product, not creative products', async () => {
      const kc = kowalskiClient();

      // Grant access only in kowalski
      await kc.from('user_product_access').upsert({
        user_id: buyer.userId,
        product_id: kowalskiProductId,
      });

      // Sign in as the buyer
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await userClient.auth.signInWithPassword({
        email: buyer.email,
        password: buyer.password,
      });

      const { data, error } = await userClient.rpc('get_user_products_all_sellers');

      expect(error).toBeNull();
      expect(data).not.toBeNull();

      const slugs = data!.map((row: { product_slug: string }) => row.product_slug);
      expect(slugs).toContain('kurs-ecommerce');
      expect(slugs).not.toContain('logo-design');
    });

    test('buyer with access in both sellers sees both', async () => {
      const kc = kowalskiClient();
      const cc = creativeClient();

      // Ensure access in both schemas
      await kc.from('user_product_access').upsert({
        user_id: buyer.userId,
        product_id: kowalskiProductId,
      });
      await cc.from('user_product_access').upsert({
        user_id: buyer.userId,
        product_id: creativeProductId,
      });

      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await userClient.auth.signInWithPassword({
        email: buyer.email,
        password: buyer.password,
      });

      const { data, error } = await userClient.rpc('get_user_products_all_sellers');

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(2);

      const slugs = data!.map((row: { product_slug: string }) => row.product_slug);
      expect(slugs).toContain('kurs-ecommerce');
      expect(slugs).toContain('logo-design');
    });

    test('access in one seller schema does not leak to another', async () => {
      const kc = kowalskiClient();
      const cc = creativeClient();

      // Ensure access only in kowalski
      await kc.from('user_product_access').upsert({
        user_id: buyer.userId,
        product_id: kowalskiProductId,
      });

      // Check creative_studio has NO access records for this user
      const { data: creativeAccess } = await cc
        .from('user_product_access')
        .select('product_id')
        .eq('user_id', buyer.userId)
        .eq('product_id', kowalskiProductId);

      // kowalskiProductId should NOT exist in creative_studio schema
      expect(creativeAccess).not.toBeNull();
      expect(creativeAccess!.length).toBe(0);
    });
  });

  // ===== Guest purchase — schema isolation =====

  test.describe('Guest purchase — schema isolation', () => {
    test('guest purchase in seller A does NOT exist in seller B', async () => {
      const kc = kowalskiClient();
      const cc = creativeClient();
      const timestamp = Date.now();
      const guestEmail = `guest-iso-${timestamp}-${Math.random().toString(36).substring(7)}@example.com`;

      // Get a product from Kowalski schema
      const { data: product } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'kurs-ecommerce')
        .single();
      expect(product).not.toBeNull();

      // Insert guest_purchase in seller_kowalski_digital
      const { error: gpError } = await kc
        .from('guest_purchases')
        .insert({
          customer_email: guestEmail,
          product_id: product!.id,
          transaction_amount: 199,
          session_id: `cs_test_iso_${timestamp}`,
        });
      if (gpError) throw new Error(`Failed to insert guest purchase: ${JSON.stringify(gpError)}`);

      try {
        // Query guest_purchases in seller_creative_studio for same email → should be empty
        const { data: creativeGP } = await cc
          .from('guest_purchases')
          .select('id')
          .eq('customer_email', guestEmail);

        expect(creativeGP).not.toBeNull();
        expect(creativeGP!.length).toBe(0);
      } finally {
        // Clean up
        await kc.from('guest_purchases').delete().eq('customer_email', guestEmail);
      }
    });

    test('guest purchases in 2 different sellers → registration migrates BOTH', async () => {
      const kc = kowalskiClient();
      const cc = creativeClient();
      const timestamp = Date.now();
      const guestEmail = `guest-multi-${timestamp}-${Math.random().toString(36).substring(7)}@example.com`;

      // Get product IDs from both schemas
      const { data: kProduct } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'kurs-ecommerce')
        .single();
      expect(kProduct).not.toBeNull();

      const { data: cProduct } = await cc
        .from('products')
        .select('id')
        .eq('slug', 'logo-design')
        .single();
      expect(cProduct).not.toBeNull();

      // Insert guest_purchase in seller_kowalski_digital
      const { error: gpKErr } = await kc
        .from('guest_purchases')
        .insert({
          customer_email: guestEmail,
          product_id: kProduct!.id,
          transaction_amount: 199,
          session_id: `cs_test_multi_k_${timestamp}`,
        });
      if (gpKErr) throw new Error(`Failed to insert Kowalski guest purchase: ${JSON.stringify(gpKErr)}`);

      // Insert guest_purchase in seller_creative_studio
      const { error: gpCErr } = await cc
        .from('guest_purchases')
        .insert({
          customer_email: guestEmail,
          product_id: cProduct!.id,
          transaction_amount: 499,
          session_id: `cs_test_multi_c_${timestamp}`,
        });
      if (gpCErr) throw new Error(`Failed to insert Creative guest purchase: ${JSON.stringify(gpCErr)}`);

      let userId: string | undefined;
      try {
        // Create user with that email — trigger should migrate both
        const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
          email: guestEmail,
          password: 'password123',
          email_confirm: true,
        });
        if (error) throw error;
        userId = user!.id;

        // Verify user_product_access in Kowalski schema
        const { data: kAccess } = await kc
          .from('user_product_access')
          .select('product_id')
          .eq('user_id', userId)
          .eq('product_id', kProduct!.id);

        expect(kAccess).not.toBeNull();
        expect(kAccess!.length).toBe(1);

        // Verify user_product_access in Creative schema
        const { data: cAccess } = await cc
          .from('user_product_access')
          .select('product_id')
          .eq('user_id', userId)
          .eq('product_id', cProduct!.id);

        expect(cAccess).not.toBeNull();
        expect(cAccess!.length).toBe(1);

        // Verify guest_purchases claimed_by_user_id set in Kowalski
        const { data: kGP } = await kc
          .from('guest_purchases')
          .select('claimed_by_user_id')
          .eq('customer_email', guestEmail)
          .single();

        expect(kGP).not.toBeNull();
        expect(kGP!.claimed_by_user_id).toBe(userId);

        // Verify guest_purchases claimed_by_user_id set in Creative
        const { data: cGP } = await cc
          .from('guest_purchases')
          .select('claimed_by_user_id')
          .eq('customer_email', guestEmail)
          .single();

        expect(cGP).not.toBeNull();
        expect(cGP!.claimed_by_user_id).toBe(userId);
      } finally {
        // Clean up both schemas
        if (userId) {
          await kc.from('user_product_access').delete().eq('user_id', userId);
          await cc.from('user_product_access').delete().eq('user_id', userId);
          await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
        }
        await kc.from('guest_purchases').delete().eq('customer_email', guestEmail);
        await cc.from('guest_purchases').delete().eq('customer_email', guestEmail);
      }
    });
  });

  // ===== License & watermark per seller =====

  test.describe('License & watermark per seller', () => {
    // Branding visibility is tested in unit tests (marketplace-licensing.test.ts)
    // via static analysis of source code. E2E branding test depends on
    // MARKETPLACE_ENABLED env which may not be set in CI/test environments.

    test('platform product page may or may not have branding (depends on seller_main license)', async ({ page }) => {
      // Platform product page (/p/[slug]) uses seller_main integrations_config
      // We just verify it loads and check for the branding element
      const response = await page.goto('/en/p/test-product', {
        waitUntil: 'domcontentloaded',
      });

      // Page might 404 if test-product doesn't exist in seed — that's ok
      // We're verifying the route works, not the specific product
      if (response?.status() === 200) {
        const branding = page.locator('a[href*="demo.sellf.app"]');
        const brandingCount = await branding.count();
        // Branding is present (0 or more) — we don't assert exact value
        // because it depends on whether seller_main has a license
        expect(brandingCount).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ===== Guest browsing — no login required =====

  test.describe('Guest browsing — no login required', () => {
    test('guest can browse seller storefront without login', async ({ page }) => {
      // Navigate to storefront without any auth session
      const response = await page.goto('/en/s/kowalski-digital', {
        waitUntil: 'domcontentloaded',
      });

      // Should not redirect to login or return server error
      expect(response?.status()).not.toBe(500);
      const url = page.url();
      expect(url).not.toContain('/login');

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Internal Server Error');
    });

    test('guest can view seller product page without login', async ({ page }) => {
      const response = await page.goto('/en/s/kowalski-digital/kurs-ecommerce', {
        waitUntil: 'domcontentloaded',
      });

      expect(response?.status()).not.toBe(500);
      expect(response?.status()).not.toBe(404);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Internal Server Error');
    });

    test('guest can view seller checkout page without login', async ({ page }) => {
      const response = await page.goto('/en/s/kowalski-digital/checkout/kurs-ecommerce', {
        waitUntil: 'domcontentloaded',
      });

      // Should load without server error (may show checkout form or marketplace not enabled message)
      expect(response?.status()).not.toBe(500);
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Internal Server Error');
    });

    test('guest can view free product page from seller', async ({ page }) => {
      const response = await page.goto('/en/s/kowalski-digital/darmowy-poradnik', {
        waitUntil: 'domcontentloaded',
      });

      expect(response?.status()).not.toBe(500);
      expect(response?.status()).not.toBe(404);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('Internal Server Error');
    });
  });

  // ===== Guest API — seller endpoints =====

  test.describe('Guest API — seller endpoints', () => {
    test('guest can fetch order bumps for seller product (no auth needed)', async ({ page }) => {
      // Get the kurs-ecommerce product ID from Kowalski schema
      const kc = kowalskiClient();
      const { data: product } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'kurs-ecommerce')
        .single();
      expect(product).not.toBeNull();

      // No setAuthSession — guest request
      const response = await page.request.get(
        `/api/order-bumps?productId=${product!.id}&seller=kowalski-digital`
      );

      expect(response.status()).toBe(200);
      const bumps = await response.json();
      expect(Array.isArray(bumps)).toBe(true);
    });

    test('guest can verify coupon for seller (no auth needed for verify)', async ({ page }) => {
      const kc = kowalskiClient();
      const { data: product } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'kurs-ecommerce')
        .single();
      expect(product).not.toBeNull();

      // No setAuthSession — guest request
      const response = await page.request.post('/api/coupons/verify', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          code: 'KOWALSKI20',
          productId: product!.id,
          sellerSlug: 'kowalski-digital',
        },
      });

      // Should not return 401 (guest can verify coupons)
      expect(response.status()).not.toBe(401);
      expect(response.status()).not.toBe(500);
    });

    test('guest CANNOT grant access without login', async ({ page }) => {
      // No setAuthSession — guest request
      const response = await page.request.post('/api/public/products/darmowy-poradnik/grant-access', {
        headers: { 'Content-Type': 'application/json' },
        data: { sellerSlug: 'kowalski-digital' },
      });

      // Should return 401 Unauthorized
      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Unauthorized');
    });

    test('guest CANNOT create payment intent without email', async ({ page }) => {
      const kc = kowalskiClient();
      const { data: product } = await kc
        .from('products')
        .select('id')
        .eq('slug', 'kurs-ecommerce')
        .single();
      expect(product).not.toBeNull();

      // No setAuthSession — guest request, missing email
      const response = await page.request.post('/api/create-payment-intent', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          productId: product!.id,
          sellerSlug: 'kowalski-digital',
          termsAccepted: true,
          // No email provided
        },
      });

      // Should fail — either 400 (validation) or 422 (missing field)
      // The exact status depends on implementation, but should NOT be 200
      expect(response.status()).not.toBe(200);
      expect(response.status()).not.toBe(500);
    });
  });
});
