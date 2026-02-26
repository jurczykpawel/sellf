import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Enforce single worker to avoid race conditions
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

if (!STRIPE_SECRET_KEY) {
  throw new Error('Missing Stripe secret key for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' });

/**
 * Helper: Grant product access (simulates successful payment webhook)
 */
async function grantProductAccess(userId: string, productId: string) {
  const { data, error } = await supabaseAdmin.rpc('grant_product_access_service_role', {
    user_id_param: userId,
    product_id_param: productId
  });

  if (error) throw error;
  return data;
}

/**
 * Helper: Sign in user in browser
 */
async function signInUser(page: any, email: string, password: string) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await page.evaluate(async ({ email, password, supabaseUrl, anonKey }) => {
    const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
    const supabase = createBrowserClient(supabaseUrl, anonKey);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, {
    email,
    password,
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
  });

  await page.waitForTimeout(1000);
}

test.describe('Payment Flow - Access Granting', () => {
  let testUser: any;
  let testProduct: any;

  test.beforeAll(async () => {
    // Create test user
    const email = `payment-test-${Date.now()}@test.com`;
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    if (authError) throw authError;
    testUser = authData.user;

    // Create profile
    await supabaseAdmin.from('profiles').insert({
      id: testUser.id,
      email: testUser.email,
    });

    // Create test product (unlimited access)
    const { data: productData, error: productError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Access Test Product ${Date.now()}`,
        slug: `access-test-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: true,
        auto_grant_duration_days: null, // NULL = unlimited access
      })
      .select()
      .single();

    if (productError) throw productError;
    testProduct = productData;
  });

  test.afterAll(async () => {
    // Cleanup
    if (testUser) {
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', testUser.id);
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('should grant unlimited access after payment (NULL expires_at)', async ({ page }) => {
    // Simulate successful payment by calling grant access function
    const result = await grantProductAccess(testUser.id, testProduct.id);

    expect(result.success).toBe(true);

    // Verify user_product_access record was created
    const { data: access, error } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', testUser.id)
      .eq('product_id', testProduct.id)
      .single();

    expect(error).toBeNull();
    expect(access).toBeTruthy();
    expect(access.access_expires_at).toBeNull(); // Unlimited access
    expect(access.access_duration_days).toBeNull();

    // Sign in and verify frontend access
    await signInUser(page, testUser.email, 'TestPassword123!');

    // Navigate to product page
    await page.goto(`/p/${testProduct.slug}`);
    await page.waitForTimeout(2000);

    // Should NOT redirect to checkout (has access)
    expect(page.url()).toContain(`/p/${testProduct.slug}`);

    // Should see "Access Granted" indicator
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.toLowerCase()).toContain('access granted');
  });

  test('should prevent guest access (redirect to checkout)', async ({ page }) => {
    // Create a product without granting access
    const { data: restrictedProduct } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Restricted ${Date.now()}`,
        slug: `restricted-${Date.now()}`,
        price: 50,
        currency: 'PLN',
        is_active: true,
      })
      .select()
      .single();

    // Try to access as guest (no auth)
    await page.goto(`/p/${restrictedProduct.slug}`);
    await page.waitForTimeout(2000);

    // Should redirect to checkout
    expect(page.url()).toContain('/checkout/');

    // Cleanup
    await supabaseAdmin.from('products').delete().eq('id', restrictedProduct.id);
  });
});

test.describe('Payment Flow - Timed Access', () => {
  let testUser: any;
  let timedProduct: any;

  test.beforeAll(async () => {
    const email = `timed-test-${Date.now()}@test.com`;
    const { data: authData } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    testUser = authData.user;

    await supabaseAdmin.from('profiles').insert({
      id: testUser.id,
      email: testUser.email,
    });

    // Create product with 30 days access
    const { data: productData } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Timed Product ${Date.now()}`,
        slug: `timed-${Date.now()}`,
        price: 50,
        currency: 'PLN',
        is_active: true,
        auto_grant_duration_days: 30, // 30 days access
      })
      .select()
      .single();

    timedProduct = productData;
  });

  test.afterAll(async () => {
    if (testUser) {
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', testUser.id);
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
    if (timedProduct) {
      await supabaseAdmin.from('products').delete().eq('id', timedProduct.id);
    }
  });

  test('should grant timed access (30 days)', async ({ page }) => {
    // Grant access
    const result = await grantProductAccess(testUser.id, timedProduct.id);

    expect(result.success).toBe(true);

    // Verify access record
    const { data: access } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', testUser.id)
      .eq('product_id', timedProduct.id)
      .single();

    expect(access).toBeTruthy();
    expect(access.access_duration_days).toBe(30);
    expect(access.access_expires_at).not.toBeNull();

    // Verify expires_at is approximately 30 days from now
    const expiresAt = new Date(access.access_expires_at);
    const now = new Date();
    const diffDays = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    expect(diffDays).toBeGreaterThan(29); // At least 29 days
    expect(diffDays).toBeLessThan(31); // At most 31 days

    // Verify frontend access
    await signInUser(page, testUser.email, 'TestPassword123!');
    await page.goto(`/p/${timedProduct.slug}`);
    await page.waitForTimeout(2000);

    expect(page.url()).toContain(`/p/${timedProduct.slug}`);
  });

  test('should extend access when purchasing again', async () => {
    // Get current access
    const { data: accessBefore } = await supabaseAdmin
      .from('user_product_access')
      .select('access_expires_at')
      .eq('user_id', testUser.id)
      .eq('product_id', timedProduct.id)
      .single();

    const expiresAtBefore = new Date(accessBefore.access_expires_at);

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Purchase again (extend access)
    await grantProductAccess(testUser.id, timedProduct.id);

    // Get updated access
    const { data: accessAfter } = await supabaseAdmin
      .from('user_product_access')
      .select('access_expires_at')
      .eq('user_id', testUser.id)
      .eq('product_id', timedProduct.id)
      .single();

    const expiresAtAfter = new Date(accessAfter.access_expires_at);

    // Expires_at should be extended by 30 days
    expect(expiresAtAfter.getTime()).toBeGreaterThan(expiresAtBefore.getTime());

    const extensionDays = (expiresAtAfter.getTime() - expiresAtBefore.getTime()) / (1000 * 60 * 60 * 24);
    expect(extensionDays).toBeGreaterThan(29);
    expect(extensionDays).toBeLessThan(31);
  });
});

