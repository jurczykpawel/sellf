import { test, expect, type Page } from '@playwright/test';
import { supabaseAdmin, setAuthSession } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';

test.describe.configure({ mode: 'serial' });

type ProductFixture = {
  id: string;
  slug: string;
  name: string;
};

type CheckoutRequestBody = {
  productId?: string;
  email?: string;
  customAmount?: number;
};

const password = 'password123';
const createdProductIds: string[] = [];
let testUserId: string | null = null;
let testUserEmail = '';

const products: Record<string, ProductFixture> = {};

async function withSupabaseResultRetry<T>(
  operation: () => Promise<{ data: T; error: unknown }>
): Promise<{ data: T; error: unknown }> {
  let lastResult: { data: T; error: unknown } | null = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await operation();
    if (!JSON.stringify(result.error).includes('PGRST002')) {
      return result;
    }
    lastResult = result;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  return lastResult!;
}

async function createProduct(fields: Record<string, unknown>): Promise<ProductFixture> {
  const { data, error } = await withSupabaseResultRetry(() =>
    supabaseAdmin
      .from('products')
      .insert({
        description: 'Checkout UI regression fixture',
        is_active: true,
        icon: '🚀',
        allow_custom_price: false,
        ...fields,
      })
      .select('id, slug, name')
      .single()
  );

  if (error) throw error;
  createdProductIds.push(data.id);
  return data;
}

async function captureCheckoutRequests(
  page: Page,
  handler?: (body: CheckoutRequestBody) => { status: number; body: Record<string, unknown> } | null
) {
  const requests: CheckoutRequestBody[] = [];
  await page.route('**/api/create-payment-intent', async (route) => {
    const postData = route.request().postDataJSON() as CheckoutRequestBody;
    requests.push(postData);
    const response = handler?.(postData);
    if (response) {
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: JSON.stringify(response.body),
      });
      return;
    }
    // Keep the request pending so the checkout UI stays in its pre-Stripe state.
  });
  return requests;
}

async function openCheckout(page: Page, product: ProductFixture, asUser = false) {
  await acceptAllCookies(page);
  if (asUser) {
    await setAuthSession(page, testUserEmail, password);
  }
  await page.goto(`/pl/checkout/${product.slug}`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: product.name })).toBeVisible({ timeout: 15000 });
}

test.beforeAll(async () => {
  const suffix = Date.now();

  products.free = await createProduct({
    name: 'E2E Free Checkout',
    slug: `e2e-free-checkout-${suffix}`,
    price: 0,
    currency: 'PLN',
    product_type: 'one_time',
  });

  products.paid = await createProduct({
    name: 'E2E Paid Checkout',
    slug: `e2e-paid-checkout-${suffix}`,
    price: 99,
    currency: 'PLN',
    product_type: 'one_time',
  });

  products.pwyw = await createProduct({
    name: 'E2E PWYW Checkout',
    slug: `e2e-pwyw-checkout-${suffix}`,
    price: 50,
    currency: 'PLN',
    product_type: 'one_time',
    allow_custom_price: true,
    custom_price_min: 5,
    show_price_presets: true,
    custom_price_presets: [10, 25, 50],
  });

  products.pwywFree = await createProduct({
    name: 'E2E PWYW Free Checkout',
    slug: `e2e-pwyw-free-checkout-${suffix}`,
    price: 19,
    currency: 'PLN',
    product_type: 'one_time',
    allow_custom_price: true,
    custom_price_min: 0,
    show_price_presets: true,
    custom_price_presets: [0, 10, 25],
  });

  products.subscriptionMonth = await createProduct({
    name: 'E2E Monthly Subscription Checkout',
    slug: `e2e-sub-month-checkout-${suffix}`,
    price: 0,
    currency: 'PLN',
    product_type: 'subscription',
    recurring_price: 99,
    billing_interval: 'month',
    billing_interval_count: 1,
  });

  products.subscriptionYear = await createProduct({
    name: 'E2E Yearly Subscription Checkout',
    slug: `e2e-sub-year-checkout-${suffix}`,
    price: 0,
    currency: 'PLN',
    product_type: 'subscription',
    recurring_price: 120,
    billing_interval: 'year',
    billing_interval_count: 1,
  });

  testUserEmail = `checkout-user-${suffix}@example.com`;
  const { data: authData, error: authError } = await withSupabaseResultRetry(() =>
    supabaseAdmin.auth.admin.createUser({
      email: testUserEmail,
      password,
      email_confirm: true,
    })
  );
  if (authError) throw authError;
  testUserId = authData.user.id;
});

