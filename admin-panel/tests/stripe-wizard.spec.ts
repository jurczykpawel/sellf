import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Stripe Configuration Wizard', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  const adminPassword = 'password123';

  const loginAsAdmin = async (page: Page) => {
    await acceptAllCookies(page);

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
      await supabase.auth.signInWithPassword({ email, password });
    }, {
      email: adminEmail,
      password: adminPassword,
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
    });

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `test-stripe-wizard-${Date.now()}-${randomStr}@example.com`;

    // Create admin user
    const { data: { user }, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (createError) throw createError;

    await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: user!.id });
  });

  test.afterAll(async () => {
    // Cleanup: delete test admin user and configs
    try {
      const { data: users } = await supabaseAdmin.auth.admin.listUsers();
      const user = users?.users?.find(u => u.email === adminEmail);

      if (user) {
        // Delete stripe configs
        await supabaseAdmin
          .from('stripe_configurations')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all test configs

        // Delete admin_users entry
        await supabaseAdmin
          .from('admin_users')
          .delete()
          .eq('user_id', user.id);

        // Delete auth user
        await supabaseAdmin.auth.admin.deleteUser(user.id);
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  });

  test('should open wizard from Settings page', async ({ page }) => {
    await loginAsAdmin(page);

    // Navigate to Settings
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    // Should see Stripe Configuration section
    await expect(page.locator('text=Stripe Configuration')).toBeVisible({ timeout: 10000 });

    // Click Configure Stripe button
    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await expect(configureButton).toBeVisible();
    await configureButton.click();

    // Wizard should open
    await expect(page.locator('text=Stripe Configuration').nth(1)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Step 1 of 5')).toBeVisible();
  });

  test('should show Step 1 - Welcome screen', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await configureButton.click();
    await page.waitForTimeout(500);

    // Check welcome content - just verify key elements are present
    await expect(page.locator('h3:has-text("Secure Stripe Integration")')).toBeVisible();
    await expect(page.locator('h4:has-text("What are Restricted API Keys?")')).toBeVisible();

    // Check Start Configuration button
    const startButton = page.locator('button', { hasText: /Start Configuration/i });
    await expect(startButton).toBeVisible();
  });

  test('should navigate to Step 2 - Mode Selection', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await configureButton.click();
    await page.waitForTimeout(500);

    // Click Start Configuration
    const startButton = page.locator('button', { hasText: /Start Configuration/i });
    await startButton.click();
    await page.waitForTimeout(500);

    // Should be on Step 2
    await expect(page.locator('text=Step 2 of 5')).toBeVisible();
    await expect(page.locator('text=Choose Environment Mode')).toBeVisible();

    // Should see Test and Live mode cards
    await expect(page.locator('h4:has-text("Test Mode")')).toBeVisible();
    await expect(page.locator('h4:has-text("Live Mode")')).toBeVisible();
  });

  test('should select Test Mode and proceed to Step 3', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await configureButton.click();
    await page.waitForTimeout(500);

    const startButton = page.locator('button', { hasText: /Start Configuration/i });
    await startButton.click();
    await page.waitForTimeout(500);

    // Select Test Mode
    const testModeButton = page.locator('button', { hasText: /Test Mode/i }).filter({ has: page.locator('h4') }).first();
    await testModeButton.click();
    await page.waitForTimeout(300);

    // Continue button should be enabled
    const continueButton = page.locator('button', { hasText: /Continue/i }).last();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    await page.waitForTimeout(500);

    // Should be on Step 3
    await expect(page.locator('text=Step 3 of 5')).toBeVisible();
    await expect(page.locator('text=Create Your Restricted API Key')).toBeVisible();
    await expect(page.locator('text=Test Mode').first()).toBeVisible();
  });

  test('should show instructions in Step 3 and proceed to Step 4', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await configureButton.click();
    await page.waitForTimeout(500);

    const startButton = page.locator('button', { hasText: /Start Configuration/i });
    await startButton.click();
    await page.waitForTimeout(500);

    const testModeButton = page.locator('button', { hasText: /Test Mode/i }).filter({ has: page.locator('h4') }).first();
    await testModeButton.click();
    await page.waitForTimeout(300);

    const continueButton = page.locator('button', { hasText: /Continue/i }).last();
    await continueButton.click();
    await page.waitForTimeout(500);

    // Check instructions - use h4 headings to avoid strict mode violations
    await expect(page.locator('h4:has-text("Open Stripe Dashboard")')).toBeVisible();

    // Check Open Stripe button exists
    await expect(page.locator('a[href*="stripe.com"]').first()).toBeVisible();

    // Click "I've Created the Key"
    const createdKeyButton = page.locator('button', { hasText: /I've Created the Key/i });
    await expect(createdKeyButton).toBeVisible();
    await createdKeyButton.click();
    await page.waitForTimeout(500);

    // Should be on Step 4
    await expect(page.locator('text=Step 4 of 5')).toBeVisible();
    await expect(page.locator('text=Enter Your API Key')).toBeVisible();
  });

  test('should validate invalid API key format in Step 4', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await configureButton.click();
    await page.waitForTimeout(500);

    // Navigate to Step 4
    await page.locator('button', { hasText: /Start Configuration/i }).click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /Test Mode/i }).filter({ has: page.locator('h4') }).first().click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: /Continue/i }).last().click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /I've Created the Key/i }).click();
    await page.waitForTimeout(500);

    // Try invalid key (too short)
    const keyInput = page.locator('textarea[placeholder*="rk_test"]');
    await keyInput.fill('rk_test_short');
    await keyInput.blur();
    await page.waitForTimeout(1000);

    // Should show error
    await expect(page.locator('text=too short')).toBeVisible();

    // Validate button should be disabled
    const validateButton = page.locator('button', { hasText: /Validate API Key/i });
    await expect(validateButton).toBeDisabled();
  });

  test('should validate correct API key format (format only)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await configureButton.click();
    await page.waitForTimeout(500);

    // Navigate to Step 4
    await page.locator('button', { hasText: /Start Configuration/i }).click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /Test Mode/i }).filter({ has: page.locator('h4') }).first().click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: /Continue/i }).last().click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /I've Created the Key/i }).click();
    await page.waitForTimeout(500);

    // Enter valid format (but fake key)
    const keyInput = page.locator('textarea[placeholder*="rk_test"]');
    await keyInput.fill('rk_test_1234567890abcdefghijklmnopqrstuvwxyz');
    await keyInput.blur();
    await page.waitForTimeout(1000);

    // Should NOT show format error
    await expect(page.locator('text=too short')).not.toBeVisible();
    await expect(page.locator('text=Invalid key prefix')).not.toBeVisible();

    // Validate button should be enabled
    const validateButton = page.locator('button', { hasText: /Validate API Key/i });
    await expect(validateButton).toBeEnabled();
  });

  test('should handle exit confirmation', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await configureButton.click();
    await page.waitForTimeout(500);

    // Start wizard and select mode (make it dirty)
    await page.locator('button', { hasText: /Start Configuration/i }).click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /Test Mode/i }).filter({ has: page.locator('h4') }).first().click();
    await page.waitForTimeout(300);

    // Try to close
    const closeButton = page.locator('button[aria-label="Close"]').or(page.locator('svg').filter({ hasText: /Close/i }).first());
    await closeButton.first().click();
    await page.waitForTimeout(500);

    // Should show confirmation dialog
    await expect(page.locator('text=Exit configuration?')).toBeVisible();
    await expect(page.locator('text=/progress will not be saved|start over/i')).toBeVisible({ timeout: 10000 });

    // Click Continue Setup
    const continueSetupButton = page.locator('button', { hasText: /Continue Setup/i });
    await continueSetupButton.click();
    await page.waitForTimeout(300);

    // Should still be in wizard
    await expect(page.locator('text=Step 2 of 5')).toBeVisible();
  });

  test('should navigate back through steps', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await configureButton.click();
    await page.waitForTimeout(500);

    // Go to Step 3
    await page.locator('button', { hasText: /Start Configuration/i }).click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /Test Mode/i }).filter({ has: page.locator('h4') }).first().click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: /Continue/i }).last().click();
    await page.waitForTimeout(500);

    // Should be on Step 3
    await expect(page.locator('text=Step 3 of 5')).toBeVisible();

    // Click Back
    const backButton = page.locator('button', { hasText: /Back/i }).first();
    await backButton.click();
    await page.waitForTimeout(500);

    // Should be back on Step 2
    await expect(page.locator('text=Step 2 of 5')).toBeVisible();
    await expect(page.locator('text=Choose Environment Mode')).toBeVisible();
  });

  test('should show info banner about configuration methods', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    // Should see info about two configuration methods
    const infoBox = page.locator('h4:has-text("Two Configuration Methods")');
    const currentlyUsing = page.locator('p:has-text("Currently using")').first();

    // Verify configuration info is present on the settings page
    await expect(infoBox.or(currentlyUsing).first()).toBeVisible({ timeout: 10000 });

    // Should mention .env and database methods
    const pageContent = await page.textContent('body');
    expect(pageContent).toContain('STRIPE_SECRET_KEY');
    expect(pageContent).toContain('.env');
  });

  test('should show key type explanation in Step 4', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await configureButton.click();
    await page.waitForTimeout(500);

    // Navigate to Step 4
    await page.locator('button', { hasText: /Start Configuration/i }).click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /Test Mode/i }).filter({ has: page.locator('h4') }).first().click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: /Continue/i }).last().click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /I've Created the Key/i }).click();
    await page.waitForTimeout(500);

    // Should show key type explanation
    await expect(page.locator('text=Choose Your Key Type')).toBeVisible();
    await expect(page.locator('text=/Restricted Key.*rk_/i')).toBeVisible();
    await expect(page.locator('text=/Secret Key.*sk_/i')).toBeVisible();

    // Should mention both key types in subtitle
    await expect(page.locator('text=/Restricted or Secret Key/i')).toBeVisible();

    // Placeholder should show both options
    const keyInput = page.locator('textarea[placeholder*="rk_test"]');
    const placeholder = await keyInput.getAttribute('placeholder');
    expect(placeholder).toContain('sk_test');
  });

  test('should accept and validate restricted key (rk_*) with appropriate message', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await configureButton.click();
    await page.waitForTimeout(500);

    // Navigate to Step 4
    await page.locator('button', { hasText: /Start Configuration/i }).click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /Test Mode/i }).filter({ has: page.locator('h4') }).first().click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: /Continue/i }).last().click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /I've Created the Key/i }).click();
    await page.waitForTimeout(500);

    // Enter valid format restricted key
    const keyInput = page.locator('textarea[placeholder*="rk_test"]');
    const restrictedKey = 'rk_test_1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJ';
    await keyInput.fill(restrictedKey);
    await keyInput.blur();
    await page.waitForTimeout(1000);

    // Should NOT show format errors
    await expect(page.locator('text=too short')).not.toBeVisible();
    await expect(page.locator('text=Invalid key prefix')).not.toBeVisible();

    // Validate button should be enabled
    const validateButton = page.locator('button', { hasText: /Validate API Key/i });
    await expect(validateButton).toBeEnabled();

    // Note: We don't actually validate against real Stripe API in tests
    // Just verify the UI accepts the format correctly
  });

  test('should accept and validate secret key (sk_*) with appropriate message', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await configureButton.click();
    await page.waitForTimeout(500);

    // Navigate to Step 4
    await page.locator('button', { hasText: /Start Configuration/i }).click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /Test Mode/i }).filter({ has: page.locator('h4') }).first().click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: /Continue/i }).last().click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /I've Created the Key/i }).click();
    await page.waitForTimeout(500);

    // Enter valid format secret key
    const keyInput = page.locator('textarea[placeholder*="rk_test"]');
    const secretKey = 'sk_test_1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP';
    await keyInput.fill(secretKey);
    await keyInput.blur();
    await page.waitForTimeout(1000);

    // Should NOT show format errors
    await expect(page.locator('text=too short')).not.toBeVisible();
    await expect(page.locator('text=Invalid key prefix')).not.toBeVisible();

    // Validate button should be enabled
    const validateButton = page.locator('button', { hasText: /Validate API Key/i });
    await expect(validateButton).toBeEnabled();

    // Note: We don't actually validate against real Stripe API in tests
    // Just verify the UI accepts the sk_* format correctly
  });

  test('should reject keys that are not rk_* or sk_*', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/settings');
    await page.waitForLoadState('networkidle');

    const configureButton = page.locator('button', { hasText: /Configure Stripe/i }).first();
    await configureButton.click();
    await page.waitForTimeout(500);

    // Navigate to Step 4
    await page.locator('button', { hasText: /Start Configuration/i }).click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /Test Mode/i }).filter({ has: page.locator('h4') }).first().click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: /Continue/i }).last().click();
    await page.waitForTimeout(500);
    await page.locator('button', { hasText: /I've Created the Key/i }).click();
    await page.waitForTimeout(500);

    // Try publishable key (pk_*) which should be rejected
    const keyInput = page.locator('textarea[placeholder*="rk_test"]');
    await keyInput.fill('pk_test_1234567890abcdefghijklmnopqrstuvwxyz');
    await keyInput.blur();
    await page.waitForTimeout(1000);

    // Should show error about invalid prefix
    await expect(page.locator('text=/Invalid key prefix/i')).toBeVisible();

    // Validate button should be disabled
    const validateButton = page.locator('button', { hasText: /Validate API Key/i });
    await expect(validateButton).toBeDisabled();
  });
});