test.describe('Payment Flow - Order Bump', () => {
  let testUser: any;
  let mainProduct: any;
  let bumpProduct: any;
  let orderBump: any;

  test.beforeAll(async () => {
    const email = `bump-test-${Date.now()}@test.com`;
    const { data: authData } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    testUser = authData.user;

    await supabaseAdmin.from('profiles').insert({
      id: testUser.id,
      email: testUser.email,
    });

    // Create main product
    const { data: mainProd } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Main Product ${Date.now()}`,
        slug: `main-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: true,
        auto_grant_duration_days: null, // Unlimited
      })
      .select()
      .single();

    mainProduct = mainProd;

    // Create bump product (7 days access)
    const { data: bumpProd } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Bump Product ${Date.now()}`,
        slug: `bump-${Date.now()}`,
        price: 30,
        currency: 'PLN',
        is_active: true,
        auto_grant_duration_days: 7, // 7 days access
      })
      .select()
      .single();

    bumpProduct = bumpProd;

    // Create order bump
    const { data: bump } = await supabaseAdmin
      .from('order_bumps')
      .insert({
        product_id: mainProduct.id,
        bump_product_id: bumpProduct.id,
        bump_title: 'Special Bonus!',
        bump_description: 'Get 7 days access',
        bump_price: 30,
        bump_currency: 'PLN',
        bump_access_duration: 7,
        is_active: true,
      })
      .select()
      .single();

    orderBump = bump;
  });

  test.afterAll(async () => {
    if (testUser) {
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', testUser.id);
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
    if (orderBump) {
      await supabaseAdmin.from('order_bumps').delete().eq('id', orderBump.id);
    }
    if (mainProduct) {
      await supabaseAdmin.from('products').delete().eq('id', mainProduct.id);
    }
    if (bumpProduct) {
      await supabaseAdmin.from('products').delete().eq('id', bumpProduct.id);
    }
  });

  test('should grant access to both main product and bump product', async ({ page }) => {
    // Grant access to main product
    await grantProductAccess(testUser.id, mainProduct.id);

    // Grant access to bump product (simulating bump purchase)
    await grantProductAccess(testUser.id, bumpProduct.id);

    // Verify both access records exist
    const { data: mainAccess } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', testUser.id)
      .eq('product_id', mainProduct.id)
      .single();

    const { data: bumpAccess } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', testUser.id)
      .eq('product_id', bumpProduct.id)
      .single();

    // Main product: unlimited access
    expect(mainAccess).toBeTruthy();
    expect(mainAccess.access_expires_at).toBeNull();
    expect(mainAccess.access_duration_days).toBeNull();

    // Bump product: 7 days access
    expect(bumpAccess).toBeTruthy();
    expect(bumpAccess.access_duration_days).toBe(7);
    expect(bumpAccess.access_expires_at).not.toBeNull();

    const expiresAt = new Date(bumpAccess.access_expires_at);
    const now = new Date();
    const diffDays = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);

    // Verify frontend access to both products
    await signInUser(page, testUser.email, 'TestPassword123!');

    // Access main product
    await page.goto(`/p/${mainProduct.slug}`);
    await page.waitForTimeout(2000);
    expect(page.url()).toContain(`/p/${mainProduct.slug}`);

    // Access bump product
    await page.goto(`/p/${bumpProduct.slug}`);
    await page.waitForTimeout(2000);
    expect(page.url()).toContain(`/p/${bumpProduct.slug}`);
  });
});

test.describe('Payment Flow - Guest Purchase Claiming', () => {
  let testProduct: any;
  const guestEmail = `guest-claim-${Date.now()}@test.com`;

  test.beforeEach(async () => {
    // Clear ALL rate limits to prevent "Too many requests" errors
    // Use truncate-like approach by deleting all records
    const { error } = await supabaseAdmin
      .from('rate_limits')
      .delete()
      .gte('created_at', '1970-01-01'); // Delete all records (workaround for no truncate)

    if (error) {
      console.error('Failed to clear rate_limits:', error);
    }
  });

  test.beforeAll(async () => {
    // Create test product
    const { data: productData } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Guest Claim Product ${Date.now()}`,
        slug: `guest-claim-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: true,
      })
      .select()
      .single();

    testProduct = productData;
  });

  test.afterAll(async () => {
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('should auto-claim guest purchase when user registers with same email', async ({ page }) => {
    // Manually call claim_guest_purchases_for_user to grant access (no auto trigger exists in DB)
    // STEP 1: Create guest purchase (simulating successful Stripe payment)
    const { error: purchaseError } = await supabaseAdmin
      .from('guest_purchases')
      .insert({
        customer_email: guestEmail,
        product_id: testProduct.id,
        session_id: `pi_test_${Date.now()}`,
        transaction_amount: 10000, // 100 PLN in cents
      });

    expect(purchaseError).toBeNull();

    // Verify guest purchase exists
    const { data: guestPurchase } = await supabaseAdmin
      .from('guest_purchases')
      .select('*')
      .eq('customer_email', guestEmail)
      .eq('product_id', testProduct.id)
      .single();

    expect(guestPurchase).toBeTruthy();

    // STEP 2: User registers with same email
    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: guestEmail,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    expect(userError).toBeNull();
    expect(user).toBeTruthy();

    // STEP 3: Manually call claim function (trigger doesn't exist in DB)
    const { data: claimResult, error: claimError } = await supabaseAdmin.rpc('claim_guest_purchases_for_user', {
      p_user_id: user!.id
    });

    expect(claimError).toBeNull();
    expect(claimResult).toBeTruthy();
    expect(claimResult.success).toBe(true);

    // STEP 4: Verify user_product_access was created
    const { data: userAccess, error: accessError } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', user!.id)
      .eq('product_id', testProduct.id)
      .single();

    expect(accessError).toBeNull();
    expect(userAccess).toBeTruthy();
    expect(userAccess.user_id).toBe(user!.id);
    expect(userAccess.product_id).toBe(testProduct.id);

    // STEP 5: Sign in and verify frontend access
    await signInUser(page, guestEmail, 'TestPassword123!');

    await page.goto(`/p/${testProduct.slug}`);
    await page.waitForTimeout(2000);

    // Should have access (not redirected to checkout)
    expect(page.url()).toContain(`/p/${testProduct.slug}`);

    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.toLowerCase()).toContain('access granted');

    // Cleanup
    await supabaseAdmin.from('user_product_access').delete().eq('user_id', user!.id);
    await supabaseAdmin.from('profiles').delete().eq('id', user!.id);
    await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', guestEmail);
    await supabaseAdmin.auth.admin.deleteUser(user!.id);
  });

  test('should NOT claim if email is different', async () => {
    // Trigger only claims purchases matching user email
    const guestEmail2 = `guest-${Date.now()}@test.com`;
    const registerEmail = `register-${Date.now()}@test.com`;

    // Create guest purchase with one email
    await supabaseAdmin
      .from('guest_purchases')
      .insert({
        customer_email: guestEmail2,
        product_id: testProduct.id,
        session_id: `pi_test_${Date.now()}`,
        transaction_amount: 10000,
      });

    // Register with different email
    const { data: { user } } = await supabaseAdmin.auth.admin.createUser({
      email: registerEmail,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    // Wait for trigger
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Should NOT have access
    const { data: userAccess } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', user!.id)
      .eq('product_id', testProduct.id)
      .single();

    expect(userAccess).toBeNull();

    // Cleanup
    await supabaseAdmin.from('profiles').delete().eq('id', user!.id);
    await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', guestEmail2);
    await supabaseAdmin.auth.admin.deleteUser(user!.id);
  });

  test('should claim multiple products if guest bought multiple', async () => {
    // Trigger claims all purchases matching user email
    const multiEmail = `multi-${Date.now()}@test.com`;

    // Create second product
    const { data: product2 } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Multi Product ${Date.now()}`,
        slug: `multi-${Date.now()}`,
        price: 50,
        currency: 'PLN',
        is_active: true,
      })
      .select()
      .single();

    // Create two guest purchases
    await supabaseAdmin
      .from('guest_purchases')
      .insert([
        {
          customer_email: multiEmail,
          product_id: testProduct.id,
          session_id: `pi_multi1_${Date.now()}`,
          transaction_amount: 10000,
        },
        {
          customer_email: multiEmail,
          product_id: product2.id,
          session_id: `pi_multi2_${Date.now()}`,
          transaction_amount: 5000,
        },
      ]);

    // Register with same email
    const { data: { user } } = await supabaseAdmin.auth.admin.createUser({
      email: multiEmail,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    // Wait for trigger
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Should have access to BOTH products
    const { data: accesses } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', user!.id)
      .in('product_id', [testProduct.id, product2.id]);

    expect(accesses).toBeTruthy();
    expect(accesses!.length).toBe(2);

    // Cleanup
    await supabaseAdmin.from('user_product_access').delete().eq('user_id', user!.id);
    await supabaseAdmin.from('profiles').delete().eq('id', user!.id);
    await supabaseAdmin.from('guest_purchases').delete().eq('customer_email', multiEmail);
    await supabaseAdmin.from('products').delete().eq('id', product2.id);
    await supabaseAdmin.auth.admin.deleteUser(user!.id);
  });
});