test.afterAll(async () => {
  if (createdProductIds.length > 0) {
    await withSupabaseResultRetry(() =>
      supabaseAdmin.from('user_product_access').delete().in('product_id', createdProductIds)
    );
    await withSupabaseResultRetry(() =>
      supabaseAdmin.from('payment_transactions').delete().in('product_id', createdProductIds)
    );
    await withSupabaseResultRetry(() => supabaseAdmin.from('products').delete().in('id', createdProductIds));
  }
  if (testUserId) {
    await supabaseAdmin.auth.admin.deleteUser(testUserId);
  }
});

test.describe('guest checkout variants', () => {
  test('free product shows magic-link access instead of payment checkout', async ({ page }) => {
    const checkoutRequests = await captureCheckoutRequests(page);
    await openCheckout(page, products.free);

    await expect(page.getByRole('button', { name: /Wyślij magiczny link/i })).toBeVisible();
    await expect(page.getByLabel(/Adres email/i)).toBeVisible();
    await expect(page.getByText(/Dokończ Zakup/i)).toHaveCount(0);
    expect(checkoutRequests).toHaveLength(0);
  });

  test('paid one-time product shows payment checkout without PWYW or magic-link controls', async ({ page }) => {
    const checkoutRequests = await captureCheckoutRequests(page);
    await openCheckout(page, products.paid);

    await expect(page.getByText(/Dokończ Zakup/i)).toBeVisible();
    await expect(page.getByText(/zł99\.00/i).first()).toBeVisible();
    await expect(page.getByText(/Wybierz kwotę/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Wyślij magiczny link/i })).toHaveCount(0);
    await expect.poll(() => checkoutRequests.length).toBeGreaterThan(0);
    expect(checkoutRequests[0]).toMatchObject({ productId: products.paid.id });
  });

  test('PWYW paid product shows amount picker and paid checkout controls', async ({ page }) => {
    const checkoutRequests = await captureCheckoutRequests(page);
    await openCheckout(page, products.pwyw);

    await expect(page.getByText(/Wybierz kwotę/i)).toBeVisible();
    await expect(page.locator('button').filter({ hasText: /zł10\.00/i }).first()).toBeVisible();
    await expect(page.locator('input[inputmode="decimal"]').first()).toHaveValue('50');
    await expect(page.getByRole('button', { name: /Wyślij magiczny link/i })).toHaveCount(0);
    await expect.poll(() => checkoutRequests.length).toBeGreaterThan(0);
    expect(checkoutRequests[0]).toMatchObject({ productId: products.pwyw.id, customAmount: 50 });
  });

  test('PWYW free option shows free preset and switches to magic-link flow when selected', async ({ page }) => {
    await captureCheckoutRequests(page);
    await openCheckout(page, products.pwywFree);

    await expect(page.getByText(/Wybierz kwotę/i)).toBeVisible();
    const freePreset = page.getByRole('button', { name: /Za darmo/i });
    await expect(freePreset).toBeVisible();
    await freePreset.click();

    await expect(page.getByRole('button', { name: /Wyślij magiczny link/i })).toBeVisible();
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
  });

  test('subscription guest initializes checkout immediately without magic-link or PWYW flow', async ({ page }) => {
    const checkoutRequests = await captureCheckoutRequests(page);
    await openCheckout(page, products.subscriptionMonth);

    await expect(page.getByText(/zł99\.00 \/ mies\./i)).toBeVisible();
    await expect(page.getByTestId('subscription-email-gate')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Wyślij magiczny link/i })).toHaveCount(0);
    await expect(page.getByText(/Wybierz kwotę/i)).toHaveCount(0);
    await expect.poll(() => checkoutRequests.length).toBeGreaterThan(0);
    expect(checkoutRequests[0]).toMatchObject({
      productId: products.subscriptionMonth.id,
    });
    expect(checkoutRequests[0].email).toBeUndefined();
  });

  test('subscription guest initializes the real Stripe subscription form immediately', async ({ page }) => {
    await openCheckout(page, products.subscriptionMonth);

    await expect(page.getByText(/zł99\.00 \/ mies\./i)).toBeVisible();
    await expect(page.getByTestId('subscription-email-gate')).toHaveCount(0);

    await expect(page.locator('input#checkoutEmail')).toBeVisible({ timeout: 30000 });
    await page.locator('input#checkoutEmail').fill(`subscription-checkout-${Date.now()}@gmail.com`);
    await expect(page.locator('input#fullName')).toBeVisible({ timeout: 30000 });
    await page.locator('input#fullName').fill('Subscription Buyer');
    await page.locator('input[type="checkbox"]').first().check();
    // Subscription CTA must say "Subskrybuj", NOT "Zapłać" — recurrence signal.
    const cta = page.getByRole('button', { name: /Subskrybuj|Subscribe/i });
    await expect(cta).toBeVisible({ timeout: 30000 });
    await expect(cta).toHaveText(/Subskrybuj|Subscribe/i);
    await expect(cta).toContainText(/\/ mies\.|\/ month/i);
    // And the inline currency code must not double up next to the symbol.
    await expect(cta).not.toContainText(/zł[\d.,]+ PLN/i);
    await expect(page.locator('iframe[name^="__privateStripeFrame"]').first()).toBeAttached({ timeout: 30000 });
    await cta.click();
    await expect(page.getByText(/cannot provide `billingAddress`/i)).toHaveCount(0);
    await expect(page.getByText(/cannot provide `returnUrl`/i)).toHaveCount(0);
    await expect(page.getByText(/Błąd Płatności/i)).toHaveCount(0);
  });

  test('one-time paid product CTA says "Zapłać" (not "Subskrybuj") and has no double currency', async ({ page }) => {
    await openCheckout(page, products.paid);
    await expect(page.locator('input#checkoutEmail')).toBeVisible({ timeout: 30000 });
    await page.locator('input#checkoutEmail').fill(`paid-${Date.now()}@gmail.com`);
    await page.locator('input#fullName').fill('Paid Buyer');
    await page.locator('input[type="checkbox"]').first().check();
    const cta = page.getByRole('button', { name: /Zapłać|Pay/i });
    await expect(cta).toBeVisible({ timeout: 30000 });
    await expect(cta).not.toHaveText(/Subskrybuj|Subscribe/i);
    await expect(cta).not.toContainText(/\/ mies\.|\/ month/i);
    await expect(cta).not.toContainText(/zł[\d.,]+ PLN/i);
  });

  test('subscription guest validates email inside the Stripe form before confirming', async ({ page }) => {
    await page.route('**/api/validate-email', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            isValid: false,
            isDisposable: true,
            domain: 'mailinator.com',
            error: 'Invalid or disposable email address not allowed',
          },
          meta: {
            timestamp: new Date().toISOString(),
            processingTime: 1,
            domainsLoaded: 1,
          },
        }),
      });
    });

    await openCheckout(page, products.subscriptionMonth);

    await expect(page.locator('input#checkoutEmail')).toBeVisible({ timeout: 30000 });
    await page.locator('input#checkoutEmail').fill('buyer@mailinator.com');
    await page.locator('input#fullName').fill('Buyer Testowy');
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole('button', { name: /Zapłać|Pay|Subskrybuj|Subscribe/i }).click();

    await expect(page.getByText(/Invalid or disposable email address not allowed/i)).toBeVisible();
  });

  test('yearly subscription guest shows yearly recurring price', async ({ page }) => {
    const checkoutRequests = await captureCheckoutRequests(page);
    await openCheckout(page, products.subscriptionYear);

    await expect(page.getByText(/zł120\.00 \/ rok/i)).toBeVisible();
    await expect(page.getByTestId('subscription-email-gate')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Wyślij magiczny link/i })).toHaveCount(0);
    await expect.poll(() => checkoutRequests.length).toBeGreaterThan(0);
    expect(checkoutRequests[0]).toMatchObject({ productId: products.subscriptionYear.id });
    expect(checkoutRequests[0].email).toBeUndefined();
  });
});

