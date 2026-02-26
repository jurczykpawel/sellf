import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { waitForEmail, extractMagicLink } from './helpers/mailpit';
import { acceptAllCookies } from './helpers/consent';

// Enforce single worker
test.describe.configure({ mode: 'serial' });

test.describe('Magic Link Authentication (Mailpit)', () => {
  test('should send magic link and authenticate user', async ({ page }) => {
    const testEmail = `magiclink-${Date.now()}@example.com`;

    // 1. Navigate to login page
    await acceptAllCookies(page);
    await page.goto('/login');
    await expect(page.locator('h1').filter({ hasText: /GateFlow/i })).toBeVisible();

    // 2. Fill email
    const emailInput = page.locator('input[type="email"]');
    await emailInput.fill(testEmail);

    // 3. Check terms and conditions checkbox (force-check the hidden input)
    const termsCheckbox = page.locator('input#terms-checkbox');
    await termsCheckbox.check({ force: true });

    // 4. Wait for Turnstile widget to load and auto-verify (dummy key)
    // Look for "Test Mode" indicator which shows the widget has loaded
    await page.waitForSelector('text=🧪 Test Mode', { timeout: 10000 });
    // Give extra time for the dummy key to auto-verify and set the token
    await page.waitForTimeout(4000);

    // 5. Request magic link
    const submitButton = page.getByRole('button', { name: /send|magic|login|sign in/i }).first();
    await submitButton.click();

    // 6. Wait for form submission and check for success or retry
    // If "Please complete the security verification" appears, wait and retry
    await page.waitForTimeout(1500);
    const errorMessage = page.locator('text=Please complete the security verification');
    if (await errorMessage.isVisible()) {
      console.log('Turnstile not ready, waiting and retrying...');
      // Turnstile wasn't ready, wait more and retry
      await page.waitForTimeout(4000);
      await submitButton.click();
      await page.waitForTimeout(1500);
      // Verify the error is resolved after retry
      await expect(errorMessage).not.toBeVisible({ timeout: 5000 });
    }

    console.log(`Waiting for email to ${testEmail}...`);
    await page.waitForTimeout(3000); // Give time for Supabase to send email

    // 7. Fetch email from Mailpit
    const message = await waitForEmail(testEmail, { timeout: 15000 });

    expect(message).toBeTruthy();
    expect(message.Subject).toContain('Magic Link');

    // 5. Extract magic link from email
    const magicLink = extractMagicLink(message.Text!);
    expect(magicLink).toBeTruthy();

    console.log('Magic link found:', magicLink);

    // 6. Click the magic link
    await page.goto(magicLink!);
    await page.waitForTimeout(3000);

    // 7. Should be redirected to authenticated area (dashboard or my-products)
    await expect(page).toHaveURL(/\/(dashboard|my-products|$)/, { timeout: 10000 });

    // 8. Verify user is authenticated - check current page
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('/login');

    // Should see authenticated content (email or logout button)
    const bodyText = await page.locator('body').textContent();
    const hasEmail = bodyText?.includes(testEmail);
    const hasLogout = bodyText?.toLowerCase().includes('logout') || bodyText?.toLowerCase().includes('sign out');
    const hasAuthPages = bodyText?.toLowerCase().includes('my products') || bodyText?.toLowerCase().includes('dashboard');

    if (!hasEmail && !hasLogout && !hasAuthPages) {
      expect.fail(`Expected authenticated content (email, logout, or dashboard) but page body did not contain any. URL: ${currentUrl}`);
    }
  });

  test('should handle invalid credentials gracefully (mocked)', async ({ page }) => {
    // Mock invalid magic link by trying to sign in with wrong password
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const mockEmail = `invalid-${Date.now()}@example.com`;

    // Create user
    const { data: { user } } = await supabaseAdmin.auth.admin.createUser({
      email: mockEmail,
      password: 'CorrectPassword123!',
      email_confirm: true,
    });

    await page.goto('/');

    // Try to sign in with wrong password (simulates invalid/expired magic link)
    const signInResult = await page.evaluate(async ({ email, supabaseUrl, anonKey }) => {
      const { createBrowserClient } = await import('https://esm.sh/@supabase/ssr@0.5.2');
      const supabase = createBrowserClient(supabaseUrl, anonKey);
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: 'WrongPassword123!'
      });
      return { hasError: !!error, errorMessage: error?.message };
    }, {
      email: mockEmail,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    });

    expect(signInResult.hasError).toBeTruthy();
    expect(signInResult.errorMessage).toContain('Invalid');

    // Cleanup
    if (user) {
      await supabaseAdmin.auth.admin.deleteUser(user.id);
    }
  });
});