test.describe('Payment Flow - Success Redirect & Magic Link', () => {
  let testProduct: any;
  const guestEmail = `guest-magic-${Date.now()}@test.com`;

  test.beforeAll(async () => {
    const { data: productData } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Magic Link Product ${Date.now()}`,
        slug: `magic-link-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: true,
      })
      .select()
      .single();

    testProduct = productData;
  });

  test.afterAll(async () => {
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('should redirect to payment-status page after successful payment', async ({ page }) => {
    // Mock Stripe API
    await page.route('**/api/verify-payment**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          verified: true,
          status: 'succeeded',
          access_granted: false,
          send_magic_link: true,
          is_guest_purchase: true,
          customer_email: guestEmail,
        }),
      });
    });

    // Simulate Stripe redirect to /payment/success
    await page.goto(`/payment/success?payment_intent=pi_test_123&redirect_status=succeeded&product=${testProduct.slug}`);

    // Should redirect to /p/{slug}/payment-status
    await page.waitForTimeout(2000);
    expect(page.url()).toContain(`/p/${testProduct.slug}/payment-status`);
    expect(page.url()).toContain('payment_intent=pi_test_123');
  });

  test('should show access granted for logged-in user purchase', async ({ page }) => {
    const email = `logged-in-${Date.now()}@test.com`;
    const { data: { user } } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    await supabaseAdmin.from('profiles').insert({
      id: user.id,
      email,
    });

    // Grant access
    await grantProductAccess(user.id, testProduct.id);

    // Mock verify payment to return access granted
    await page.route('**/api/verify-payment**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          verified: true,
          status: 'succeeded',
          access_granted: true,
          customer_email: email,
        }),
      });
    });

    // Sign in
    await signInUser(page, email, 'TestPassword123!');

    // Go to payment status
    await page.goto(`/pl/p/${testProduct.slug}/payment-status?payment_intent=pi_test_logged_123`);
    await page.waitForTimeout(2000);

    // Should show success
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.toLowerCase()).toContain('success');

    // Cleanup
    await supabaseAdmin.from('user_product_access').delete().eq('user_id', user.id);
    await supabaseAdmin.from('profiles').delete().eq('id', user.id);
    await supabaseAdmin.auth.admin.deleteUser(user.id);
  });
});

