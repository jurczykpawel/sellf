/** Test-mode login methods use local auth and email. @see src/components/LoginForm.tsx */
import { test, expect } from '@playwright/test';
import { createTestUser } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import { extractMagicLink, waitForEmail } from './helpers/mailpit';

test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['pl', 'en']) {
  const prefix = locale === 'pl' ? '/pl' : '';
  for (const method of ['password', 'magic']) {
    test(`${locale}: ${method} signs in from the partner login on mobile`, async ({ page }, testInfo) => {
      const user = await createTestUser(`login-both-${locale}-${method}`);
      try {
        await acceptAllCookies(page);
        await page.goto(`${prefix}/login?redirect_to=${prefix}/affiliates/apply`);
        const linkButton = page.getByRole('button', { name: locale === 'pl' ? 'Wyślij link na maila' : 'Email me a sign-in link', exact: true });
        await expect(linkButton).toBeVisible();
        await expect(linkButton).toBeEnabled();
        await page.screenshot({ path: testInfo.outputPath('login-mobile.png'), fullPage: true });
        await page.locator('#email').fill(user.email);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (method === 'password') {
          await page.locator('#password').fill(user.password);
          await page.locator('#password').press('Enter');
        } else {
          await linkButton.click();
          await expect(page.locator('form')).toContainText(locale === 'pl' ? 'Prosimy o zaakceptowanie regulaminu i polityki prywatności' : 'Please accept the Terms of Service and Privacy Policy');
          await page.locator('label[for="terms-checkbox"] > div').click();
          await expect(page.locator('#terms-checkbox')).toBeChecked();
          const sent = page.waitForResponse(r => r.url().includes('/api/auth/magic-link') && r.request().method() === 'POST');
          await linkButton.click();
          expect((await sent).status()).toBe(200);
          const email = await waitForEmail(user.email);
          const link = extractMagicLink(email.HTML || email.Text || '');
          expect(link).toBeTruthy();
          await page.goto(link!);
        }
        await expect(page).toHaveURL(new RegExp(`${prefix}/affiliates/apply$`), { timeout: 30000 });
        await expect(page.locator('#password')).toHaveCount(0);
      } finally {
        await user.cleanup();
      }
    });
  }
}
