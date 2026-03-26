import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession } from './helpers/admin-auth';
import { STRIPE_API_VERSION, STRIPE_WEBHOOK_EVENTS } from '@/lib/constants';

/**
 * Stripe Webhook UI Tests
 *
 * Tests visual rendering and state management of the webhook section
 * in StripeSettings WITHOUT calling the real Stripe API.
 * DB state is set directly via supabaseAdmin to simulate registered/not-registered.
 *
 * For integration tests (actual Stripe API calls), see stripe-webhook-registration.spec.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SITE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3777';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error('Missing Supabase env variables for testing');
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const EXPECTED_WEBHOOK_URL = `${SITE_URL}/api/webhooks/stripe`;
const FAKE_ENDPOINT_ID = 'we_test_uifake123456';

test.describe('Stripe Webhook Section UI', () => {
  test.describe.configure({ mode: 'serial' });

  let adminEmail: string;
  let fakeConfigId: string;
  const adminPassword = 'password123';

  const loginAndGoToSettings = async (page: Page) => {
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
    await page.waitForLoadState('networkidle');
    await setAuthSession(page, adminEmail, adminPassword);
    await page.waitForTimeout(1000);
    await page.goto('/pl/dashboard/settings');
    await page.waitForLoadState('networkidle');
    // Wait for React hydration before clicking tab (can be slow under full-suite pressure)
    const paymentsTab = page.getByRole('button', { name: /^Payments$|^Płatności$/i });
    await expect(paymentsTab).toBeVisible({ timeout: 20000 });
    await paymentsTab.click();
    await page.waitForSelector('h4:has-text("Webhook Endpoint")', { timeout: 15000 });
  };

  const setWebhookEndpointId = async (id: string | null) => {
    await supabaseAdmin
      .from('stripe_configurations')
      .update({ webhook_endpoint_id: id })
      .eq('is_active', true);
  };

  test.beforeAll(async () => {
    const randomStr = Math.random().toString(36).substring(7);
    adminEmail = `test-stripe-webhook-ui-${Date.now()}-${randomStr}@example.com`;

    const { data: { user }, error } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });
    if (error) throw error;
    await supabaseAdmin.from('admin_users').insert({ user_id: user!.id });

    // Remove any leftover fake configs from previous runs (identified by key_last_4 = 'xxxx')
    await supabaseAdmin.from('stripe_configurations').delete().eq('key_last_4', 'xxxx');

    // Insert a fake stripe_configurations row so webhook state updates work.
    // The encrypted fields must be valid base64 with correct lengths to avoid
    // "Invalid IV length" errors when other tests try to decrypt active configs.
    // IV = 16 bytes, Tag = 16 bytes (AES-256-GCM)
    const fakeIv = Buffer.alloc(16, 0).toString('base64');   // 16 bytes → valid IV
    const fakeTag = Buffer.alloc(16, 0).toString('base64');  // 16 bytes → valid tag
    const { data: config, error: configError } = await supabaseAdmin
      .from('stripe_configurations')
      .insert({
        mode: 'test',
        encrypted_key: 'ui_test_fake_encrypted_key_placeholder',
        encryption_iv: fakeIv,
        encryption_tag: fakeTag,
        key_last_4: 'xxxx',
        key_prefix: 'sk_test_',
        is_active: true,
        webhook_endpoint_id: null,
      })
      .select('id')
      .single();
    if (configError) throw configError;
    fakeConfigId = config.id;
  });

  test.afterAll(async () => {
    // Delete the fake config row (also resets webhook state)
    if (fakeConfigId) {
      await supabaseAdmin.from('stripe_configurations').delete().eq('id', fakeConfigId);
    }

    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const testUser = users.users.find(u => u.email === adminEmail);
    if (testUser) await supabaseAdmin.auth.admin.deleteUser(testUser.id);
  });

  // ── Static content ────────────────────────────────────────────────────────

  test('shows webhook section heading', async ({ page }) => {
    await loginAndGoToSettings(page);

    await expect(page.locator('h4', { hasText: 'Webhook Endpoint' })).toBeVisible({ timeout: 10000 });
  });

  test('shows correct webhook endpoint URL', async ({ page }) => {
    await loginAndGoToSettings(page);

    const urlCode = page.locator('code', { hasText: EXPECTED_WEBHOOK_URL });
    await expect(urlCode).toBeVisible({ timeout: 10000 });
    await expect(urlCode).toContainText(EXPECTED_WEBHOOK_URL);
  });

  test('URL contains NEXT_PUBLIC_SITE_URL as origin', async ({ page }) => {
    await loginAndGoToSettings(page);

    const urlCode = page.locator('code', { hasText: EXPECTED_WEBHOOK_URL });
    await expect(urlCode).toBeVisible({ timeout: 10000 });
  });

  test('shows correct Stripe API version', async ({ page }) => {
    await loginAndGoToSettings(page);

    const versionCode = page.locator('code', { hasText: STRIPE_API_VERSION });
    await expect(versionCode).toBeVisible({ timeout: 10000 });
  });

  test('shows all required webhook events', async ({ page }) => {
    await loginAndGoToSettings(page);

    for (const event of STRIPE_WEBHOOK_EVENTS) {
      await expect(page.locator('code', { hasText: event })).toBeVisible({ timeout: 10000 });
    }
  });

  test('shows correct number of required events', async ({ page }) => {
    await loginAndGoToSettings(page);

    // Wait for events section to load
    await expect(page.locator('code', { hasText: 'checkout.session.completed' })).toBeVisible({ timeout: 10000 });

    // Count event badges — match lowercase-only event names (no hyphens/digits/slashes like URL or API version)
    const eventCodes = page.locator('code').filter({ hasText: /^[a-z][a-z_.]+$/ });
    await expect(eventCodes).toHaveCount(STRIPE_WEBHOOK_EVENTS.length);
  });

  test('"Open Stripe Webhooks" link points to Stripe Dashboard', async ({ page }) => {
    await loginAndGoToSettings(page);

    const link = page.locator('a', { hasText: /open stripe webhooks|otwórz stripe webhooks/i });
    await expect(link).toBeVisible({ timeout: 10000 });
    await expect(link).toHaveAttribute('href', 'https://dashboard.stripe.com/webhooks');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  // ── Copy button ───────────────────────────────────────────────────────────

  test('copy button is visible', async ({ page }) => {
    await loginAndGoToSettings(page);

    const copyBtn = page.locator('button', { hasText: /kopiuj|copy/i });
    await expect(copyBtn).toBeVisible({ timeout: 10000 });
  });

  test('copy button shows "Copied!" feedback for 2 seconds then reverts', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loginAndGoToSettings(page);

    const copyBtn = page.locator('button', { hasText: /^kopiuj$|^copy$/i });
    await copyBtn.click();

    // Immediately shows "Copied!"
    await expect(page.locator('button', { hasText: /skopiowano|copied/i })).toBeVisible();

    // Reverts back after ~2s
    await page.waitForTimeout(2500);
    await expect(copyBtn).toBeVisible();
  });

  test('copy button copies the correct URL', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loginAndGoToSettings(page);

    await page.locator('button', { hasText: /^kopiuj$|^copy$/i }).click();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(EXPECTED_WEBHOOK_URL);
  });

  // ── Localhost dev guide section ───────────────────────────────────────────
  //
  // When SITE_URL contains 'localhost', StripeSettings renders a Stripe CLI
  // dev guide instead of registration buttons (isLocalUrl=true branch).
  // These tests verify that section renders correctly.

  test('shows local dev notice instead of registration buttons on localhost', async ({ page }) => {
    await loginAndGoToSettings(page);

    await expect(
      page.locator('text=/unavailable on localhost|nie działa na localhost/i').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows link to Stripe CLI documentation', async ({ page }) => {
    await loginAndGoToSettings(page);

    const cliLink = page.locator('a', { hasText: 'Stripe CLI' });
    await expect(cliLink).toBeVisible({ timeout: 10000 });
    await expect(cliLink).toHaveAttribute('href', 'https://stripe.com/docs/webhooks#test-webhook');
  });

  test('shows stripe listen command with correct webhook path', async ({ page }) => {
    await loginAndGoToSettings(page);

    const listenCmd = page.locator('code', { hasText: 'stripe listen --forward-to' });
    await expect(listenCmd).toBeVisible({ timeout: 10000 });
    await expect(listenCmd).toContainText('/api/webhooks/stripe');
  });

  test('shows STRIPE_WEBHOOK_SECRET placeholder', async ({ page }) => {
    await loginAndGoToSettings(page);

    const secretCode = page.locator('code', { hasText: 'STRIPE_WEBHOOK_SECRET=whsec_' });
    await expect(secretCode).toBeVisible({ timeout: 10000 });
  });

  test('CLI guide shows regardless of webhook_endpoint_id DB value', async ({ page }) => {
    // Even when a webhook is registered in DB, localhost still shows CLI guide
    await setWebhookEndpointId(FAKE_ENDPOINT_ID);
    await loginAndGoToSettings(page);
    await expect(
      page.locator('code', { hasText: 'stripe listen --forward-to' })
    ).toBeVisible({ timeout: 10000 });

    // And when not registered — still CLI guide
    await setWebhookEndpointId(null);
    await loginAndGoToSettings(page);
    await expect(
      page.locator('code', { hasText: 'stripe listen --forward-to' })
    ).toBeVisible({ timeout: 10000 });
  });
});