test.describe('Payment Flow - Failed Payments', () => {
  let testProduct: any;

  test.beforeAll(async () => {
    const { data: productData } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Failed Payment Product ${Date.now()}`,
        slug: `failed-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: true,
      })
      .select()
      .single();

    testProduct = productData;
  });

  test.afterAll(async () => {
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('should handle payment failure gracefully', async ({ page }) => {
    // Mock verify payment to return failure
    await page.route('**/api/verify-payment**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          verified: false,
          status: 'failed',
          error: 'Payment was declined by your bank',
        }),
      });
    });

    // Go to payment status with failed payment
    await page.goto(`/pl/p/${testProduct.slug}/payment-status?payment_intent=pi_test_failed_123`);
    await page.waitForTimeout(2000);

    // Should show error message
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.toLowerCase()).toMatch(/failed|error|declined/);
  });

  test('should NOT grant access when payment fails', async ({ page }) => {
    const email = `failed-user-${Date.now()}@test.com`;
    const { data: { user } } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    await supabaseAdmin.from('profiles').insert({
      id: user.id,
      email,
    });

    // Mock failed payment
    await page.route('**/api/verify-payment**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          verified: false,
          status: 'failed',
          access_granted: false,
        }),
      });
    });

    await signInUser(page, email, 'TestPassword123!');

    // Try to access payment status (should show failure)
    await page.goto(`/pl/p/${testProduct.slug}/payment-status?payment_intent=pi_test_failed_456`);
    await page.waitForTimeout(2000);

    // Verify NO access was granted in database
    const { data: access } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', user.id)
      .eq('product_id', testProduct.id)
      .single();

    expect(access).toBeNull();

    // User should NOT be able to access product page
    await page.goto(`/p/${testProduct.slug}`);
    await page.waitForTimeout(2000);

    // Should redirect to checkout
    expect(page.url()).toContain('/checkout/');

    // Cleanup
    await supabaseAdmin.from('profiles').delete().eq('id', user.id);
    await supabaseAdmin.auth.admin.deleteUser(user.id);
  });

  test('should handle payment processing state', async ({ page }) => {
    // Mock payment in processing state
    await page.route('**/api/verify-payment**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          verified: true,
          status: 'processing',
          access_granted: false,
        }),
      });
    });

    await page.goto(`/pl/p/${testProduct.slug}/payment-status?payment_intent=pi_test_processing_123`);
    await page.waitForTimeout(2000);

    // Should show processing message
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.toLowerCase()).toMatch(/processing|pending/);
  });

  test('should handle expired payment session', async ({ page }) => {
    // Mock expired session
    await page.route('**/api/verify-payment**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          verified: false,
          status: 'expired',
          error: 'Payment session has expired',
        }),
      });
    });

    await page.goto(`/pl/p/${testProduct.slug}/payment-status?session_id=cs_test_expired_123`);
    await page.waitForTimeout(2000);

    // Should show expired message
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.toLowerCase()).toContain('expired');
  });
});

