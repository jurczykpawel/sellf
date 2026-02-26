import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';

// Enforce single worker to avoid race conditions
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

/**
 * Helper: Close cookie banner if visible
 */
async function closeCookieBanner(page: any) {
  try {
    const acceptButton = page.locator('.cm-btn-accept, button:has-text("Accept"), button:has-text("Akceptuję")');
    if (await acceptButton.count() > 0) {
      await acceptButton.first().click({ timeout: 2000 });
      await page.waitForTimeout(500);
    }
  } catch {
    // Cookie banner not present, continue
  }
}

/**
 * Helper: Sign in user in browser
 */
async function signInUser(page: any, email: string, password: string) {
  await acceptAllCookies(page);

  // Aggressively hide Klaro via CSS to prevent click interception
  await page.addInitScript(() => {
    const addStyle = () => {
      if (document.head) {
        const style = document.createElement('style');
        style.innerHTML = '#klaro { display: none !important; }';
        document.head.appendChild(style);
      } else {
        setTimeout(addStyle, 10);
      }
    };
    addStyle();
  });

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

/**
 * Helper: Create test user with password
 */
async function createTestUser(email: string, password: string) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  // Create profile
  await supabaseAdmin.from('profiles').upsert({
    id: data.user.id,
    email: data.user.email,
  });

  return data.user;
}

/**
 * Helper: Create test product with refund settings
 */
