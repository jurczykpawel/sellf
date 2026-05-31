import { test, expect, Page } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession, createTestAdmin, supabaseAdmin } from './helpers/admin-auth';

// The test server runs with DEMO_MODE=true, which forces the license to business
// tier — so per-product scoping is unlocked. These tests cover the unlocked flow
// end-to-end (UI → /api/v1/webhooks → webhook_endpoint_products). The locked
// (sub-Pro) state is exercised by the API integration + unit tests, which can
// stub the tier; the UI lock cannot be reached while DEMO_MODE forces business.

// Host must resolve in DNS — the webhook URL validator rejects non-resolving
// hostnames (SSRF guard). example.com resolves; uniqueness lives in the path.
const URL_PREFIX = 'https://example.com/wh-scope-e2e/';
const PRODUCT_PREFIX = 'wh-scope-e2e-';

async function createProduct(name: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      name,
      slug: `${PRODUCT_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      price: 1000,
      currency: 'USD',
      is_active: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function gotoWebhooks(page: Page, email: string, password: string): Promise<void> {
  await acceptAllCookies(page);
  await page.addInitScript(() => {
    const addStyle = () => {
      if (document.head) {
        const style = document.createElement('style');
        style.innerHTML = '#cc-main { display: none !important; }';
        document.head.appendChild(style);
      } else {
        setTimeout(addStyle, 10);
      }
    };
    addStyle();
  });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await setAuthSession(page, email, password);
  await page.goto('/en/dashboard/webhooks');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'Webhook Integrations' })).toBeVisible({ timeout: 15000 });
}

async function openAddEndpoint(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add Endpoint' }).first().click();
  await expect(page.locator('#webhook-form')).toBeVisible();
}

async function fillUrlAndEvent(page: Page, url: string): Promise<void> {
  await page.locator('#webhook-form input[type="url"]').fill(url);
  await page.locator('#webhook-form label', { hasText: 'Purchase Completed' }).locator('input[type="checkbox"]').check();
}

test.describe('Per-product webhook scoping', () => {
  test.describe.configure({ mode: 'serial' });

  let admin: { email: string; password: string; cleanup: () => Promise<void> };

  test.beforeAll(async () => {
    admin = await createTestAdmin('wh-scope-admin');
  });

  test.afterAll(async () => {
    await supabaseAdmin.from('webhook_endpoints').delete().like('url', `${URL_PREFIX}%`);
    await supabaseAdmin.from('products').delete().like('slug', `${PRODUCT_PREFIX}%`);
    await admin.cleanup();
  });

  test('creating an all-products webhook shows the All products badge', async ({ page }) => {
    await gotoWebhooks(page, admin.email, admin.password);
    await openAddEndpoint(page);

    const url = `${URL_PREFIX}all-${Date.now()}`;
    await fillUrlAndEvent(page, url);
    await page.getByRole('button', { name: 'All products' }).click();
    await page.getByRole('button', { name: 'Create' }).click();

    const row = page.locator('tr', { hasText: url });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.getByText('All products')).toBeVisible();
  });

  test('selecting products scopes the webhook and shows the Selected badge', async ({ page }) => {
    await createProduct('Scoping E2E Product');
    await gotoWebhooks(page, admin.email, admin.password);
    await openAddEndpoint(page);

    const url = `${URL_PREFIX}scoped-${Date.now()}`;
    await fillUrlAndEvent(page, url);
    await page.getByRole('button', { name: 'Selected products' }).click();

    await expect(
      page.getByText('Events not tied to a specific product will still fire for all products', { exact: false }),
    ).toBeVisible();

    await page.locator('#webhook-form label', { hasText: 'Scoping E2E Product' }).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Create' }).click();

    const row = page.locator('tr', { hasText: url });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.getByText(/Selected \(1\)/)).toBeVisible();
  });

  test('editing an all-products webhook to selected updates the badge', async ({ page }) => {
    const url = `${URL_PREFIX}edit-${Date.now()}`;
    await supabaseAdmin.from('webhook_endpoints').insert({
      url,
      events: ['purchase.completed'],
      is_active: true,
      secret: `whsec_e2e_${Date.now()}`,
      product_filter_mode: 'all',
    });
    await createProduct('Edit Scoping Product');

    await gotoWebhooks(page, admin.email, admin.password);

    const row = page.locator('tr', { hasText: url });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.getByText('All products')).toBeVisible();
    await row.getByRole('button', { name: 'Edit' }).click();

    await expect(page.locator('#webhook-form')).toBeVisible();
    await page.getByRole('button', { name: 'Selected products' }).click();
    await page.locator('#webhook-form label', { hasText: 'Edit Scoping Product' }).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Update' }).click();

    await expect(row.getByText(/Selected \(1\)/)).toBeVisible({ timeout: 10000 });
  });
});
