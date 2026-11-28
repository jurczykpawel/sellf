import { readFileSync } from 'node:fs';
import fixtures from './fixtures/stripe/buyer-delivery-logs.json';
import { storeBuyerPayload } from '@/lib/webhooks/buyer-payload-storage';
import { test, expect, Page } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { setAuthSession, createTestAdmin, createTestUser, supabaseAdmin } from './helpers/admin-auth';
import { PAYLOAD_TOP_LEVEL_KEYS } from '@/lib/webhooks/customization-form';

// Playwright's web server always runs with E2E_MODE=true, which intentionally
// resolves a business tier. These tests therefore exercise the unlocked form and
// its real API persistence path; free-tier resolution is covered by unit tests.
//
// SECURITY: header *values* are write-only and stored encrypted. These tests
// assert the boolean `has_custom_headers` (via DB) and the "configured" affordance
// only — never any plaintext/encrypted header value.

// Host must resolve in DNS — the webhook URL validator rejects non-resolving
// hostnames (SSRF guard). example.com resolves; uniqueness lives in the path.
const URL_PREFIX = 'https://example.com/wh-cust-e2e/';

const HEADER_VALUE = 'Bearer T'; // must NEVER appear in the page DOM

async function setTier(tier: 'free' | 'pro'): Promise<void> {
  if (tier === 'pro') return;
  const { error } = await supabaseAdmin
    .from('integrations_config')
    .update({ sellf_license: null })
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

  test('E2E business tier: expanding the block renders customization controls', async ({ page }) => {
    await gotoWebhooks(page, admin.email, admin.password);
    await openAddEndpoint(page);

    await expandCustomization(page);

    await expect(page.getByText('Custom integration is a Pro feature')).toHaveCount(0);
    await expect(page.getByText('Payload fields to send')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add field' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add header' })).toBeVisible();
    await expect(fieldCheckbox(page, 'customer')).toBeChecked();
  });

  test('pro tier: deselect a field, add an extra field + a header, and persist them @J68', async ({ page }) => {
    await gotoWebhooks(page, admin.email, admin.password);
    await openAddEndpoint(page);

    const url = `${URL_PREFIX}create-${Date.now()}`;
    await fillUrlAndEvent(page, url);
    await expandCustomization(page);

    // Pro controls render now.
    await expect(page.getByText('Payload fields to send')).toBeVisible();

    // The Select all / Deselect all toggle drives every payload-field checkbox at once.
    // Scope the toggle button to the modal so it never collides with the product-scope
    // toggle (strict mode); assert each PAYLOAD_TOP_LEVEL_KEYS checkbox by its exact
    // mono label (fieldCheckbox) so event-type checkboxes are never matched.
    const form = page.locator('#webhook-form');

    await form.getByRole('button', { name: 'Deselect all' }).click();
    for (const key of PAYLOAD_TOP_LEVEL_KEYS) {
      await expect(fieldCheckbox(page, key)).not.toBeChecked();
    }

    await form.getByRole('button', { name: 'Select all' }).click();
    for (const key of PAYLOAD_TOP_LEVEL_KEYS) {
      await expect(fieldCheckbox(page, key)).toBeChecked();
    }

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
    // Seed an endpoint that already has encrypted headers (has_custom_headers=true).
    const url = `${URL_PREFIX}edit-${Date.now()}`;
    const createRes = await createEndpointWithHeaders(page, admin.email, admin.password, url);
    expect(createRes.ok).toBeTruthy();
    const before = await fetchEndpoint(url);
    expect(before.custom_headers_encrypted).not.toBeNull();

    await gotoWebhooks(page, admin.email, admin.password);

    const row = page.locator('tr', { hasText: url });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByRole('button', { name: `Edit ${url}`, exact: true }).click();
    await expect(page.locator('#webhook-form')).toBeVisible();

    await expandCustomization(page);

    // The headers area advertises that headers exist, with a Delete affordance
    // (scoped to the modal — row action menus also expose their own "Delete").
    await expect(page.getByText('Custom headers configured')).toBeVisible();
    const deleteHeaders = page.locator('#webhook-form').getByRole('button', { name: 'Delete' });
    await expect(deleteHeaders).toBeVisible();

    // The configured-headers block lists the header NAME (so the user sees what
    // exists before deleting) — names are not secret.
    await expect(page.locator('#webhook-form li', { hasText: 'Authorization' })).toBeVisible();

    // …but the secret value is NEVER present in the page DOM.
    expect(await page.content()).not.toContain(HEADER_VALUE);

    // Delete + save → headers cleared.
    await deleteHeaders.click();
    await page.getByRole('button', { name: 'Update' }).click();

    // has_custom_headers is now false.
    await expect.poll(async () => (await fetchEndpoint(url)).custom_headers_encrypted, { timeout: 10000 }).toBeNull();
  });
  test('validates custom header names beside the field before saving @J68', async ({page}) => {
    await gotoWebhooks(page,admin.email,admin.password); await openAddEndpoint(page);
    const url=`${URL_PREFIX}validation-${Date.now()}`;
    await fillUrlAndEvent(page,url); await expandCustomization(page);
    await page.getByRole('button',{name:'+ Add header'}).click();
    await page.getByPlaceholder('Header name', {exact:true}).fill('Bad Header');
    await page.locator('#webhook-form input[type=password]').fill('fixture-value');
    await page.getByRole('button',{name:'Create',exact:true}).click();
    await expect(page.getByPlaceholder('Header name', {exact:true})).toHaveAttribute('aria-invalid','true');
    await expect(page.locator('#webhook-header-error-0')).toContainText('valid HTTP header');
    expect((await supabaseAdmin.from('webhook_endpoints').select('id').eq('url',url)).data).toEqual([]);
    await page.getByPlaceholder('Header name', {exact:true}).fill('X-Tenant');
    await page.getByRole('button',{name:'Create',exact:true}).click();
    await expect(page.locator('tr',{hasText:url})).toBeVisible();
    const endpoint=await fetchEndpoint(url);
    for (const method of ['post','patch'] as const) {
      const response=await page.request[method](`/api/v1/webhooks${method==='patch'?`/${endpoint.id}`:''}`,{data:{url,events:['purchase.completed'],custom_headers:{'Bad Header':'fixture-value'}}});
      expect(response.status()).toBe(400);
      expect((await response.json()).error.details.custom_headers).toEqual(['invalid']);
    }
    expect((await fetchEndpoint(url)).custom_headers_encrypted).toBe(endpoint.custom_headers_encrypted);
    if (process.env.STRIPE_LIVE_RECEIVER_URL) {
      const path=`/headers-${endpoint.id}`;
      try {
        expect((await page.request.patch(`/api/v1/webhooks/${endpoint.id}`,{data:{url:process.env.STRIPE_LIVE_RECEIVER_URL+path}})).status()).toBe(200);
        const probe=await page.request.post(`/api/v1/webhooks/${endpoint.id}/test`,{data:{event_type:'purchase.completed'}});
        expect(probe.status()).toBe(200);expect((await probe.json()).data).toMatchObject({success:true,http_status:200});
        const received=readFileSync(`${process.env.STRIPE_LIVE_ARTIFACTS}/deliveries.jsonl`,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)).find(row=>row.path===path);
        expect(received?.headers['x-tenant']).toBe('fixture-value');
      } finally {
        expect((await page.request.patch(`/api/v1/webhooks/${endpoint.id}`,{data:{url}})).status()).toBe(200);
      }
    }

  });

  test('shows readable delivery logs in both admin views and refuses buyer sessions @J68',async({page,request})=>{
    await gotoWebhooks(page,admin.email,admin.password);
    const url=`${URL_PREFIX}readable-${Date.now()}`;
    expect((await page.request.post('/api/v1/webhooks',{data:{url,events:['purchase.completed']}})).status()).toBe(201);
    const endpoint=await fetchEndpoint(url);
    for (const fixture of fixtures) {
      expect((await supabaseAdmin.from('webhook_logs').insert({endpoint_id:endpoint.id,event_type:fixture.event,payload:await storeBuyerPayload(fixture.event,fixture),status:'permanently_failed',duration_ms:0})).error).toBeNull();
    }
    expect((await request.get('/api/v1/webhooks/logs')).status()).toBe(401);
    const buyer=await createTestUser('log-reader');
    try {
      await setAuthSession(page,buyer.email,buyer.password);
      expect((await page.request.get('/api/v1/webhooks/logs')).status()).toBe(401);
      await setAuthSession(page,admin.email,admin.password);
      const response=await page.request.get(`/api/v1/webhooks/logs?endpoint_id=${endpoint.id}`);
      expect(response.status()).toBe(200);
      const logs=(await response.json()).data;
      expect(logs).toHaveLength(3);
      expect(logs.every((log:{payload:unknown})=>!Array.isArray(log.payload))).toBe(true);
      expect(JSON.stringify(logs)).not.toMatch(/fixture-credential|encrypted_key|encryption_iv|encryption_tag/);
      await page.reload();
      await page.locator('tr',{hasText:url}).getByRole('button',{name:`Logs ${url}`,exact:true}).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      for (const fixture of fixtures) {
        await dialog.locator('tr',{hasText:fixture.event}).click();
        await expect(dialog.locator('pre').first()).toContainText(fixture.id);
      }
      await page.goto('/en/dashboard/webhooks/deliveries');
      await page.locator('tr',{hasText:'order.participants_needed'}).first().click();
      await expect(page.locator('pre').first()).toContainText('order.participants_needed');
      await expect(page.locator('pre').first()).not.toContainText('encrypted_key');
    } finally {await buyer.cleanup();}
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
