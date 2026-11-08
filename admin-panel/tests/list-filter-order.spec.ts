import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { acceptAllCookies } from './helpers/consent';
import { createTestAdmin, createTestUser, setAuthSession, supabaseAdmin as db } from './helpers/admin-auth';
function signal() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
async function reverseResponses(page: Page, path: string, old: string, next: string, fill: (value: string) => Promise<void>, check: () => Promise<void>) {
  const held = signal(), release = signal(), finished = signal();
  await page.route(`**${path}?**`, async route => {
    if (new URL(route.request().url()).searchParams.get('search') !== old) return route.continue();
    const response = await route.fetch(); expect(response.status()).toBe(200); held.resolve();
    await release.promise; await route.fulfill({ response }); finished.resolve();
  });
  await fill(old); await held.promise;
  const latest = page.waitForResponse(r => r.url().includes(path) && new URL(r.url()).searchParams.get('search') === next && r.status() === 200);
  await fill(next); await latest; await check();
  const earlier = page.waitForResponse(r => r.url().includes(path) && new URL(r.url()).searchParams.get('search') === old);
  release.resolve(); await finished.promise; await (await earlier).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await check();
}
test('product and user searches keep selected query after delayed responses @J47 @J118', async ({ page }) => {
  const admin = await createTestAdmin('list-admin');
  const first = await createTestUser('list-first'), second = await createTestUser('list-second');
  const suffix = randomUUID().slice(0, 8);
  const products = ['first', 'second'].map(label => ({ id: randomUUID(), name: `List ${label} ${suffix}`, slug: `list-${label}-${suffix}`, price: 10, currency: 'PLN', is_active: true }));
  try {
    expect((await db.from('products').insert(products)).error).toBeNull();
    await setAuthSession(page, admin.email, admin.password);
    await page.goto('/en/dashboard/products');
    const search = page.locator('input[type="text"]').first(); await expect(search).toBeVisible();
    await reverseResponses(page, '/api/v1/products', products[0].name, products[1].name, value => search.fill(value), async () => {
      await expect(page.getByRole('row').filter({ hasText: products[1].name })).toHaveCount(1);
      await expect(page.getByRole('row').filter({ hasText: products[0].name })).toHaveCount(0);
    });
    await page.goto('/en/dashboard/users');
    const users = page.locator('input[type="text"]').first(); await expect(users).toBeVisible();
    await reverseResponses(page, '/api/v1/users', first.email, second.email, value => users.fill(value), async () => {
      await expect(page.getByRole('row').filter({ hasText: second.email })).toHaveCount(1);
      await expect(page.getByRole('row').filter({ hasText: first.email })).toHaveCount(0);
    });
  } finally {
    await db.from('products').delete().in('id', products.map(p => p.id));
    await second.cleanup(); await first.cleanup(); await admin.cleanup();
  }
});
test('license and endpoint log filters retain the latest result @J20 @J71', async ({ page }) => {
  const admin = await createTestAdmin('filter-admin'); const seller = await createTestUser('filter-seller'); const id = randomUUID(), endpoint = randomUUID();
  try {
    expect((await db.from('products').insert({ id, name: `Filter ${id}`, slug: `filter-${id}`, price: 10, issue_license_on_purchase: true })).error).toBeNull();
    expect((await db.from('webhook_endpoints').insert({ id: endpoint, url: `https://example.com/filter-${id}`, events: ['purchase.completed'], secret: 'fixture', is_active: true })).error).toBeNull();
    expect((await db.from('webhook_logs').insert({ endpoint_id: endpoint, event_type: 'purchase.completed', status: 'success', http_status: 200, payload: {} })).error).toBeNull();
    expect((await db.from('issued_licenses').insert(['first@example.com', 'second@example.com'].map(email => ({ seller_id: seller.userId, original_seller_id: seller.userId, product_id: id, email, order_id: email + id, kid: 'fixture', license_key: 'fixture' })))).error).toBeNull();
    await setAuthSession(page, admin.email, admin.password); await page.goto('/en/dashboard/licenses');
    const search = page.locator('[data-tour="licenses-filters"] input'); await expect(search).toBeVisible();
    await reverseResponses(page, '/api/admin/licenses', 'first@example.com', 'second@example.com', value => search.fill(value), async () => {
      await expect(search).toHaveValue('second@example.com');
      await expect(page.getByRole('row').filter({ hasText: 'second@example.com' })).toHaveCount(1);
      await expect(page.getByRole('row').filter({ hasText: 'first@example.com' })).toHaveCount(0);
    });
    await page.goto('/en/dashboard/webhooks');
    await page.getByRole('row').filter({ hasText: `filter-${id}` }).getByRole('button', { name: /logs/i }).click();
    const dialog = page.getByRole('dialog'), filter = dialog.getByRole('combobox');
    await expect(dialog.getByRole('row').filter({ hasText: 'HTTP 200' })).toHaveCount(1);
    const held = signal(), release = signal(), finished = signal();
    await page.route('**/api/v1/webhooks/logs?**', async route => {
      if (new URL(route.request().url()).searchParams.get('status') !== 'success') return route.continue();
      const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response }); finished.resolve();
    });
    await filter.selectOption('success'); await held.promise; await filter.selectOption('failed');
    await expect(dialog.getByRole('row').filter({ hasText: 'HTTP 200' })).toHaveCount(0);
    const earlier = page.waitForResponse(r => r.url().includes('/webhooks/logs?') && new URL(r.url()).searchParams.get('status') === 'success');
    release.resolve(); await finished.promise; await (await earlier).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(filter).toHaveValue('failed'); await expect(dialog.getByRole('row').filter({ hasText: 'HTTP 200' })).toHaveCount(0);
  } finally {
    await db.from('webhook_logs').delete().eq('endpoint_id', endpoint); await db.from('webhook_endpoints').delete().eq('id', endpoint);
    await db.from('issued_licenses').delete().eq('product_id', id); await db.from('products').delete().eq('id', id); await seller.cleanup(); await admin.cleanup();
  }
});

