import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession } from './helpers/admin-auth';

// Enforce single worker
test.describe.configure({ mode: 'serial' });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

test.describe('Integrations & Script Injection', () => {
  let adminEmail: string;
  const adminPassword = 'password123';
  let productSlug: string;

  // Helper to login in any test
  const loginAsAdmin = async (page: any) => {
    await acceptAllCookies(page);
    await page.goto('/');
    
    // Simulate login via client-side auth state injection
    await setAuthSession(page, adminEmail, adminPassword);

    await page.waitForTimeout(1000); 
  };

  test.beforeAll(async () => {
    // 1. Create Admin User
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `int-test-admin-${Date.now()}-${randomStr}@example.com`;
    
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

  test.afterEach(async () => {
    // Reset integrations config after each test to avoid pollution.
    // Use upsert (not delete) so the row still exists for subsequent UPDATE calls in the app.
    await supabaseAdmin.from('integrations_config').upsert({
      id: 1,
      gtm_container_id: null,
      gtm_server_container_url: null,
      facebook_pixel_id: null,
      fb_capi_enabled: false,
      facebook_capi_token: null,
      umami_website_id: null,
      umami_script_url: null,
      cookie_consent_enabled: true,
      consent_logging_enabled: false,
      currency_api_provider: 'ecb',
      currency_api_enabled: true,
      currency_api_key_encrypted: null,
      currency_api_key_iv: null,
      currency_api_key_tag: null,
    });
  });

  test('should save integration settings and verify tracking on product page', async ({ page }) => {
    // Create product for this test
    const productSlug = `int-product-${Date.now()}-1`;
    await supabaseAdmin.from('products').insert({
      name: 'Integration Test Product 1',
      slug: productSlug,
      price: 10,
      currency: 'USD',
      is_active: true
    });

    page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));
    await loginAsAdmin(page);
    
    // 1. Navigate to Integrations Settings
    await page.goto('/dashboard/integrations');
    console.log('Navigated to integrations');
    
    // 2. Configure Google Tag Manager
    await page.getByRole('button', { name: 'Analytics' }).click();
    const gtmId = `GTM-TEST${Date.now()}`;
    await page.locator('input[placeholder="GTM-XXXXXX"]').fill(gtmId);
    
    // 3. Configure Umami
    const umamiId = `550e8400-e29b-41d4-a716-446655440000`; // valid uuid format
    const umamiUrl = 'https://analytics.test.com/script.js';
    await page.locator('input[placeholder*="xxxxxxxx-xxxx"]').fill(umamiId);
    await page.locator('input[placeholder*="script.js"]').fill(umamiUrl);
    
    // Ensure no consent banner blocks the button - aggressive check
    const klaro = page.locator('#klaro');
    if (await klaro.isVisible()) {
        console.log('Klaro visible, attempting to close');
        const acceptBtn = klaro.locator('button.cm-btn-success, button:has-text("Accept"), button:has-text("Zgoda")').first();
        if (await acceptBtn.isVisible()) {
            await acceptBtn.click();
            await page.waitForTimeout(500);
        } else {
            await page.evaluate(() => {
                const k = document.getElementById('klaro');
                if (k) k.style.display = 'none';
            });
        }
    }

    // Save Config - Trigger form submission directly
    await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.requestSubmit();
    });
    
    // Setup listener for Server Action response
    const responsePromise = page.waitForResponse(response => 
        response.url().includes('/dashboard/integrations') && 
        response.request().method() === 'POST'
    , { timeout: 10000 }).catch(() => null);
    
    const response = await responsePromise;
    if (response) {
        console.log(`Server Action Response: ${response.status()}`);
        if (response.status() >= 400) {
             console.log('Server Action Failed');
        }
    } else {
        console.log('No Server Action request detected');
    }

    // Check for any toast message (success or error)
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 15000 });
    const toastText = await toast.textContent();
    console.log('Toast message:', toastText);
    expect(toastText).toMatch(/saved successfully|zapisane pomyślnie/i);

    // 4. Navigate to Product Page and Verify Injection
    await page.goto(`/p/${productSlug}`);
    
    // Check for consent banner
    const acceptBtn = page.getByRole('button', { name: /Accept|Zgoda|Akceptuję/i });
    if (await acceptBtn.isVisible()) {
      await acceptBtn.click();
      await page.waitForTimeout(500);
    }

    // A) Verify GTM (Script content check)
    const pageContent = await page.content();
    expect(pageContent).toContain(gtmId);

    // B) Verify Umami
    expect(pageContent).toContain(umamiId);
    expect(pageContent).toContain(umamiUrl);
  });

  test('should verify consent blocking behavior', async ({ page }) => {
    // Create NEW product for this test to avoid cache
    const productSlug = `int-product-${Date.now()}-2`;
    await supabaseAdmin.from('products').insert({
      name: 'Integration Test Product 2',
      slug: productSlug,
      price: 10,
      currency: 'USD',
      is_active: true
    });

    // Setup via UI to ensure cache invalidation
    await loginAsAdmin(page);
    await page.goto('/dashboard/integrations');
    
    // Hide Klaro on dashboard to avoid blocking clicks
    await page.addStyleTag({ content: '#klaro { display: none !important; }' });

    await page.getByRole('button', { name: 'Analytics' }).click();
    const gtmId = 'GTMCONSENT1'; // Must match ^GTM-[A-Z0-9]+$ so no hyphens allowed in suffix? Wait, prefix is GTM-. 
    // Regex is ^GTM-[A-Z0-9]+$. So suffix must be alphanumeric.
    // So 'GTM-CONSENT1' is valid.
    const validGtmId = 'GTM-CONSENT1'; 
    await page.locator('input[placeholder="GTM-XXXXXX"]').fill(validGtmId);
    
    // Verify input value before switching tabs
    await expect(page.locator('input[placeholder="GTM-XXXXXX"]')).toHaveValue(validGtmId);
    
    await page.getByRole('button', { name: 'Consents' }).click();
    // Ensure "Require Consent" is checked
    const consentCheckbox = page.locator('input[type="checkbox"]').first();
    if (!(await consentCheckbox.isChecked())) {
        await consentCheckbox.check();
    }

    // Save
    const saveBtn = page.locator('button[type="submit"]');
    
    // Setup listener for Server Action response
    const responsePromise = page.waitForResponse(async response => {
        if (response.url().includes('/dashboard/integrations') && response.request().method() === 'POST') {
            console.log(`Save Response Status: ${response.status()}`);
            try {
                const body = await response.text();
                console.log(`Save Response Body: ${body.substring(0, 200)}...`); 
            } catch (e) {}
            return true;
        }
        return false;
    }, { timeout: 10000 });

    await saveBtn.click({ force: true });
    
    await responsePromise;
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 15000 });
    
    // Wait for cache revalidation propagation
    await page.waitForTimeout(3000);

    // Verify DB update
    const { data: config } = await supabaseAdmin.from('integrations_config').select('gtm_container_id, cookie_consent_enabled').single();
    console.log('DB Config:', config);

    // Now proceed with verification
    
    // Clear cookies to ensure fresh state
    await page.context().clearCookies();
    
    // Go to product page with cache buster
    await page.goto(`/p/${productSlug}?t=${Date.now()}`);
    await page.waitForLoadState('load');

    // 1. Verify GTM is NOT present initially (blocked by consent)
    let pageContent = await page.content();
    
    // Verify we are testing against the RIGHT ID. 
    // If the page still has the old ID, this check is invalid for consent blocking logic, but valid for "stale config" detection.
    if (pageContent.includes('GTM-TEST')) {
         console.log('WARNING: Stale GTM ID detected in page content');
    }

    const gtmActive = await page.evaluate((id) => {
        return Array.from(document.scripts).some(s => s.src.includes('googletagmanager') && s.src.includes(id));
    }, validGtmId);
    expect(gtmActive).toBeFalsy();

    // 2. Accept Consent
    // Find Klaro "I accept" button. It's usually "Accept all" or similar.
    const acceptBtn = page.locator('.cm-btn-success, button:has-text("Accept"), button:has-text("Zgoda")').first();
    await expect(acceptBtn).toBeVisible({ timeout: 15000 });
    await acceptBtn.click();
    
    // 3. Verify GTM loads after consent
    await page.waitForTimeout(2000); // Give it a moment to inject
    
    // Wait for the script to actually appear in the DOM
    try {
        await page.waitForFunction(
            (id) => document.head.innerHTML.includes(id) || document.body.innerHTML.includes(id),
            validGtmId,
            { timeout: 10000 }
        );
    } catch (e) {
        console.log('Timed out waiting for GTM ID in DOM');
    }
    
    pageContent = await page.content();
    expect(pageContent).toContain(validGtmId);

    // Check if dataLayer is initialized
    const dataLayerExists = await page.evaluate(() => typeof window['dataLayer'] !== 'undefined');
    expect(dataLayerExists).toBeTruthy();
  });

});

