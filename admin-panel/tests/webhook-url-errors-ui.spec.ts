import { test, expect } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession, createTestAdmin } from './helpers/admin-auth';

const CASES = [
  { locale: 'pl', title: 'Integracje Webhook', event: 'Zakup zakończony', add: 'Dodaj Endpoint', url: 'http://127.0.0.1:9/hook', message: 'Adres musi zaczynać się od https://.' },
  { locale: 'pl', title: 'Integracje Webhook', event: 'Zakup zakończony', add: 'Dodaj Endpoint', url: 'https://localhost/hook', message: 'Adres nie może wskazywać na localhost.' },
  { locale: 'en', title: 'Webhook Integrations', event: 'Purchase Completed', add: 'Add Endpoint', url: 'http://127.0.0.1:9/hook', message: 'The URL must start with https://.' },
];

test.describe('Webhook form shows URL errors in the interface language', () => {
  let admin: { email: string; password: string; cleanup: () => Promise<void> };
  test.beforeAll(async () => { admin = await createTestAdmin('wh-url-errors'); });
  test.afterAll(async () => { await admin.cleanup(); });

  for (const { locale, title, event, add, url, message } of CASES) {
    test(`${locale}: ${url}`, async ({ page }) => {
      await acceptAllCookies(page);
      await page.goto('/');
      await setAuthSession(page, admin.email, admin.password);
      await page.goto(`/${locale}/dashboard/webhooks`);
      await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: add }).first().click();
      await page.locator('#webhook-form input[type="url"]').fill(url);
      await page.locator('#webhook-form label', { hasText: event }).locator('input[type="checkbox"]').check();
      await page.locator('button[type="submit"][form="webhook-form"]').click();
      await expect(page.getByText(message)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('URL must use HTTPS protocol')).toHaveCount(0);
    });
  }
});