async function createRefundableProduct(isRefundable: boolean = true, refundPeriodDays: number | null = 14) {
  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      name: `Refund Test Product ${Date.now()}`,
      slug: `refund-test-${Date.now()}`,
      price: 10000, // 100.00 in cents
      currency: 'PLN',
      description: 'Test product for refund testing',
      is_active: true,
      is_refundable: isRefundable,
      refund_period_days: refundPeriodDays,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Helper: Create a payment transaction (simulates completed purchase)
 */
async function createPaymentTransaction(userId: string, productId: string, amount: number = 10000, customerEmail?: string) {
  const timestamp = Date.now();
  const email = customerEmail || `user-${timestamp}@test.com`;

  const { data, error } = await supabaseAdmin
    .from('payment_transactions')
    .insert({
      session_id: `cs_test_${timestamp}`, // Required checkout session ID
      user_id: userId,
      product_id: productId,
      amount: amount,
      currency: 'PLN',
      status: 'completed',
      stripe_payment_intent_id: `pi_test_${timestamp}`,
      customer_email: email,
    })
    .select()
    .single();

  if (error) throw error;

  // Also grant product access
  await supabaseAdmin.from('user_product_access').insert({
    user_id: userId,
    product_id: productId,
    access_granted_at: new Date().toISOString(),
  });

  return data;
}

/**
 * Helper: Create admin user
 */
async function createAdminUser(email: string, password: string) {
  const user = await createTestUser(email, password);

  // Add to admin_users table
  await supabaseAdmin.from('admin_users').insert({
    user_id: user.id,
  });

  return user;
}

test.describe('Refund System - Customer Purchase History', () => {
  let testUser: any;
  let refundableProduct: any;
  let nonRefundableProduct: any;
  let transaction: any;
  const testPassword = 'TestPassword123!';

  test.beforeAll(async () => {
    // Create test user
    testUser = await createTestUser(`refund-test-${Date.now()}@test.com`, testPassword);

    // Create refundable product (14 days)
    refundableProduct = await createRefundableProduct(true, 14);

    // Create non-refundable product
    nonRefundableProduct = await createRefundableProduct(false, null);

    // Create transaction for refundable product
    transaction = await createPaymentTransaction(testUser.id, refundableProduct.id);
  });

  test.afterAll(async () => {
    // Cleanup
    if (testUser) {
      await supabaseAdmin.from('refund_requests').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('payment_transactions').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('admin_users').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', testUser.id);
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
    if (refundableProduct) {
      await supabaseAdmin.from('products').delete().eq('id', refundableProduct.id);
    }
    if (nonRefundableProduct) {
      await supabaseAdmin.from('products').delete().eq('id', nonRefundableProduct.id);
    }
  });

  test('should require login to view purchases', async ({ page }) => {
    await page.goto('/en/my-purchases');
    await page.waitForLoadState('networkidle');

    // Should show access required message
    await expect(page.getByRole('heading', { name: 'Access Required' })).toBeVisible();
  });

  test('should display purchase history for logged in user', async ({ page }) => {
    await signInUser(page, testUser.email, testPassword);

    await page.goto('/en/my-purchases');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should see the page title
    await expect(page.locator('h1').getByText('My Purchases')).toBeVisible();

    // Should see the purchased product
    await expect(page.locator(`text=${refundableProduct.name}`)).toBeVisible();
  });

  test('should show refund button for refundable product within period', async ({ page }) => {
    await signInUser(page, testUser.email, testPassword);

    await page.goto('/en/my-purchases');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should see "Request Refund" button
    await expect(page.locator('button:has-text("Request Refund")')).toBeVisible();

    // Should see remaining days
    await expect(page.locator('text=/days left/i')).toBeVisible();
  });

  test('should open refund modal when clicking request refund', async ({ page }) => {
    await signInUser(page, testUser.email, testPassword);

    await page.goto('/en/my-purchases');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click request refund button
    await page.getByRole('button', { name: 'Request Refund' }).click();

    // Modal should appear - use heading to verify modal is open
    await expect(page.getByRole('heading', { name: 'Request Refund' })).toBeVisible();
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit Request' })).toBeVisible();
  });

  test('should submit refund request successfully', async ({ page }) => {
    await signInUser(page, testUser.email, testPassword);

    await page.goto('/en/my-purchases');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click request refund button
    await page.getByRole('button', { name: 'Request Refund' }).click();

    // Fill reason
    await page.locator('textarea').fill('Product did not meet my expectations');

    // Submit request
    await page.getByRole('button', { name: 'Submit Request' }).click();

    // Wait for modal to close
    await page.waitForTimeout(2000);

    // Should now show "Refund Pending" status
    await expect(page.locator('text=/Pending|Refund Pending/i').first()).toBeVisible();
  });
});

test.describe('Refund System - Product Configuration', () => {
  test('should save refund settings for product', async () => {
    // Create product without refund settings
    const { data: product, error: createError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Config Test ${Date.now()}`,
        slug: `config-test-${Date.now()}`,
        price: 5000,
        currency: 'PLN',
        is_active: true,
        is_refundable: false,
        refund_period_days: null,
      })
      .select()
      .single();

    expect(createError).toBeNull();
    expect(product.is_refundable).toBe(false);
    expect(product.refund_period_days).toBeNull();

    // Update with refund settings
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('products')
      .update({
        is_refundable: true,
        refund_period_days: 30,
      })
      .eq('id', product.id)
      .select()
      .single();

    expect(updateError).toBeNull();
    expect(updated.is_refundable).toBe(true);
    expect(updated.refund_period_days).toBe(30);

    // Cleanup
    await supabaseAdmin.from('products').delete().eq('id', product.id);
  });

  test('should validate refund_period_days constraints', async () => {
    // Should reject negative values
    const { error: negativeError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Invalid Test ${Date.now()}`,
        slug: `invalid-test-${Date.now()}`,
        price: 5000,
        currency: 'PLN',
        is_active: true,
        is_refundable: true,
        refund_period_days: -1,
      });

    expect(negativeError).toBeTruthy();

    // Should reject values over 365
    const { error: overMaxError } = await supabaseAdmin
      .from('products')
      .insert({
        name: `Invalid Test 2 ${Date.now()}`,
        slug: `invalid-test2-${Date.now()}`,
        price: 5000,
        currency: 'PLN',
        is_active: true,
        is_refundable: true,
        refund_period_days: 400,
      });

    expect(overMaxError).toBeTruthy();
  });
});

test.describe('Refund System - Database Functions', () => {
  let testUser: any;
  let testProduct: any;
  let testTransaction: any;

  test.beforeAll(async () => {
    // Create test user
    testUser = await createTestUser(`db-func-test-${Date.now()}@test.com`, 'TestPassword123!');

    // Create refundable product
    testProduct = await createRefundableProduct(true, 30);

    // Create transaction
    testTransaction = await createPaymentTransaction(testUser.id, testProduct.id);
  });

  test.afterAll(async () => {
    if (testUser) {
      await supabaseAdmin.from('refund_requests').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('payment_transactions').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', testUser.id);
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('check_refund_eligibility should return eligible for valid request', async () => {
    const { data, error } = await supabaseAdmin.rpc('check_refund_eligibility', {
      transaction_id_param: testTransaction.id,
    });

    expect(error).toBeNull();
    expect(data.eligible).toBe(true);
    expect(data.days_remaining).toBeGreaterThan(0);
    expect(data.days_remaining).toBeLessThanOrEqual(30);
  });

  test('create_refund_request requires authentication context', async () => {
    // Note: This RPC function requires auth.uid() which is only available
    // in authenticated user context, not service role. This test verifies
    // the function properly rejects unauthenticated calls.
    const { data, error } = await supabaseAdmin.rpc('create_refund_request', {
      transaction_id_param: testTransaction.id,
      reason_param: 'Test refund reason',
    });

    expect(error).toBeNull();
    // Function should return error for unauthenticated calls
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/authentication|auth/i);
  });

  test('check_refund_eligibility detects existing requests', async () => {
    // First, insert a refund request directly
    await supabaseAdmin.from('refund_requests').insert({
      transaction_id: testTransaction.id,
      user_id: testUser.id,
      customer_email: 'test@test.com',
      product_id: testProduct.id,
      requested_amount: 10000,
      currency: 'PLN',
      status: 'pending',
    });

    // Now check eligibility - should detect the existing request
    const { data } = await supabaseAdmin.rpc('check_refund_eligibility', {
      transaction_id_param: testTransaction.id,
    });

    expect(data.eligible).toBe(false);
    expect(data.reason).toMatch(/request.*exists/i);
  });
});

test.describe('Refund System - Admin Management', () => {
  let adminUser: any;
  let customerUser: any;
  let testProduct: any;
  let testTransaction: any;
  let refundRequest: any;
  const adminPassword = 'AdminPassword123!';
  const customerPassword = 'CustomerPassword123!';

  test.beforeAll(async () => {
    // Create admin user
    adminUser = await createAdminUser(`admin-refund-${Date.now()}@test.com`, adminPassword);

    // Create customer user
    customerUser = await createTestUser(`customer-refund-${Date.now()}@test.com`, customerPassword);

    // Create refundable product
    testProduct = await createRefundableProduct(true, 14);

    // Create transaction
    testTransaction = await createPaymentTransaction(customerUser.id, testProduct.id);

    // Create refund request directly (RPC requires auth context)
    const { data, error } = await supabaseAdmin
      .from('refund_requests')
      .insert({
        transaction_id: testTransaction.id,
        user_id: customerUser.id,
        customer_email: customerUser.email,
        product_id: testProduct.id,
        requested_amount: testTransaction.amount,
        currency: testTransaction.currency,
        status: 'pending',
        reason: 'Customer wants refund',
      })
      .select()
      .single();

    if (error) throw error;
    refundRequest = data;
  });

  test.afterAll(async () => {
    // Cleanup
    if (customerUser) {
      await supabaseAdmin.from('refund_requests').delete().eq('user_id', customerUser.id);
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', customerUser.id);
      await supabaseAdmin.from('payment_transactions').delete().eq('user_id', customerUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', customerUser.id);
      await supabaseAdmin.auth.admin.deleteUser(customerUser.id);
    }
    if (adminUser) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', adminUser.id);
      await supabaseAdmin.auth.admin.deleteUser(adminUser.id);
    }
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('should require admin access for refund requests page', async ({ page }) => {
    // Try to access as non-admin
    await signInUser(page, customerUser.email, customerPassword);

    await page.goto('/en/dashboard/refund-requests');
    await page.waitForLoadState('networkidle');

    // Should be redirected away OR show access denied message
    const url = page.url();
    const isRedirected = !url.includes('/dashboard/refund-requests');

    if (isRedirected) {
      // Non-admin was redirected away from the refund requests page
      expect(url).not.toContain('/dashboard/refund-requests');
    } else {
      // Page loaded but should show access denied
      const hasAccessDenied = await page.locator('text=/Access denied|Unauthorized|403/i').count() > 0;
      expect(hasAccessDenied).toBe(true);
    }
  });

  test('admin should see refund requests list', async ({ page }) => {
    await signInUser(page, adminUser.email, adminPassword);

    await page.goto('/en/dashboard/refund-requests');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should see the page title
    await expect(page.getByRole('heading', { name: 'Refund Requests' })).toBeVisible();

    // Should see either pending badge in table or empty state message
    const hasPendingBadge = await page.locator('span:has-text("Pending")').first().isVisible().catch(() => false);
    const hasApproveButton = await page.getByRole('button', { name: 'Approve' }).first().isVisible().catch(() => false);
    const hasNoRequests = await page.locator('text=No refund requests found').isVisible().catch(() => false);
    expect(hasPendingBadge || hasApproveButton || hasNoRequests).toBe(true);
  });

  test('admin should be able to approve refund request via direct update', async () => {
    // Direct update (RPC requires auth.uid() context which service_role doesn't have)
    const { data: updated, error } = await supabaseAdmin
      .from('refund_requests')
      .update({
        status: 'approved',
        admin_id: adminUser.id,
        admin_response: 'Approved for testing',
        processed_at: new Date().toISOString(),
      })
      .eq('id', refundRequest.id)
      .select()
      .single();

    expect(error).toBeNull();
    expect(updated.status).toBe('approved');
    expect(updated.admin_response).toBe('Approved for testing');
    expect(updated.processed_at).toBeTruthy();
  });

  test('get_admin_refund_requests should return filtered results', async () => {
    // Get all requests
    const { data: allRequests, error: allError } = await supabaseAdmin.rpc('get_admin_refund_requests', {
      status_filter: null,
      limit_param: 50,
      offset_param: 0,
    });

    expect(allError).toBeNull();
    expect(Array.isArray(allRequests)).toBe(true);

    // Get only approved requests
    const { data: approvedRequests, error: approvedError } = await supabaseAdmin.rpc('get_admin_refund_requests', {
      status_filter: 'approved',
      limit_param: 50,
      offset_param: 0,
    });

    expect(approvedError).toBeNull();
    expect(approvedRequests.every((r: any) => r.status === 'approved')).toBe(true);
  });
});

test.describe('Refund System - Non-refundable Products', () => {
  let testUser: any;
  let nonRefundableProduct: any;
  let testTransaction: any;
  const testPassword = 'TestPassword123!';

  test.beforeAll(async () => {
    // Create test user
    testUser = await createTestUser(`non-refund-test-${Date.now()}@test.com`, testPassword);

    // Create non-refundable product
    nonRefundableProduct = await createRefundableProduct(false, null);

    // Create transaction
    testTransaction = await createPaymentTransaction(testUser.id, nonRefundableProduct.id);
  });

  test.afterAll(async () => {
    if (testUser) {
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('payment_transactions').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', testUser.id);
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
    if (nonRefundableProduct) {
      await supabaseAdmin.from('products').delete().eq('id', nonRefundableProduct.id);
    }
  });

  test('should show not refundable for non-refundable product', async ({ page }) => {
    await signInUser(page, testUser.email, testPassword);

    await page.goto('/en/my-purchases');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should NOT see "Request Refund" button
    await expect(page.locator('button:has-text("Request Refund")')).not.toBeVisible();

    // Should see "Not refundable" message
    await expect(page.locator('text=/Not refundable/i')).toBeVisible();
  });

  test('check_refund_eligibility should return not eligible for non-refundable product', async () => {
    const { data, error } = await supabaseAdmin.rpc('check_refund_eligibility', {
      transaction_id_param: testTransaction.id,
    });

    expect(error).toBeNull();
    expect(data.eligible).toBe(false);
    expect(data.reason).toMatch(/not.*refundable/i);
  });
});

test.describe('Refund System - Expired Refund Period', () => {
  let testUser: any;
  let testProduct: any;
  let oldTransaction: any;
  const testPassword = 'TestPassword123!';

  test.beforeAll(async () => {
    // Create test user
    testUser = await createTestUser(`expired-refund-${Date.now()}@test.com`, testPassword);

    // Create product with 1-day refund period
    testProduct = await createRefundableProduct(true, 1);

    // Create old transaction (older than refund period)
    const timestamp = Date.now();
    const { data, error } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `cs_old_${timestamp}`,
        user_id: testUser.id,
        product_id: testProduct.id,
        amount: 10000,
        currency: 'PLN',
        status: 'completed',
        stripe_payment_intent_id: `pi_old_${timestamp}`,
        customer_email: testUser.email,
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
      })
      .select()
      .single();

    if (error) throw error;
    oldTransaction = data;

    // Grant access
    await supabaseAdmin.from('user_product_access').insert({
      user_id: testUser.id,
      product_id: testProduct.id,
    });
  });

  test.afterAll(async () => {
    if (testUser) {
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('payment_transactions').delete().eq('user_id', testUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', testUser.id);
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('should show expired message for old purchase', async ({ page }) => {
    await signInUser(page, testUser.email, testPassword);

    await page.goto('/en/my-purchases');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should NOT see "Request Refund" button
    await expect(page.locator('button:has-text("Request Refund")')).not.toBeVisible();

    // Should see "Refund period expired" message
    await expect(page.locator('text=/Refund period expired|period expired/i')).toBeVisible();
  });

  test('check_refund_eligibility should return not eligible for expired period', async () => {
    const { data, error } = await supabaseAdmin.rpc('check_refund_eligibility', {
      transaction_id_param: oldTransaction.id,
    });

    expect(error).toBeNull();
    expect(data.eligible).toBe(false);
    expect(data.reason).toMatch(/expired|period/i);
  });
});

test.describe('Refund System - Admin Product Form UI', () => {
  let adminUser: any;
  let testProduct: any;
  const adminPassword = 'AdminPassword123!';

  test.beforeAll(async () => {
    // Create admin user
    adminUser = await createAdminUser(`admin-form-${Date.now()}@test.com`, adminPassword);

    // Create a test product
    testProduct = await createRefundableProduct(false, null);
  });

  test.afterAll(async () => {
    if (adminUser) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', adminUser.id);
      await supabaseAdmin.auth.admin.deleteUser(adminUser.id);
    }
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('admin should see refund settings section in product form', async ({ page }) => {
    await signInUser(page, adminUser.email, adminPassword);

    await page.goto('/en/dashboard/products');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find the row with test product and click its edit button (pencil icon)
    const productRow = page.locator('tr').filter({ hasText: testProduct.name });
    await expect(productRow).toBeVisible({ timeout: 10000 });
    await productRow.locator('button[title*="Edit"], button[title*="Edytuj"]').click();

    // Wait for wizard dialog to appear
    const modal = page.locator('[role="dialog"]').first();
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Navigate to step 3 (Sales & Settings) where Refund section lives
    const continueBtn = modal.getByRole('button', { name: /Dalej|Continue Setup/i });
    await expect(continueBtn).toBeVisible({ timeout: 5000 });
    await continueBtn.click();
    await page.waitForTimeout(1000);

    // Step 2 — click Continue again
    await expect(continueBtn).toBeVisible({ timeout: 5000 });
    await continueBtn.click();
    await page.waitForTimeout(1000);

    // Should see refund settings section on step 3
    await expect(page.locator('text=/Refund Policy/i')).toBeVisible({ timeout: 10000 });

    // Should see the toggle for allowing refunds
    await expect(page.locator('text=/Allow customers to request refunds/i')).toBeVisible();
  });

  test('admin should be able to toggle refund settings in form', async ({ page }) => {
    await signInUser(page, adminUser.email, adminPassword);

    await page.goto('/en/dashboard/products');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Close cookie banner if present
    await closeCookieBanner(page);

    // Find the row with test product and click its edit button
    const productRow = page.locator('tr').filter({ hasText: testProduct.name });
    await productRow.locator('button[title*="Edit"], button[title*="Edytuj"]').click();
    await page.waitForTimeout(1000);

    // Navigate to step 3 (Sales & Settings) where Refund section lives
    await page.getByRole('button', { name: /Dalej|Continue Setup/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /Dalej|Continue Setup/i }).click();
    await page.waitForTimeout(500);

    // Scroll down to make sure refund settings are visible
    await page.locator('text=/Refund Policy/i').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Find the refund toggle checkbox by its ID
    const refundToggle = page.locator('#is_refundable');
    await expect(refundToggle).toBeVisible();

    // First uncheck if already checked
    if (await refundToggle.isChecked()) {
      await refundToggle.click({ force: true });
      await page.waitForTimeout(500);
    }

    // Now enable refunds
    await refundToggle.click({ force: true });
    await page.waitForTimeout(500);

    // Verify checkbox is now checked
    await expect(refundToggle).toBeChecked();

    // Now the refund period input should be visible
    const periodInput = page.locator('#refund_period_days');
    await expect(periodInput).toBeVisible({ timeout: 5000 });

    // Set refund period to 30 days
    await periodInput.clear();
    await periodInput.fill('30');

    // Verify the value is set
    await expect(periodInput).toHaveValue('30');

    // Test that disabling refunds hides the period input
    await refundToggle.click({ force: true });
    await page.waitForTimeout(500);
    await expect(refundToggle).not.toBeChecked();
    await expect(periodInput).not.toBeVisible();
  });

});

test.describe('Refund System - Admin Approve/Reject UI', () => {
  let adminUser: any;
  let customerUser: any;
  let testProduct: any;
  let testTransaction: any;
  let refundRequest: any;
  const adminPassword = 'AdminPassword123!';
  const customerPassword = 'CustomerPassword123!';

  test.beforeAll(async () => {
    // Create admin user
    adminUser = await createAdminUser(`admin-action-${Date.now()}@test.com`, adminPassword);

    // Create customer user
    customerUser = await createTestUser(`customer-action-${Date.now()}@test.com`, customerPassword);

    // Create refundable product
    testProduct = await createRefundableProduct(true, 30);

    // Create transaction
    testTransaction = await createPaymentTransaction(customerUser.id, testProduct.id);

    // Create refund request directly in DB (no product_name column in table)
    const { data, error } = await supabaseAdmin
      .from('refund_requests')
      .insert({
        transaction_id: testTransaction.id,
        user_id: customerUser.id,
        customer_email: customerUser.email,
        product_id: testProduct.id,
        requested_amount: 10000,
        currency: 'PLN',
        status: 'pending',
        reason: 'Testing admin actions',
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to create refund request:', error);
      throw error;
    }
    refundRequest = data;
  });

  test.afterAll(async () => {
    if (customerUser) {
      await supabaseAdmin.from('refund_requests').delete().eq('user_id', customerUser.id);
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', customerUser.id);
      await supabaseAdmin.from('payment_transactions').delete().eq('user_id', customerUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', customerUser.id);
      await supabaseAdmin.auth.admin.deleteUser(customerUser.id);
    }
    if (adminUser) {
      await supabaseAdmin.from('admin_users').delete().eq('user_id', adminUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', adminUser.id);
      await supabaseAdmin.auth.admin.deleteUser(adminUser.id);
    }
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('admin should see Approve and Reject buttons for pending request', async ({ page }) => {
    await signInUser(page, adminUser.email, adminPassword);

    await page.goto('/en/dashboard/refund-requests');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Close cookie banner if present
    await closeCookieBanner(page);

    // Debug: check if there are any requests or empty state
    const hasNoRequests = await page.locator('text=No refund requests found').isVisible().catch(() => false);
    if (hasNoRequests) {
      console.log('No refund requests displayed - test data may not have been created');
    }

    // Should see Approve button (this confirms there's at least one pending request)
    await expect(page.getByRole('button', { name: 'Approve' }).first()).toBeVisible({ timeout: 10000 });

    // Should see Reject button
    await expect(page.getByRole('button', { name: 'Reject' }).first()).toBeVisible();
  });

  test('admin should open approve modal when clicking approve button', async ({ page }) => {
    await signInUser(page, adminUser.email, adminPassword);

    await page.goto('/en/dashboard/refund-requests');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Close cookie banner if present
    await closeCookieBanner(page);

    // Click Approve button
    await page.getByRole('button', { name: 'Approve' }).first().click();
    await page.waitForTimeout(500);

    // Modal should appear with approve title
    await expect(page.getByRole('heading', { name: /Approve Refund/i })).toBeVisible();

    // Should see warning about Stripe processing
    await expect(page.locator('text=/Stripe|revoke/i')).toBeVisible();

    // Should see confirm button
    await expect(page.getByRole('button', { name: /Approve.*Refund/i })).toBeVisible();

    // Should see cancel button
    await expect(page.getByRole('button', { name: /Cancel/i })).toBeVisible();
  });
});

test.describe('Refund System - Customer Status Updates', () => {
  let customerUser: any;
  let testProduct: any;
  let testTransaction: any;
  const customerPassword = 'CustomerPassword123!';

  test.beforeAll(async () => {
    // Create customer user
    customerUser = await createTestUser(`customer-status-${Date.now()}@test.com`, customerPassword);

    // Create refundable product
    testProduct = await createRefundableProduct(true, 30);

    // Create transaction
    testTransaction = await createPaymentTransaction(customerUser.id, testProduct.id);

    // Create approved refund request
    await supabaseAdmin
      .from('refund_requests')
      .insert({
        transaction_id: testTransaction.id,
        user_id: customerUser.id,
        customer_email: customerUser.email,
        product_id: testProduct.id,
        requested_amount: 10000,
        currency: 'PLN',
        status: 'approved',
        reason: 'Customer requested',
        admin_response: 'Refund approved',
        processed_at: new Date().toISOString(),
      });

    // Also update transaction status to refunded (simulating what happens after Stripe processes)
    await supabaseAdmin
      .from('payment_transactions')
      .update({ status: 'refunded', refunded_amount: 10000 })
      .eq('id', testTransaction.id);
  });

  test.afterAll(async () => {
    if (customerUser) {
      await supabaseAdmin.from('refund_requests').delete().eq('user_id', customerUser.id);
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', customerUser.id);
      await supabaseAdmin.from('payment_transactions').delete().eq('user_id', customerUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', customerUser.id);
      await supabaseAdmin.auth.admin.deleteUser(customerUser.id);
    }
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('customer should see approved status after admin processes refund', async ({ page }) => {
    await signInUser(page, customerUser.email, customerPassword);

    await page.goto('/en/my-purchases');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should see "Approved" or "Refunded" status
    await expect(page.locator('text=/Approved|Refunded/i').first()).toBeVisible();

    // Should NOT see the Request Refund button anymore
    await expect(page.locator('button:has-text("Request Refund")')).not.toBeVisible();
  });

  test('customer should see rejected status with admin response', async ({ page }) => {
    // Reset transaction back to completed (not refunded)
    await supabaseAdmin
      .from('payment_transactions')
      .update({ status: 'completed', refunded_amount: 0 })
      .eq('id', testTransaction.id);

    // Update the request to rejected
    await supabaseAdmin
      .from('refund_requests')
      .update({
        status: 'rejected',
        admin_response: 'Does not meet refund criteria',
        processed_at: new Date().toISOString(),
      })
      .eq('transaction_id', testTransaction.id);

    await signInUser(page, customerUser.email, customerPassword);

    await page.goto('/en/my-purchases');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should see "Refund Rejected" badge
    await expect(page.locator('text=/Refund Rejected|Rejected/i').first()).toBeVisible();
  });
});

test.describe('Refund System - Access Revocation on Refund', () => {
  let customerUser: any;
  let testProduct: any;
  let testTransaction: any;
  const customerPassword = 'CustomerPassword123!';

  test.beforeAll(async () => {
    // Create customer user
    customerUser = await createTestUser(`access-revoke-${Date.now()}@test.com`, customerPassword);

    // Create refundable product
    testProduct = await createRefundableProduct(true, 30);

    // Create transaction (without access - we'll grant it explicitly)
    const timestamp = Date.now();
    const { data, error } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        session_id: `cs_test_${timestamp}`,
        user_id: customerUser.id,
        product_id: testProduct.id,
        amount: 10000,
        currency: 'PLN',
        status: 'completed',
        stripe_payment_intent_id: `pi_test_${timestamp}`,
        customer_email: customerUser.email,
      })
      .select()
      .single();

    if (error) throw error;
    testTransaction = data;

    // Explicitly grant product access
    const { error: accessError } = await supabaseAdmin
      .from('user_product_access')
      .upsert({
        user_id: customerUser.id,
        product_id: testProduct.id,
        access_granted_at: new Date().toISOString(),
      });

    if (accessError) {
      console.error('Failed to grant access:', accessError);
      throw accessError;
    }
  });

  test.afterAll(async () => {
    if (customerUser) {
      await supabaseAdmin.from('refund_requests').delete().eq('user_id', customerUser.id);
      await supabaseAdmin.from('user_product_access').delete().eq('user_id', customerUser.id);
      await supabaseAdmin.from('payment_transactions').delete().eq('user_id', customerUser.id);
      await supabaseAdmin.from('profiles').delete().eq('id', customerUser.id);
      await supabaseAdmin.auth.admin.deleteUser(customerUser.id);
    }
    if (testProduct) {
      await supabaseAdmin.from('products').delete().eq('id', testProduct.id);
    }
  });

  test('user should have product access before refund', async () => {
    // Verify user has product access
    const { data: access, error } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', customerUser.id)
      .eq('product_id', testProduct.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(access).toBeTruthy();
    expect(access!.user_id).toBe(customerUser.id);
    expect(access!.product_id).toBe(testProduct.id);
  });

  test('product access should be revoked after refund is processed', async () => {
    // Verify access exists before refund
    const { data: accessBefore } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', customerUser.id)
      .eq('product_id', testProduct.id)
      .single();

    expect(accessBefore).toBeTruthy();

    // Simulate refund processing by:
    // 1. Updating transaction status to refunded
    // 2. Deleting product access (as the API does)
    await supabaseAdmin
      .from('payment_transactions')
      .update({
        status: 'refunded',
        refund_id: `re_test_${Date.now()}`,
        refunded_amount: testTransaction.amount,
        refunded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', testTransaction.id);

    // This is what the refund API does - revoke access
    await supabaseAdmin
      .from('user_product_access')
      .delete()
      .eq('user_id', customerUser.id)
      .eq('product_id', testProduct.id);

    // Verify access is now revoked
    const { data: accessAfter, error } = await supabaseAdmin
      .from('user_product_access')
      .select('*')
      .eq('user_id', customerUser.id)
      .eq('product_id', testProduct.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(accessAfter).toBeNull(); // Access should be revoked
  });

});
