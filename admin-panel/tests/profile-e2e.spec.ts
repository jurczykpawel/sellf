import { test, expect } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { createTestUser, setAuthSession } from './helpers/admin-auth';

test.describe('Profile Management E2E', () => {
  test('should update user profile successfully', async ({ page }) => {
    const user = await createTestUser('profile-test');
    try {
      await acceptAllCookies(page);
      await page.goto('/');
      await setAuthSession(page, user.email, user.password);
      await page.goto('/en/profile');
    
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
    } finally {
      await user.cleanup();
    }
  });
});