test.describe('logged-in checkout variants', () => {
  test('free product grants direct-access UI instead of guest magic link', async ({ page }) => {
    const checkoutRequests = await captureCheckoutRequests(page);
    await openCheckout(page, products.free, true);

    await expect(page.getByRole('button', { name: /Uzyskaj darmowy dostęp/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Wyślij magiczny link/i })).toHaveCount(0);
    await expect(page.getByLabel(/Adres email/i)).toHaveCount(0);
    expect(checkoutRequests).toHaveLength(0);
  });

  test('logged-in paid product shows payment checkout and posts product id', async ({ page }) => {
    const checkoutRequests = await captureCheckoutRequests(page);
    await openCheckout(page, products.paid, true);

    await expect(page.getByText(/Dokończ Zakup/i)).toBeVisible();
    await expect(page.getByText(/zł99\.00/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Wyślij magiczny link/i })).toHaveCount(0);
    await expect.poll(() => checkoutRequests.length).toBeGreaterThan(0);
    expect(checkoutRequests[0]).toMatchObject({ productId: products.paid.id });
  });

  test('logged-in subscription skips guest email gate and posts account email', async ({ page }) => {
    const checkoutRequests = await captureCheckoutRequests(page);
    await openCheckout(page, products.subscriptionMonth, true);

    await expect(page.getByText(/zł99\.00 \/ mies\./i)).toBeVisible();
    await expect(page.getByTestId('subscription-email-gate')).toHaveCount(0);
    await expect(page.getByText(/Wybierz kwotę/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Wyślij magiczny link/i })).toHaveCount(0);
    await expect.poll(() => checkoutRequests.length).toBeGreaterThan(0);
    expect(checkoutRequests[0]).toMatchObject({
      productId: products.subscriptionMonth.id,
      email: testUserEmail,
    });
  });
});
