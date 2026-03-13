import { test, expect } from '@playwright/test';
import { waitForEmail, extractMagicLink, deleteAllMessages } from './helpers/mailpit';
import { acceptAllCookies } from './helpers/consent';

test.describe('Profile Management E2E', () => {
  const testEmail = `profile-test-${Date.now()}@example.com`;

  test.beforeAll(async () => {
    // Clear mailpit to avoid confusion
    try {
        await deleteAllMessages();
    } catch (e) {
        console.warn('Failed to clear messages, ignoring...', e);
    }
  });

  test('should update user profile successfully', async ({ page }) => {
    // 1. Login Logic
    await acceptAllCookies(page);
    await page.goto('/login');
    
    // Fill email
    await page.locator('input[type="email"]').fill(testEmail);
    
    // Check terms if present
    const termsCheckbox = page.locator('input#terms-checkbox');
    if (await termsCheckbox.count() > 0) {
        await termsCheckbox.check({ force: true });
    }

    // Wait for captcha auto-verify (Turnstile dummy key or ALTCHA PoW)
    await page.waitForTimeout(3000);

    // Submit
    await page.getByRole('button', { name: /send|magic|login|sign in|zaloguj/i }).first().click();
    
    // Wait for UI confirmation (CRITICAL: confirms API call succeeded)
    await expect(page.getByText(/check your email|sprawdź swój email|success|sukces/i).first()).toBeVisible({ timeout: 10000 });
    
    // Wait for email
    console.log('Waiting for email...');
    const message = await waitForEmail(testEmail, { timeout: 15000 });
    const magicLink = extractMagicLink(message.Text!);
    
    if (!magicLink) {
        throw new Error('Magic link not found in email');
    }

    console.log('Logging in with magic link...');
    // Login via link
    await page.goto(magicLink);
    // After magic link, URL may or may not include locale prefix
    await expect(page).toHaveURL(/\/(en|pl)\/(dashboard|my-products)|\/my-products|\/dashboard/, { timeout: 15000 });

    // 2. Navigate to Profile
    await page.goto('/en/profile'); // Force EN locale
    
    // 3. Fill Form
    await page.locator('input[placeholder="John"]').fill('John');
    await page.locator('input[placeholder="Doe"]').fill('Doe');
    await page.locator('input[placeholder="PL1234567890"]').fill('PL5555555555');
    await page.locator('input[placeholder="Acme Inc."]').fill('Test Corp');
    
    // 4. Save
    await page.getByRole('button', { name: /save|zapisz/i }).click();
    
    // 5. Assert Success Message
    await expect(page.getByText(/Profile updated successfully/i)).toBeVisible();
    
    // 6. Reload and Verify Persistence
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Use toHaveValue to check actual input values after reload (not CSS attribute selectors)
    const firstNameInput = page.locator('input[placeholder="John"]');
    await expect(firstNameInput).toBeVisible({ timeout: 10000 });
    await expect(firstNameInput).toHaveValue('John');

    const lastNameInput = page.locator('input[placeholder="Doe"]');
    await expect(lastNameInput).toHaveValue('Doe');

    const taxIdInput = page.locator('input[placeholder="PL1234567890"]');
    await expect(taxIdInput).toHaveValue('PL5555555555');

    const companyInput = page.locator('input[placeholder="Acme Inc."]');
    await expect(companyInput).toHaveValue('Test Corp');
  });
});