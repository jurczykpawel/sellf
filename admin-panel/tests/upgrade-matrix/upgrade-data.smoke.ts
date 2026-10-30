import { test, startNativeCheckout } from '../helpers/checkout-intent';
/** Browser smoke on the populated historical database. @see scripts/upgrade-data-test.sh */
import { expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin } from '../helpers/admin-auth';
import { acceptAllCookies } from '../helpers/consent';

test('upgraded shop, historical product, admin login and historical payments', async ({ page }) => {
  await acceptAllCookies(page);
  const shop = await page.goto('/pl');
  expect(shop?.status()).toBe(200);
  await expect(page.getByText('Upgrade Gross', { exact: true }).first()).toBeVisible();
  const product = await page.goto('/pl/p/upgrade-gross');
  expect(product?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Upgrade Gross' }).first()).toBeVisible();
  const admin = await createTestAdmin('upgrade-browser');
  try {
    await loginAsAdmin(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/payments');
    await expect(page.getByRole('row').filter({ hasText: 'upgrade-member@example.com' }).first()).toBeVisible();
  } finally {
    await admin.cleanup();
  }
});

test('historical product without a profile opens a new purchase payment form', async ({ page }) => {
  // Browser payment transport is stubbed, matching checkout-payment-e2e; no Stripe payment runs.
  await page.route('**/api/create-payment-intent', route => route.fulfill({
    json: { clientSecret: 'cs_test_upgrade_secret_fixture', checkoutSessionId: 'cs_test_upgrade', amount: 12300 },
  }));
  await page.addInitScript(() => {
    const session = { id: 'cs_test_upgrade', currency: 'pln', email: null, lineItems: [],
      total: { total: { minorUnitsAmount: 12300, amount: '123.00' } }, status: { type: 'open' } };
    Object.defineProperty(window, 'Stripe', { configurable: true, value: () => ({
      elements: () => ({}), createToken: async () => ({}), createPaymentMethod: async () => ({}),
      confirmCardPayment: async () => ({}),
      initCheckoutElementsSdk: () => ({
        on: () => {}, changeAppearance: () => {}, loadFonts: () => {},
        createPaymentElement: () => ({
          mount: (target: string | HTMLElement) => {
            const container = typeof target === 'string' ? document.querySelector(target) : target;
            const element = document.createElement('div');
            element.setAttribute('data-testid', 'upgrade-payment-element');
            element.textContent = 'Local payment element';
            container?.appendChild(element);
          },
          on: () => {}, update: () => {}, unmount: () => {}, destroy: () => {},
        }),
        loadActions: async () => ({ type: 'success', actions: {
          getSession: () => session, updateEmail: async () => ({ type: 'success', session }),
          updateBillingAddress: async () => ({ type: 'success', session }),
          confirm: async () => ({ type: 'success', session }),
        } }),
      }),
    }) });
  });
  await page.route('https://js.stripe.com/**', route => route.fulfill({
    contentType: 'application/javascript', body: '/* local payment transport */',
  }));
  await acceptAllCookies(page);
  await page.goto('/pl/checkout/upgrade-gross');
  const response = await startNativeCheckout(page);
  expect(response.status()).toBe(200);
  await expect(page.locator('#fullName')).toBeVisible();
  await expect(page.getByTestId('upgrade-payment-element')).toBeVisible();
});
