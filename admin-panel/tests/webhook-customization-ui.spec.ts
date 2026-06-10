import { test, expect, Page } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession, createTestAdmin, supabaseAdmin } from './helpers/admin-auth';

// The webhook payload-customization block ("Custom integration (Pro)") is gated by
// the license tier resolved SERVER-SIDE in the webhooks page (resolveCurrentTier →
// hasFeature(tier, 'webhook-payload-customization')). Unlike the product-scoping
// spec — which leans on DEMO_MODE forcing 'business' and so can only reach the
// UNLOCKED state — this spec must exercise BOTH the free upsell and the Pro form.
//
// To flip the tier within one shared dev server, the worktree .env.local blanks
// SELLF_LICENSE_KEY so the resolver falls through to the DB
// (integrations_config.sellf_license): null → 'free' (upsell), a valid business
// license → 'business' (unlocked). The tests run serially and set the DB license
// per scenario, restoring it on teardown.
//
// SECURITY: header *values* are write-only and stored encrypted. These tests
// assert the boolean `has_custom_headers` (via DB) and the "configured" affordance
// only — never any plaintext/encrypted header value.

// Host must resolve in DNS — the webhook URL validator rejects non-resolving
// hostnames (SSRF guard). example.com resolves; uniqueness lives in the path.
const URL_PREFIX = 'https://example.com/wh-cust-e2e/';

// Local-only business license for localhost (tier=business, domain=localhost).
// Same key the dev env normally carries; written into the DB to unlock the Pro
// form while the env var stays blank so the DB is the single source of tier truth.
const BUSINESS_LICENSE =
  'SF-localhost-BIZ-UNLIMITED-MEQCIBsFL0BGiweQ03Bmxooexd7k_wnIFbbM1_A-6GF-TMCxAiA6A-xrIYK_X-Yc4VmVypHNy-hKD4Y-5kkprBTX7yyXiA';

const HEADER_VALUE = 'Bearer T'; // must NEVER appear in the page DOM