test('duplicating with a double click preserves type and price and identifies invalid fields @J47 @J48', async ({ page }) => {
  const admin = await createTestAdmin('form-admin');
  const id = randomUUID(), slug = `form-${id}`;
  try {
    expect((await db.from('products').insert({ id, name: `Form ${id}`, slug, price: 10, currency: 'PLN', is_active: true, vat_exempt: true })).error).toBeNull();
    await setAuthSession(page, admin.email, admin.password);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/pl/dashboard/products');
    const row = page.getByRole('row').filter({ hasText: `Form ${id}` });
    await row.locator('button[aria-expanded]').click();
    await page.getByRole('button', { name: /^(Duplikuj|Duplicate)$/ }).dblclick();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-product-type="standard"]')).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.locator('#price')).toHaveValue('10');
    await dialog.locator('#name').fill('A'.repeat(201));
    await dialog.getByRole('button', { name: /Publikuj/ }).click();
    await expect(dialog.locator('#name')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.locator('#name-error')).toContainText('200');
    await dialog.locator('#name').fill('Good name ');
    await expect(dialog.locator('#slug')).not.toHaveValue(/-$/);
  } finally { await db.from('products').delete().eq('id', id); await admin.cleanup(); }
});

test('store entry keeps the first campaign through product navigation @J80', async ({ page }) => {
  await acceptAllCookies(page);
  await page.goto('/en/store?utm_source=first&utm_campaign=store&ref=partner');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sf_attr_v1') ?? '{}').first?.source)).toBe('first');
  await page.goto('/en/store?utm_source=second&utm_campaign=next');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sf_attr_v1') ?? '{}').last?.source)).toBe('second');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sf_attr_v1') ?? '{}').first)).toMatchObject({ source: 'first', campaign: 'store', landing_path: '/store' });
});

