import { test, expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin } from './helpers/admin-auth';

/**
 * Waitlist Feature Tests
 * Tests the full waitlist signup flow for inactive products
 */

test.describe('Waitlist Feature', () => {
  const TEST_EMAIL = 'waitlist-test@example.com';

  // Test product IDs - created at runtime
  let testProductWithWaitlistId: string;
  let testProductWithWaitlistSlug: string;
  let testProductWithoutWaitlistId: string;
  let testProductWithoutWaitlistSlug: string;
  let testProductActiveWithWaitlistId: string;
  let testProductActiveWithWaitlistSlug: string;

  /**
   * Helper to create a test product
   */
  async function createTestProduct(options: {
    name: string;
    slug: string;
    isActive: boolean;
    enableWaitlist: boolean;
  }): Promise<{ id: string; slug: string }> {
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: options.name,
        slug: options.slug,
        description: `Test product for waitlist tests - ${options.slug}`,
        icon: '🧪',
        price: 19.99,
        currency: 'USD',
        vat_rate: 23.00,
        price_includes_vat: true,
        features: [{ title: 'Test', items: ['Waitlist test product'] }],
        is_active: options.isActive,
        enable_waitlist: options.enableWaitlist,
      })
      .select('id, slug')
      .single();

    if (error) throw error;
    return { id: data.id, slug: data.slug };
  }

  /**
   * Helper to delete a test product
   */
  async function deleteTestProduct(id: string): Promise<void> {
    await supabaseAdmin.from('products').delete().eq('id', id);
  }

  /**
   * Helper to create a test webhook with waitlist.signup event
   */
  async function createWaitlistWebhook(): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from('webhook_endpoints')
      .insert({
        url: 'https://example.com/test-waitlist-webhook',
        events: ['waitlist.signup'],
        description: 'Test webhook for waitlist',
        is_active: true
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  /**
   * Helper to delete a webhook by ID
   */
  async function deleteWebhook(id: string): Promise<void> {
    await supabaseAdmin.from('webhook_endpoints').delete().eq('id', id);
  }

  /**
   * Helper to delete all waitlist webhooks
   */
  async function deleteAllWaitlistWebhooks(): Promise<void> {
    await supabaseAdmin
      .from('webhook_endpoints')
      .delete()
      .contains('events', ['waitlist.signup']);
  }

  /**
   * Helper to set enable_waitlist on a product by slug
   */
  async function setProductWaitlistBySlug(slug: string, enabled: boolean): Promise<void> {
    await supabaseAdmin
      .from('products')
      .update({ enable_waitlist: enabled })
      .eq('slug', slug);
  }

  // Create test products before all tests
  test.beforeAll(async () => {
    const timestamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Create product with waitlist enabled (inactive)
    const withWaitlist = await createTestProduct({
      name: 'Test Waitlist Product',
      slug: `test-waitlist-${timestamp}`,
      isActive: false,
      enableWaitlist: true,
    });
    testProductWithWaitlistId = withWaitlist.id;
    testProductWithWaitlistSlug = withWaitlist.slug;

    // Create product without waitlist (inactive)
    const withoutWaitlist = await createTestProduct({
      name: 'Test No Waitlist Product',
      slug: `test-no-waitlist-${timestamp}`,
      isActive: false,
      enableWaitlist: false,
    });
    testProductWithoutWaitlistId = withoutWaitlist.id;
    testProductWithoutWaitlistSlug = withoutWaitlist.slug;

    // Create ACTIVE product with waitlist enabled (for webhook warning tests)
    const activeWithWaitlist = await createTestProduct({
      name: 'Test Active Waitlist Product',
      slug: `test-active-waitlist-${timestamp}`,
      isActive: true,
      enableWaitlist: true,
    });
    testProductActiveWithWaitlistId = activeWithWaitlist.id;
    testProductActiveWithWaitlistSlug = activeWithWaitlist.slug;
  });

  // Clean up test products after all tests
  test.afterAll(async () => {
    if (testProductWithWaitlistId) {
      await deleteTestProduct(testProductWithWaitlistId);
    }
    if (testProductWithoutWaitlistId) {
      await deleteTestProduct(testProductWithoutWaitlistId);
    }
    if (testProductActiveWithWaitlistId) {
      await deleteTestProduct(testProductActiveWithWaitlistId);
    }
  });

  test.describe('Admin Panel', () => {
    let adminEmail: string;
    let adminPassword: string;
    let cleanup: () => Promise<void>;

    test.beforeAll(async () => {
      const admin = await createTestAdmin('waitlist-admin');
      adminEmail = admin.email;
      adminPassword = admin.password;
      cleanup = admin.cleanup;
    });

    test.afterAll(async () => {
      if (cleanup) await cleanup();
    });

    test('should show waitlist checkbox in product form', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      await page.goto('/pl/dashboard/products');

      // Click add product button — opens wizard (step 1)
      await page.getByRole('button', { name: /Dodaj produkt|Add Product/i }).click();

      await page.waitForSelector('[role="dialog"]');

      // Fill step 1 minimum required fields
      await page.fill('input#name', 'Waitlist Test Temp');
      await page.fill('textarea#description', 'Temp description');
      await page.fill('input#price', '10');

      // Uncheck "price includes VAT" to bypass VAT validation on step 1.
      // Without this, clicking Dalej is a no-op until getShopConfig() resolves and
      // auto-populates vat_rate — a race condition that causes flakiness.
      const vatCheckbox = page.locator('input#price_includes_vat');
      if (await vatCheckbox.isChecked()) {
        await vatCheckbox.uncheck();
      }

      // Navigate to step 3 (Availability → Enable Waitlist is on step 3: Sales & Settings)
      const nextButton = page.getByRole('dialog').getByRole('button', { name: /Dalej|Continue Setup/i });
      await nextButton.click();
      // Confirm step 1 actually left (validates that the click was accepted)
      await expect(page.locator('input#name')).not.toBeVisible({ timeout: 5000 });
      await nextButton.click();

      // AvailabilitySection renders with defaultExpanded={true}, so content should be visible
      const waitlistLabel = page.locator('label').filter({ hasText: /Enable Waitlist|Włącz zapis na listę/i });
      await expect(waitlistLabel).toBeVisible({ timeout: 5000 });
    });

    test('should show waitlist indicator for inactive products', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      await page.goto('/pl/dashboard/products');

      // Wait for products table to load
      await page.waitForSelector('table tbody tr');

      // Look for the waitlist indicator emoji 📋 or 🚫
      const waitlistIndicator = page.locator('span').filter({ hasText: /📋|🚫/ });
      const count = await waitlistIndicator.count();

      // Should have at least one indicator (we have test products)
      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('Checkout Page - Waitlist Form', () => {
    test('should show 404 for inactive product WITHOUT waitlist enabled', async ({ page }) => {
      // test-no-redirect is an inactive product without waitlist enabled
      await page.goto(`/pl/checkout/${testProductWithoutWaitlistSlug}`);

      // Page loads but shows "Product Not Found" content (Next.js notFound() returns 200 in dev)
      const title = await page.title();
      expect(title).toContain('Product Not Found');
    });

    test('should show waitlist form for inactive product WITH waitlist enabled', async ({ page }) => {
      // Navigate to checkout page for inactive product with waitlist
      await page.goto(`/pl/checkout/${testProductWithWaitlistSlug}`);

      // Wait for page to load and verify it's NOT a 404 by checking for waitlist content
      const waitlistTitle = page.locator('h2').filter({ hasText: /Join the Waitlist|Dołącz do listy oczekujących/i });
      await expect(waitlistTitle).toBeVisible({ timeout: 15000 });

      // Should see email input
      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toBeVisible();

      // Should see terms checkbox (by ID)
      const termsCheckbox = page.locator('#terms-checkbox');
      await expect(termsCheckbox).toBeAttached();

      // Should see submit button
      const submitButton = page.locator('button').filter({ hasText: /Notify Me|Powiadom mnie/i });
      await expect(submitButton).toBeVisible();
    });

    test('should have required email field', async ({ page }) => {
      await page.goto(`/pl/checkout/${testProductWithWaitlistSlug}`);

      // Wait for form to load
      const waitlistTitle = page.locator('h2').filter({ hasText: /Join the Waitlist|Dołącz do listy oczekujących/i });
      await expect(waitlistTitle).toBeVisible({ timeout: 15000 });

      // Email input should have required attribute
      const emailInput = page.locator('input[type="email"]');
      await expect(emailInput).toHaveAttribute('required', '');
    });

    test('should require terms acceptance', async ({ page }) => {
      await page.goto(`/pl/checkout/${testProductWithWaitlistSlug}`);

      // Wait for form to load
      const waitlistTitle = page.locator('h2').filter({ hasText: /Join the Waitlist|Dołącz do listy oczekujących/i });
      await expect(waitlistTitle).toBeVisible({ timeout: 15000 });

      // Fill email but don't check terms
      const emailInput = page.locator('input[type="email"]');
      await emailInput.fill(TEST_EMAIL);

      // Try to submit - button should be disabled without terms
      const submitButton = page.locator('button').filter({ hasText: /Notify Me|Powiadom mnie/i });

      // Check if button is disabled (form requires terms checkbox)
      await expect(submitButton).toBeDisabled();
    });

    test('should allow filling waitlist form', async ({ page }) => {
      await page.goto(`/pl/checkout/${testProductWithWaitlistSlug}`);

      // Wait for form to load
      const waitlistTitle = page.locator('h2').filter({ hasText: /Join the Waitlist|Dołącz do listy oczekujących/i });
      await expect(waitlistTitle).toBeVisible({ timeout: 15000 });

      // Fill email
      const emailInput = page.locator('input[type="email"]');
      await emailInput.fill(TEST_EMAIL);
      await expect(emailInput).toHaveValue(TEST_EMAIL);

      // Accept terms (use specific ID)
      const termsCheckbox = page.locator('#terms-checkbox');
      await termsCheckbox.check({ force: true });
      await expect(termsCheckbox).toBeChecked();

      // Submit button should be visible
      const submitButton = page.locator('button').filter({ hasText: /Notify Me|Powiadom mnie/i });
      await expect(submitButton).toBeVisible();
    });
  });

  test.describe('API - Waitlist Signup', () => {
    test('should reject signup without email', async ({ request }) => {
      const response = await request.post('/api/waitlist/signup', {
        data: {
          productId: 'test-product-id'
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('Email');
    });

    test('should reject signup with invalid email', async ({ request }) => {
      const response = await request.post('/api/waitlist/signup', {
        data: {
          email: 'not-an-email',
          productId: 'test-product-id'
        }
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error).toContain('email');
    });

    test('should reject signup for non-existent product', async ({ request }) => {
      const response = await request.post('/api/waitlist/signup', {
        data: {
          email: TEST_EMAIL,
          productId: '00000000-0000-0000-0000-000000000000'
        }
      });

      expect(response.status()).toBe(404);
    });

    test('should reject signup for product without waitlist enabled', async ({ request }) => {
      // test-no-redirect exists but has enable_waitlist = false
      // Due to RLS policy, product without waitlist is invisible to API
      const response = await request.post('/api/waitlist/signup', {
        data: {
          email: TEST_EMAIL,
          productId: testProductWithoutWaitlistId
        }
      });

      // Product is hidden by RLS, so API returns 404 "Product not found"
      expect(response.status()).toBe(404);
      const body = await response.json();
      expect(body.error).toContain('not found');
    });

    test('should successfully signup for waitlist', async ({ request }) => {
      const response = await request.post('/api/waitlist/signup', {
        data: {
          email: TEST_EMAIL,
          productId: testProductWithWaitlistId
        }
      });

      // In dev/test mode without captcha, should succeed with 200
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });

  test.describe('Webhook - waitlist.signup event', () => {
    let adminEmail: string;
    let adminPassword: string;
    let cleanup: () => Promise<void>;

    test.beforeAll(async () => {
      const admin = await createTestAdmin('waitlist-webhook');
      adminEmail = admin.email;
      adminPassword = admin.password;
      cleanup = admin.cleanup;
    });

    test.afterAll(async () => {
      if (cleanup) await cleanup();
    });

    test('should have waitlist.signup event type available in webhook config', async ({ page }) => {
      await loginAsAdmin(page, adminEmail, adminPassword);
      await page.goto('/pl/dashboard/webhooks');

      // Click add webhook button
      await page.getByRole('button', { name: /Add|Dodaj/i }).first().click();
      await page.waitForSelector('[role="dialog"]');

      // Look for waitlist.signup in events dropdown/list
      const eventsSection = page.locator('[role="dialog"]');
      const waitlistEvent = eventsSection.locator('text=waitlist.signup');

      // Should have the event type available
      await expect(waitlistEvent).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Waitlist Product Setup Verification', () => {
    test('should return waitlist product via API with correct flags', async ({ request }) => {
      const productResponse = await request.get(`/api/public/products/${testProductWithWaitlistSlug}`);
      expect(productResponse.status()).toBe(200);

      const product = await productResponse.json();
      expect(product.is_active).toBe(false);
      expect(product.enable_waitlist).toBe(true);
    });

    test('should load checkout page for waitlist product without 404', async ({ page }) => {
      const checkoutResponse = await page.goto(`/pl/checkout/${testProductWithWaitlistSlug}`);
      expect(checkoutResponse?.status()).toBe(200);

      const pageContent = await page.content();
      const has404 = pageContent.includes('Product Not Found');
      const hasWaitlistForm = pageContent.includes('waitlist') || pageContent.includes('oczekujących');

      expect(has404).toBe(false);
      expect(hasWaitlistForm).toBe(true);
    });
  });

  /**
   * Waitlist Webhook Warning Tests
   * Tests admin warnings when no webhook is configured for waitlist.signup
   * Each test is INDEPENDENT and sets up its own database state
   */
  test.describe('Waitlist Webhook Warnings', () => {
    // Serial mode - tests run one at a time to avoid database conflicts
    test.describe.configure({ mode: 'serial' });

    let adminEmail: string;
    let adminPassword: string;
    let cleanup: () => Promise<void>;

    test.beforeAll(async () => {
      const admin = await createTestAdmin('waitlist-warnings');
      adminEmail = admin.email;
      adminPassword = admin.password;
      cleanup = admin.cleanup;
    });

    test.afterAll(async () => {
      if (cleanup) await cleanup();
    });

    /**
     * Helper to navigate wizard from step 1 to step 3 (Sales & Settings)
     * Fills minimum required fields on step 1 so "Continue Setup" works
     */
    async function navigateWizardToStep3(page: import('@playwright/test').Page): Promise<void> {
      // Fill step 1 minimum required fields
      await page.fill('input#name', 'Waitlist Temp Product');
      await page.fill('textarea#description', 'Temp description');
      await page.fill('input#price', '10');

      // Uncheck "price includes VAT" to bypass VAT validation on step 1.
      // Without this, clicking Dalej is a no-op until getShopConfig() resolves — a race condition.
      const vatCheckbox = page.locator('input#price_includes_vat');
      if (await vatCheckbox.isChecked()) {
        await vatCheckbox.uncheck();
      }

      // Step 1 → Step 2
      const nextButton = page.getByRole('dialog').getByRole('button', { name: /Dalej|Continue Setup/i });
      await nextButton.click();
      await expect(page.locator('input#name')).not.toBeVisible({ timeout: 5000 });

      // Step 2 → Step 3
      await nextButton.click();
      // Wait for step 3 content to be present before returning
      await expect(
        page.locator('[role="dialog"]').locator('button').filter({ hasText: /Dostępność|Availability/i }).first()
      ).toBeVisible({ timeout: 10000 });
    }

    /**
     * Helper to ensure Availability & Waitlist section is expanded
     * Checks if section content is visible, clicks to expand if needed
     */
    async function ensureAvailabilitySectionExpanded(page: import('@playwright/test').Page): Promise<void> {
      const modal = page.locator('[role="dialog"]');
      const waitlistLabel = modal.locator('label').filter({ hasText: /Włącz zapis na listę|Enable Waitlist/i });

      // If section is already expanded, nothing to do
      const isExpanded = await waitlistLabel.isVisible().catch(() => false);
      if (isExpanded) return;

      // Section is collapsed — click header to expand and wait for content
      const sectionHeader = modal.locator('button').filter({ hasText: /Dostępność.*Lista|Availability.*Waitlist/i }).first();
      await sectionHeader.click();
      await expect(waitlistLabel).toBeVisible({ timeout: 5000 });
    }

    test('should disable waitlist checkbox when no webhook configured', async ({ page }) => {
      // SETUP: Ensure NO waitlist webhooks exist
      await deleteAllWaitlistWebhooks();

      await loginAsAdmin(page, adminEmail, adminPassword);
      await page.goto('/pl/dashboard/products');

      // Click add product button — opens wizard (step 1)
      await page.getByRole('button', { name: /Dodaj produkt|Add Product/i }).click();
      await page.waitForSelector('[role="dialog"]');

      // Navigate wizard to step 3 where Availability section lives
      await navigateWizardToStep3(page);

      // Ensure section is expanded (checks and clicks if needed)
      await ensureAvailabilitySectionExpanded(page);

      // Find the waitlist checkbox by looking for the label text
      const waitlistLabel = page.locator('label').filter({ hasText: /Włącz zapis na listę|Enable Waitlist/i });
      await expect(waitlistLabel).toBeVisible({ timeout: 5000 });

      // The checkbox inside the label should be disabled
      const checkbox = waitlistLabel.locator('input[type="checkbox"]');
      await expect(checkbox).toBeDisabled();
    });

    test('should show warning message when no webhook configured', async ({ page }) => {
      // SETUP: Ensure NO waitlist webhooks exist
      await deleteAllWaitlistWebhooks();

      await loginAsAdmin(page, adminEmail, adminPassword);
      await page.goto('/pl/dashboard/products');

      // Click add product button — opens wizard (step 1)
      await page.getByRole('button', { name: /Dodaj produkt|Add Product/i }).click();
      await page.waitForSelector('[role="dialog"]');

      // Navigate wizard to step 3 where Availability section lives
      await navigateWizardToStep3(page);

      // Ensure section is expanded (checks and clicks if needed)
      await ensureAvailabilitySectionExpanded(page);

      // Should show warning about configuring webhook
      const warningBox = page.locator('[data-testid="waitlist-webhook-warning"]');
      await expect(warningBox).toBeVisible({ timeout: 5000 });
    });

    test('should enable waitlist checkbox when webhook IS configured', async ({ page }) => {
      // SETUP: Create a waitlist webhook
      await deleteAllWaitlistWebhooks();
      const webhookId = await createWaitlistWebhook();

      try {
        await loginAsAdmin(page, adminEmail, adminPassword);
        await page.goto('/pl/dashboard/products');

        // Click add product button — opens wizard (step 1)
        await page.getByRole('button', { name: /Dodaj produkt|Add Product/i }).click();
        await page.waitForSelector('[role="dialog"]');

        // Navigate wizard to step 3 where Availability section lives
        await navigateWizardToStep3(page);

        // Ensure section is expanded (checks and clicks if needed)
        await ensureAvailabilitySectionExpanded(page);

        // Find the waitlist checkbox
        const waitlistLabel = page.locator('label').filter({ hasText: /Włącz zapis na listę|Enable Waitlist/i });
        await expect(waitlistLabel).toBeVisible({ timeout: 5000 });

        // The checkbox should be ENABLED (not disabled)
        const checkbox = waitlistLabel.locator('input[type="checkbox"]');
        await expect(checkbox).toBeEnabled();
      } finally {
        // CLEANUP
        await deleteWebhook(webhookId);
      }
    });

    test('should NOT show warning when webhook IS configured', async ({ page }) => {
      // SETUP: Create a waitlist webhook
      await deleteAllWaitlistWebhooks();
      const webhookId = await createWaitlistWebhook();

      try {
        await loginAsAdmin(page, adminEmail, adminPassword);
        await page.goto('/pl/dashboard/products');

        // Click add product button — opens wizard (step 1)
        await page.getByRole('button', { name: /Dodaj produkt|Add Product/i }).click();
        await page.waitForSelector('[role="dialog"]');

        // Navigate wizard to step 3 where Availability section lives
        await navigateWizardToStep3(page);

        // Ensure section is expanded (checks and clicks if needed)
        await ensureAvailabilitySectionExpanded(page);

        // Should NOT show amber warning box
        const warningBox = page.locator('[data-testid="waitlist-webhook-warning"]');
        await expect(warningBox).not.toBeVisible();
      } finally {
        // CLEANUP
        await deleteWebhook(webhookId);
      }
    });

    test('should show warning when deleting last waitlist webhook with products affected', async ({ page }) => {
      // SETUP: Create exactly one waitlist webhook and ensure a product has waitlist enabled
      await deleteAllWaitlistWebhooks();
      const webhookId = await createWaitlistWebhook();
      // Use dynamically created product
      await setProductWaitlistBySlug(testProductActiveWithWaitlistSlug, true);

      try {
        await loginAsAdmin(page, adminEmail, adminPassword);
        await page.goto('/pl/dashboard/webhooks');

        // Wait for page to load
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Find the webhook row with our test webhook URL
        const webhookRow = page.locator('tr').filter({ hasText: 'example.com/test-waitlist-webhook' });
        await expect(webhookRow).toBeVisible({ timeout: 10000 });

        // Click delete button - this triggers async RPC call before opening modal
        const deleteButton = webhookRow.getByRole('button', { name: /Usuń|Delete/i });
        await deleteButton.click();

        // Wait for modal with warning (RPC needs time to complete before modal opens)
        await page.waitForSelector('[role="dialog"]', { timeout: 10000 });

        // Wait a bit for the warning state to be set (async operation)
        await page.waitForTimeout(500);

        // Should show waitlist warning (amber box with warning emoji)
        const warningInModal = page.locator('[role="dialog"]').locator('[data-testid="waitlist-webhook-warning"]');
        await expect(warningInModal).toBeVisible({ timeout: 5000 });

        // Cancel to not actually delete
        await page.getByRole('button', { name: /Anuluj|Cancel/i }).click();
      } finally {
        // CLEANUP - delete the webhook we created and reset product
        await deleteWebhook(webhookId);
        await setProductWaitlistBySlug(testProductActiveWithWaitlistSlug, false);
      }
    });

    test('should show warning when editing last webhook to remove waitlist.signup event', async ({ page }) => {
      // SETUP: Create exactly one waitlist webhook and ensure a product has waitlist enabled
      await deleteAllWaitlistWebhooks();
      const webhookId = await createWaitlistWebhook();
      await setProductWaitlistBySlug(testProductActiveWithWaitlistSlug, true);

      try {
        await loginAsAdmin(page, adminEmail, adminPassword);
        await page.goto('/pl/dashboard/webhooks');

        // Wait for page to load
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Find the webhook row
        const webhookRow = page.locator('tr').filter({ hasText: 'example.com/test-waitlist-webhook' });
        await expect(webhookRow).toBeVisible({ timeout: 10000 });

        // Click edit button
        const editButton = webhookRow.getByRole('button', { name: /Edytuj|Edit/i });
        await editButton.click();

        // Wait for edit modal
        await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

        // Uncheck the waitlist.signup event
        const waitlistCheckbox = page.locator('[role="dialog"]').locator('input[type="checkbox"]').filter({ has: page.locator('xpath=..').filter({ hasText: /waitlist/i }) });

        // Find checkbox by looking for the label text
        const waitlistLabel = page.locator('[role="dialog"]').locator('label').filter({ hasText: /waitlist/i });
        const checkbox = waitlistLabel.locator('input[type="checkbox"]');

        // Verify it's checked, then uncheck it
        await expect(checkbox).toBeChecked();
        await checkbox.uncheck();
        await expect(checkbox).not.toBeChecked();

        // Click update button (submit the form)
        await page.locator('[role="dialog"]').getByRole('button', { name: /Aktualizuj|Update/i }).click();

        // Should show warning modal with amber box
        await page.waitForTimeout(1000);
        const warningBox = page.locator('[data-testid="waitlist-webhook-warning"]');
        await expect(warningBox).toBeVisible({ timeout: 5000 });

        // Cancel the warning modal (click the last Cancel button which is in the warning modal)
        await page.getByRole('button', { name: /Anuluj|Cancel/i }).last().click();
      } finally {
        // CLEANUP
        await deleteWebhook(webhookId);
        await setProductWaitlistBySlug(testProductActiveWithWaitlistSlug, false);
      }
    });
  });
});
