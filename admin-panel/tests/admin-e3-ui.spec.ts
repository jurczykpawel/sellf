import { test, expect } from '@playwright/test';
import { loginAsAdmin, supabaseAdmin as db } from './helpers/admin-auth';
import en from '../src/messages/en.json';
import pl from '../src/messages/pl.json';

test.setTimeout(120000);
const keyNames: string[] = [];
test.afterEach(async () => {
  if (keyNames.length) expect((await db.from('api_keys').delete().in('name', keyNames.splice(0))).error).toBeNull();
});

test('key name labels and inline limits work in create and edit @J66', async ({ page }, info) => {
  await loginAsAdmin(page, 'demo@sellf.app', 'demo123');
  for (const locale of ['pl', 'en'] as const) {
    const t = (locale === 'pl' ? pl : en).admin.apiKeys;
    const keyName = `${crypto.randomUUID()}${'X'.repeat(62)}${locale}`;
    keyNames.push(keyName);
    await page.goto(`/${locale}/dashboard/api-keys`);
    const opener = page.getByRole('button', { name: t.createKey, exact: true });
    await opener.click();
    const name = page.getByRole('textbox', { name: t.keyName });
    await page.getByText(t.keyName, { exact: false }).filter({ has: page.locator('span') }).click();
    await expect(name).toBeFocused();
    await name.fill('');
    await page.locator('button[form="api-key-form"]').click();
    await expect(page.getByText(t.nameRequired)).toBeVisible();
    await name.fill('X'.repeat(101));
    await page.locator('button[form="api-key-form"]').click();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(t.nameTooLong)).toBeVisible();
    await name.fill(keyName);
    await page.locator('button[form="api-key-form"]').click();
    await expect(page.locator('#api-key-form')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.reload();
    const row = page.getByRole('row').filter({ hasText: keyName });
    const edit = row.getByRole('button', { name: /edit|edytuj/i });
    await edit.click();
    await page.screenshot({ path: info.outputPath(`${locale}-key-edit.png`), animations: 'disabled' });
    await expect(name).toHaveValue(keyName);
    await name.fill('X'.repeat(101));
    await page.locator('button[form="api-key-form"]').click();
    await expect(page.getByText(t.nameTooLong)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#api-key-form')).toHaveCount(0);
    await edit.click(); await expect(name).toHaveAttribute('aria-invalid', 'false');
    await page.keyboard.press('Escape');
  }
});

test('delivery details open and close using Enter and Space in the drawer and list @J68', async ({ page }) => {
  const { data: endpoint, error } = await db.from('webhook_endpoints').insert({ url: 'https://example.com/e3-fixture', description: 'E3 keyboard', events: ['test.event'], secret: 'local-fixture', is_active: false }).select('id').single();
  expect(error).toBeNull();
  try {
    expect((await db.from('webhook_logs').insert({ endpoint_id: endpoint!.id, event_type: 'test.event', payload: { value: 'Keyboard payload' }, status: 'success', http_status: 200, response_body: 'OK', duration_ms: 1 })).error).toBeNull();
    await loginAsAdmin(page, 'demo@sellf.app', 'demo123');
    for (const locale of ['pl', 'en']) {
      await page.goto(`/${locale}/dashboard/webhooks`);
      const opener = page.getByRole('row').filter({ hasText: 'E3 keyboard' }).getByRole('button', { name: /logs|logi/i });
      const loaded = page.waitForResponse(r => r.request().method() === 'GET' && r.url().includes('/api/v1/webhooks/logs') && new URL(r.url()).searchParams.get('endpoint_id') === endpoint!.id);
      await opener.click(); expect((await loaded).status()).toBe(200);
      const button = page.getByRole('button', { name: 'test.event', exact: true });
      await expect(button).toBeVisible();
      await page.getByRole('dialog').getByRole('combobox').focus();
      await page.keyboard.press('Tab'); await expect(button).toBeFocused(); await page.keyboard.press('Enter'); await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByText('Keyboard payload', { exact: false })).toBeVisible();
      await page.keyboard.press('Space'); await expect(button).toHaveAttribute('aria-expanded', 'false'); await expect(button).toBeFocused();
      await page.keyboard.press('Escape'); await expect(opener).toBeFocused();
      await page.goto(`/${locale}/dashboard/webhooks/deliveries`);
      const filtered = page.waitForResponse(r => r.request().method() === 'GET' && r.url().includes('/api/v1/webhooks/logs') && new URL(r.url()).searchParams.get('status') === 'success');
      await page.getByRole('button', { name: (locale === 'pl' ? pl : en).admin.webhooks.logs.filterSuccess, exact: true }).click();
      expect((await filtered).status()).toBe(200);
      const delivery = page.getByRole('row').filter({ hasText: 'E3 keyboard' }).getByRole('button', { name: 'test.event', exact: true });
      await expect(delivery).toBeVisible();
      await delivery.focus(); await page.keyboard.press('Enter'); await expect(delivery).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Space'); await expect(delivery).toHaveAttribute('aria-expanded', 'false'); await expect(delivery).toBeFocused();
    }
  } finally { await db.from('webhook_logs').delete().eq('endpoint_id', endpoint!.id); await db.from('webhook_endpoints').delete().eq('id', endpoint!.id); }
});

test('license policy shows localized day units and unlimited validity @J20', async ({ page }) => {
  const ids: string[] = [];
  try {
    for (const days of [1, 2, 5, null]) {
      const { data, error } = await db.from('products').insert({ name: `Validity ${days}`, slug: `validity-${days}-${Date.now()}`, price: 10, currency: 'PLN', is_active: true, issue_license_on_purchase: true, license_tier: 'pro', license_duration_days: days }).select('id').single();
      expect(error).toBeNull(); ids.push(data!.id);
    }
    await loginAsAdmin(page, 'demo@sellf.app', 'demo123');
    for (const locale of ['pl', 'en']) {
      for (const [i, value] of [1, 2, 5, null].entries()) {
        await page.goto(`/${locale}/dashboard/licenses?product=${ids[i]}`);
        const expected = value === null ? (locale === 'pl' ? pl : en).settings.issuedLicenses.unlimited : `${value} ${locale === 'pl' ? (value === 1 ? 'dzień' : 'dni') : (value === 1 ? 'day' : 'days')}`;
        await expect(page.getByText(new RegExp(`${locale === 'pl' ? 'ważność' : 'validity'}: ${expected}`))).toBeVisible();
      }
    }
  } finally { await db.from('products').delete().in('id', ids); }
});