async function setTier(tier: 'free' | 'pro'): Promise<void> {
  // resolveCurrentTier reads integrations_config.sellf_license (row id=1) before
  // the env fallback. null → free; business license → business (Pro+).
  const { error } = await supabaseAdmin
    .from('integrations_config')
    .update({ sellf_license: tier === 'pro' ? BUSINESS_LICENSE : null })
    .eq('id', 1);
  if (error) throw error;
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

async function expandCustomization(page: Page): Promise<void> {
  await page.locator('#webhook-form button', { hasText: 'Custom integration (Pro)' }).click();
}

/** The payload-field checkbox whose mono label is exactly `key` (avoids matching customFields). */
function fieldCheckbox(page: Page, key: string) {
  return page
    .locator('#webhook-form label')
    .filter({ has: page.locator('span.font-mono', { hasText: new RegExp(`^${key}$`) }) })
    .locator('input[type="checkbox"]');
}

async function fetchEndpoint(url: string) {
  const { data, error } = await supabaseAdmin
    .from('webhook_endpoints')
    .select('id, payload_field_selection, custom_payload_fields, custom_headers_encrypted')
    .eq('url', url)
    .single();
  if (error) throw error;
  return data as {
    id: string;
    payload_field_selection: string[] | null;
    custom_payload_fields: Record<string, unknown> | null;
    custom_headers_encrypted: string | null;
  };
}

test.describe('Webhook payload customization form', () => {
  test.describe.configure({ mode: 'serial' });

  let admin: { email: string; password: string; cleanup: () => Promise<void> };

  test.beforeAll(async () => {
    admin = await createTestAdmin('wh-cust-admin');
  });

  test.afterAll(async () => {
    await supabaseAdmin.from('webhook_endpoints').delete().like('url', `${URL_PREFIX}%`);
    await setTier('free'); // restore DB to its default (null license)
    await admin.cleanup();
  });

  test('free tier: expanding the block shows the upsell and renders no field/header inputs', async ({ page }) => {
    await setTier('free');
    await gotoWebhooks(page, admin.email, admin.password);
    await openAddEndpoint(page);

    await expandCustomization(page);

    // Upsell copy is visible…
    await expect(page.getByText('Custom integration is a Pro feature')).toBeVisible();

    // …and NONE of the Pro controls render.
    await expect(page.getByText('Payload fields to send')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ Add field' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ Add header' })).toHaveCount(0);
    await expect(fieldCheckbox(page, 'customer')).toHaveCount(0);
  });

  test('pro tier: deselect a field, add an extra field + a header, and persist them', async ({ page }) => {
    await setTier('pro');
    await gotoWebhooks(page, admin.email, admin.password);
    await openAddEndpoint(page);

    const url = `${URL_PREFIX}create-${Date.now()}`;
    await fillUrlAndEvent(page, url);
    await expandCustomization(page);

    // Pro controls render now.
    await expect(page.getByText('Payload fields to send')).toBeVisible();

    // Uncheck the `customer` section (starts all-checked).
    const customerCb = fieldCheckbox(page, 'customer');
    await expect(customerCb).toBeChecked();
    await customerCb.uncheck();

    // Add an extra field brand=tsa.
    await page.getByRole('button', { name: '+ Add field' }).click();
    const extraRow = page.locator('#webhook-form input[placeholder="field name"]').last().locator('xpath=ancestor::div[1]');
    await extraRow.locator('input[placeholder="field name"]').fill('brand');
    await extraRow.locator('input[placeholder="value or a placeholder token"]').fill('tsa');

    // Add a custom header Authorization=Bearer T (value is a write-only password input).
    await page.getByRole('button', { name: '+ Add header' }).click();
    const headerRow = page.locator('#webhook-form input[placeholder="Header name"]').last().locator('xpath=ancestor::div[1]');
    await headerRow.locator('input[placeholder="Header name"]').fill('Authorization');
    await headerRow.locator('input[placeholder="Header value (write-only)"]').fill(HEADER_VALUE);

    await page.getByRole('button', { name: 'Create' }).click();

    // Row appears → submission succeeded.
    await expect(page.locator('tr', { hasText: url })).toBeVisible({ timeout: 10000 });

    // Persisted shape: selection excludes `customer`, extra field present, headers stored.
    const ep = await fetchEndpoint(url);
    expect(ep.payload_field_selection).not.toBeNull();
    expect(ep.payload_field_selection).not.toContain('customer');
    expect(ep.payload_field_selection).toContain('order');
    expect(ep.custom_payload_fields).toMatchObject({ brand: 'tsa' });
    expect(ep.custom_headers_encrypted).not.toBeNull(); // has_custom_headers === true
    // The plaintext header value must never have leaked into storage.
    expect(ep.custom_headers_encrypted).not.toContain(HEADER_VALUE);
  });

  test('edit (pro): headers show as configured (no value in DOM), and Delete clears them', async ({ page }) => {
    await setTier('pro');

    // Seed an endpoint that already has encrypted headers (has_custom_headers=true).
    const url = `${URL_PREFIX}edit-${Date.now()}`;
    const createRes = await createEndpointWithHeaders(page, admin.email, admin.password, url);
    expect(createRes.ok).toBeTruthy();
    const before = await fetchEndpoint(url);
    expect(before.custom_headers_encrypted).not.toBeNull();

    await gotoWebhooks(page, admin.email, admin.password);

    const row = page.locator('tr', { hasText: url });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#webhook-form')).toBeVisible();

    await expandCustomization(page);

    // The headers area advertises that headers exist, with a Delete affordance
    // (scoped to the modal — row action menus also expose their own "Delete").
    await expect(page.getByText('Custom headers configured')).toBeVisible();
    const deleteHeaders = page.locator('#webhook-form').getByRole('button', { name: 'Delete' });
    await expect(deleteHeaders).toBeVisible();

    // …but the secret value is NEVER present in the page DOM.
    expect(await page.content()).not.toContain(HEADER_VALUE);

    // Delete + save → headers cleared.
    await deleteHeaders.click();
    await page.getByRole('button', { name: 'Update' }).click();

    // has_custom_headers is now false.
    await expect.poll(async () => (await fetchEndpoint(url)).custom_headers_encrypted, { timeout: 10000 }).toBeNull();
  });
});

/**
 * Create a webhook WITH custom headers through the real v1 API using the admin's
 * session cookie — the same authenticated path the form's create hook uses — so
 * the edit test starts from a has_custom_headers=true endpoint.
 */
async function createEndpointWithHeaders(
  page: Page,
  email: string,
  password: string,
  url: string,
): Promise<{ ok: boolean }> {
  // Sign in via the page context cookies so the v1 route authorizes the write.
  await acceptAllCookies(page);
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await setAuthSession(page, email, password);

  const res = await page.request.post('/api/v1/webhooks', {
    data: {
      url,
      events: ['purchase.completed'],
      custom_headers: { Authorization: HEADER_VALUE },
    },
  });
  return { ok: res.ok() };
}
