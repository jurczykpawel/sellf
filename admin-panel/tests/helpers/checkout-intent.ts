/** Start native payment initialization through the buyer's explicit action.
 * @see src/app/[locale]/checkout/[slug]/components/PaidProductForm.tsx
 */
import { expect } from '@playwright/test';
import type { Page, Response } from '@playwright/test';

export async function startNativeCheckout(page: Page): Promise<Response> {
  const start = page.getByRole('button', { name: /^(Pay|Zapłać|Subscribe|Subskrybuj)\s/ });
  await expect(start).toBeVisible();
  await expect(start).toBeEnabled();
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/create-payment-intent' && response.request().method() === 'POST', { timeout: 15000 }),
    start.click(),
  ]);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(typeof body.clientSecret).toBe('string');
  expect(body.clientSecret.length).toBeGreaterThan(0);
  return response;
}