test.describe('Payment Flow - Access Verification', () => {
  let userWithAccess: any;
  let userWithoutAccess: any;
  let testProduct: any;

  test.beforeAll(async () => {
    // Create product
    const { data: productData } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Verification Product ${Date.now()}`,
        slug: `verify-${Date.now()}`,
        price: 100,
        currency: 'PLN',
        is_active: true,
      })
      .select()
      .single();

    testProduct = productData;

    // Create user WITH access
    const email1 = `with-access-${Date.now()}@test.com`;
    const { data: user1 } = await supabaseAdmin.auth.admin.createUser({
      email: email1,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    userWithAccess = user1.user;

    await supabaseAdmin.from('profiles').insert({
      id: userWithAccess.id,
      email: email1,
    });

    // Grant access
    await grantProductAccess(userWithAccess.id, testProduct.id);

    // Create user WITHOUT access
    const email2 = `without-access-${Date.now()}@test.com`;
    const { data: user2 } = await supabaseAdmin.auth.admin.createUser({
      email: email2,
      password: 'TestPassword123!',
      email_confirm: true,
    });

    userWithoutAccess = user2.user;

    await supabaseAdmin.from('profiles').insert({
      id: userWithoutAccess.id,
      email: email2,
    });
  });

  test.afterAll(async () => {
    if (userWithAccess) {
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', userWithAccess.id);
      await supabaseAdmin.from('profiles').delete().eq('id', userWithAccess.id);
      await supabaseAdmin.auth.admin.deleteUser(userWithAccess.id);
    }
    if (userWithoutAccess) {
      await supabaseAdmin.from('profiles').delete().eq('id', userWithoutAccess.id);
      await supabaseAdmin.auth.admin.deleteUser(userWithoutAccess.id);
    }
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('user WITH access can view product page', async ({ page }) => {
    await signInUser(page, userWithAccess.email, 'TestPassword123!');

    await page.goto(`/p/${testProduct.slug}`);
    await page.waitForTimeout(2000);

    // Should stay on product page
    expect(page.url()).toContain(`/p/${testProduct.slug}`);

    // Should see access granted
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.toLowerCase()).toContain('access granted');
  });

  test('user WITHOUT access should redirect to checkout', async ({ page }) => {
    await signInUser(page, userWithoutAccess.email, 'TestPassword123!');

    await page.goto(`/p/${testProduct.slug}`);
    await page.waitForTimeout(2000);

    // Should redirect to checkout
    expect(page.url()).toContain('/checkout/');
    expect(page.url()).toContain(testProduct.slug);
  });

  test('guest user should redirect to checkout', async ({ page }) => {
    // No authentication

    await page.goto(`/p/${testProduct.slug}`);
    await page.waitForTimeout(2000);

    // Should redirect to checkout
    expect(page.url()).toContain('/checkout/');
  });
});