test('event checkout keeps buyer fields available after an availability error @J51', async ({ page }) => {
  const id = randomUUID(), session = randomUUID(), slug = `event-retry-${id}`;
  try {
    expect((await db.from('products').insert({ id, slug, name: 'Retry event', price: 10, currency: 'PLN', is_active: true, event_mode: true, vat_exempt: true, checkout_profile: { v: 1, modules: [{ id: 'quantity', min: 1, max: 100, mode: 'checkout' }] } })).error).toBeNull();
    expect((await db.from('product_sessions').insert({ id: session, product_id: id, starts_at: '2099-06-01T12:00:00Z', capacity: 3, title: 'Retry session' })).error).toBeNull();
    expect((await db.from('product_price_tiers').insert({ session_id: session, price: 10, sort: 0 })).error).toBeNull();
    let attempts = 0;
    const retried = signal();
    await page.route('**/api/create-payment-intent', async route => {
      if (route.request().postDataJSON()?.expireOnly) return route.continue();
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 409, json: { error: 'sold_out' } });
      expect(route.request().postDataJSON().email).toBe('event-retry@example.com');
      expect(route.request().postDataJSON().sessionId).toBe(session);
      expect(route.request().postDataJSON().quantity).toBe(2);
      retried.resolve();
      return route.fulfill({ status: 429, json: { error: 'event_hold_limit' } });
    });
    await acceptAllCookies(page);
    await page.goto(`/pl/p/${slug}?email=event-retry%40example.com`);
    await expect(page.getByTestId('event-sessions')).toContainText('3');
    const email = page.locator('[id="buyer.email"]');
    if (await email.isVisible()) { await email.fill('event-retry@example.com'); await email.blur(); }
    const start = page.getByRole('button', { name: /^(Continue to payment|Przejdź do płatności)$/ });
    if (await start.isVisible()) await start.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Brak wolnych miejsc' })).toBeVisible();
    await expect(page.locator('#checkoutQuantity')).toBeVisible();
    await page.locator('#checkoutQuantity').fill('2');
    await retried.promise;
    await expect(page.getByRole('alert').filter({ hasText: 'Zbyt wiele rezerwacji' })).toBeVisible();
    await expect(page.locator('#checkoutQuantity')).toHaveValue('2');
    await expect(page.getByRole('heading', { name: 'Błąd płatności' })).toHaveCount(0);
  } finally { await db.from('products').delete().eq('id', id); }
});

test('Polish forms place validation at the license domain and webhook fields @J21 @J116', async ({ page }) => {
  const admin = await createTestAdmin('field-admin'); const id = randomUUID();
  try {
    expect((await db.from('products').insert({ id, name: `Domain ${id}`, slug: `domain-${id}`, price: 0, issue_license_on_purchase: true, custom_checkout_fields: [{ id: '_sellf_license_domain', type: 'domain', label: 'Domena', required: true, max_length: 253 }] })).error).toBeNull();
    await setAuthSession(page, admin.email, admin.password);
    await page.goto('/pl/dashboard/licenses');
    await page.locator('[data-tour="licenses-issue"] select').selectOption(id);
    await page.locator('#license-email').fill('buyer@example.com');
    await page.locator('#license-domain').fill('https://?? bad');
    await page.locator('[data-tour="licenses-issue"] button[type="submit"], [data-tour="licenses-issue"] button:not([type])').last().click();
    await expect(page.locator('#license-domain')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#license-domain-error')).toContainText(/domen/i);
    await page.goto('/pl/dashboard/webhooks');
    await page.getByRole('button', { name: 'Dodaj Endpoint' }).first().click();
    await page.locator('#webhook-form input[type="url"]').fill('https://example.com/hook');
    await page.locator('#webhook-description').fill('a'.repeat(501));
    await page.locator('button[type="submit"][form="webhook-form"]').click();
    await expect(page.locator('#webhook-description')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#webhook-description-error')).toContainText('500');
    await expect(page.locator('#webhook-events-error')).toContainText(/zdarzen/i);
  } finally { await db.from('products').delete().eq('id', id); await admin.cleanup(); }
});
