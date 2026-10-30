/** Observe automatic online checkout, or confirm an available method choice. */
import { test as base, expect } from '@playwright/test';
import type { Page, Request, Response } from '@playwright/test';

const captured = new WeakMap<Page, Response[]>();
export const test = base.extend({ page: async ({ page }, use) => {
  let visit = 0;
  const requests = new WeakMap<Request, number>();
  captured.set(page, []);
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) { visit++; captured.set(page, []); }
    if (new URL(request.url()).pathname === '/api/create-payment-intent' && request.method() === 'POST' && !request.postDataJSON()?.expireOnly) requests.set(request, visit);
  });
  page.on('response', response => {
    if (requests.get(response.request()) === visit) captured.get(page)?.push(response);
  });
  await use(page);
} });

export async function startNativeCheckout(page: Page): Promise<Response> {
  const start = page.getByRole('button', { name: /^(Continue to payment|Przejdź do płatności)$/ });
  await expect.poll(async () => await start.isVisible() || !!captured.get(page)?.length, { timeout: 90000 }).toBe(true);
  if (await start.isVisible()) {
    await expect(start).toBeEnabled();
    await start.click();
    await expect.poll(() => captured.get(page)?.length ?? 0, { timeout: 90000 }).toBeGreaterThan(0);
  }
  await expect(page.locator('[data-test-email]')).toBeVisible({ timeout: 90000 });
  const response = captured.get(page)!.at(-1)!;
  captured.set(page, []);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(typeof body.clientSecret).toBe('string');
  expect(body.clientSecret.length).toBeGreaterThan(0);
  return response;
}