// =============================================================================
// Additional Integration Settings Tests
// =============================================================================

test.describe('Integrations - Field Persistence & Validation', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  const adminPassword = 'password123';

  const loginAsAdmin = async (page: any) => {
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

    await setAuthSession(page, adminEmail, adminPassword);

    await page.waitForTimeout(1000);
  };

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `int-persist-${Date.now()}-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (error) throw error;

    await supabaseAdmin
      .from('admin_users')
      .insert({ user_id: user!.id });
  });

  test.afterAll(async () => {
    // Cleanup integrations config
    await supabaseAdmin
      .from('integrations_config')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    // Delete test user
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const testUser = users.users.find((u: any) => u.email === adminEmail);
    if (testUser) {
      await supabaseAdmin.auth.admin.deleteUser(testUser.id);
    }
  });

  test('should save Facebook Pixel ID and persist in DB', async ({ page }) => {
    const pixelId = '9876543210123456';

    await loginAsAdmin(page);
    await page.goto('/dashboard/integrations');
    await page.waitForLoadState('networkidle');

    // Switch to Marketing tab
    await page.getByRole('button', { name: 'Marketing' }).click();
    await page.waitForTimeout(500);

    // Fill Pixel ID (placeholder is "1234567890")
    const pixelInput = page.locator('input[placeholder="1234567890"]');
    await pixelInput.fill(pixelId);

    // Save
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);

    // Verify in DB
    const { data: config } = await supabaseAdmin
      .from('integrations_config')
      .select('facebook_pixel_id')
      .single();

    expect(config?.facebook_pixel_id).toBe(pixelId);
  });

  test('should enable FB CAPI and save token', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/integrations');
    await page.waitForLoadState('networkidle');

    // Switch to Marketing tab
    await page.getByRole('button', { name: 'Marketing' }).click();
    await page.waitForTimeout(500);

    // Fill CAPI token first (checkbox is disabled until token exists)
    const tokenInput = page.locator('input[type="password"]').first();
    await tokenInput.fill('EAAtest_capi_token_12345');
    await page.waitForTimeout(300);

    // Now the checkbox should be enabled — check it
    const capiCheckbox = page.locator('#fb_capi_enabled');
    if (!(await capiCheckbox.isChecked())) {
      await capiCheckbox.check();
    }

    // Save
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);

    // Verify in DB
    const { data: config } = await supabaseAdmin
      .from('integrations_config')
      .select('fb_capi_enabled, facebook_capi_token')
      .single();

    expect(config?.fb_capi_enabled).toBe(true);
    expect(config?.facebook_capi_token).toBeTruthy();
  });

  test('should reject invalid GTM ID format', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/integrations');
    await page.waitForLoadState('networkidle');

    // Analytics tab is default — GTM input has placeholder "GTM-XXXXXX"
    const gtmInput = page.locator('input[placeholder="GTM-XXXXXX"]');
    await gtmInput.fill('INVALID-NOT-GTM');

    // Try to save
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);

    // Verify DB does NOT have the invalid value
    const { data: config } = await supabaseAdmin
      .from('integrations_config')
      .select('gtm_container_id')
      .maybeSingle();

    expect(config?.gtm_container_id).not.toBe('INVALID-NOT-GTM');
  });

  test('should reject non-numeric Facebook Pixel ID', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/integrations');
    await page.waitForLoadState('networkidle');

    // Switch to Marketing tab
    await page.getByRole('button', { name: 'Marketing' }).click();
    await page.waitForTimeout(500);

    // Fill invalid Pixel ID (non-numeric) — placeholder is "1234567890"
    const pixelInput = page.locator('input[placeholder="1234567890"]');
    await pixelInput.fill('not-a-number');

    // Try to save
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);

    // Verify DB does NOT have the invalid value
    const { data: config } = await supabaseAdmin
      .from('integrations_config')
      .select('facebook_pixel_id')
      .maybeSingle();

    expect(config?.facebook_pixel_id).not.toBe('not-a-number');
  });

  test('should show GTM SS toggle only when server container URL is filled', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/integrations');
    await page.waitForLoadState('networkidle');

    // Analytics tab — GTM section
    await page.getByRole('button', { name: 'Analytics' }).click();
    await page.waitForTimeout(500);

    const serverUrlInput = page.locator('input[placeholder="https://gtm.yourdomain.com"]');
    const ssCheckbox = page.getByText(/Enable server-to-server|Włącz wysyłkę eventów/i);

    // 1. With empty URL — checkbox must NOT be visible
    await serverUrlInput.fill('');
    await page.waitForTimeout(300);
    await expect(ssCheckbox).not.toBeVisible();

    // 2. Fill URL — checkbox must appear
    await serverUrlInput.fill('https://gtm.example.com');
    await page.waitForTimeout(300);
    await expect(ssCheckbox).toBeVisible();

    // 3. Clear URL — checkbox must disappear again
    await serverUrlInput.fill('');
    await page.waitForTimeout(300);
    await expect(ssCheckbox).not.toBeVisible();
  });

  test('should save GTM SS config and persist in DB', async ({ page }) => {
    const serverUrl = 'https://gtm-ss-test.example.com';

    await loginAsAdmin(page);
    await page.goto('/dashboard/integrations');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Analytics' }).click();
    await page.waitForTimeout(500);

    // Fill GTM Server Container URL
    const serverUrlInput = page.locator('input[placeholder="https://gtm.yourdomain.com"]');
    await serverUrlInput.fill(serverUrl);
    await page.waitForTimeout(300);

    // Enable GTM SS checkbox — visible only when server URL is filled
    const ssLabel = page.locator('label').filter({ hasText: /Enable server-to-server|Włącz wysyłkę eventów/i });
    await expect(ssLabel).toBeVisible({ timeout: 5000 });
    const ssCheckboxInput = ssLabel.locator('input[type="checkbox"]');
    await ssCheckboxInput.check();
    await page.waitForTimeout(300);

    // Save
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);

    // Verify in DB
    const { data: config } = await supabaseAdmin
      .from('integrations_config')
      .select('gtm_server_container_url, gtm_ss_enabled')
      .single();

    expect(config?.gtm_server_container_url).toBe(serverUrl);
    expect(config?.gtm_ss_enabled).toBe(true);
  });

  test('should persist GTM SS config after page reload', async ({ page }) => {
    // Pre-seed config in DB (upsert to handle existing row from previous test)
    const { data: existing } = await supabaseAdmin
      .from('integrations_config')
      .select('id')
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from('integrations_config')
        .update({
          gtm_server_container_url: 'https://gtm-reload-test.example.com',
          gtm_ss_enabled: true,
        })
        .eq('id', existing.id);
    } else {
      await supabaseAdmin
        .from('integrations_config')
        .insert({
          gtm_server_container_url: 'https://gtm-reload-test.example.com',
          gtm_ss_enabled: true,
        });
    }

    await loginAsAdmin(page);
    await page.goto('/dashboard/integrations');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Analytics' }).click();
    await page.waitForTimeout(500);

    // Verify URL is pre-filled
    const serverUrlInput = page.locator('input[placeholder="https://gtm.yourdomain.com"]');
    await expect(serverUrlInput).toHaveValue('https://gtm-reload-test.example.com');

    // Verify SS checkbox is visible AND checked
    const ssLabel = page.getByText(/Enable server-to-server|Włącz wysyłkę eventów/i);
    await expect(ssLabel).toBeVisible();

    // Find the actual checkbox input within the label's parent
    const checkboxContainer = ssLabel.locator('..');
    const checkbox = checkboxContainer.locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();
  });

  test('should reject invalid GTM Server Container URL (non-HTTPS)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/dashboard/integrations');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Analytics' }).click();
    await page.waitForTimeout(500);

    // Fill invalid URL (HTTP, not HTTPS)
    const serverUrlInput = page.locator('input[placeholder="https://gtm.yourdomain.com"]');
    await serverUrlInput.fill('http://not-https.example.com');

    // Save
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);

    // Verify DB does NOT have the invalid value
    const { data: config } = await supabaseAdmin
      .from('integrations_config')
      .select('gtm_server_container_url')
      .maybeSingle();

    expect(config?.gtm_server_container_url).not.toBe('http://not-https.example.com');
  });
});
