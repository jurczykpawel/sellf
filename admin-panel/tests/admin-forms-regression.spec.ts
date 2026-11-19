import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { tutorialAdmin } from './helpers/tutorials';
import { supabaseAdmin as db } from './helpers/admin-auth';
import { openFormSection } from './helpers/product-form';
import { DEFAULT_CONFIG } from '@/lib/storefront-templates/fixtures';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SUPABASE_URL ?? '')) throw new Error('Requires a disposable local database');
test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

for (const locale of ['pl', 'en'] as const) {
  const messages = locale === 'pl' ? pl : en;
  test(`${locale}: product price, unchanged edits, co-creator errors and row-menu focus @J212 @J640`, async ({ page }) => {
    const admin = await tutorialAdmin(page, 'form-regression', false);
    const name = `Form ${randomUUID()}`;
    const { data: product, error } = await db.from('products').insert({ name, slug: name.toLowerCase().replaceAll(' ', '-'), price: 1000, currency: 'JPY', vat_rate: 23, is_active: true }).select('id').single();
    if (error || !product) throw error ?? new Error('Missing product');
    try {
      await page.goto(`/${locale}/dashboard/products`);
      await page.getByPlaceholder(messages.admin.products.searchPlaceholder).fill(name);
      const row = page.locator('tbody tr').filter({ hasText: name });
      const edit = row.locator(`button[title="${messages.admin.products.edit}"]`);
      await edit.click();
      await expect(page.getByRole('button', { name: messages.admin.products.form.updateProduct, exact: true })).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(edit).toBeFocused();
      await edit.click();
      await page.locator('#price').fill('1000.5');
      await expect(page.locator('[data-buyer-summary]')).toContainText(messages.admin.products.form.summary.payment.invalid);
      await expect(page.getByRole('dialog').getByText(messages.admin.products.form.free, { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: messages.admin.products.form.updateProduct, exact: true }).click();
      await expect(page.locator('#price')).toBeFocused();
      expect((await db.from('products').select('price').eq('id', product.id).single()).data?.price).toBe(1000);
      await page.locator('#price').fill('1000');
      await openFormSection(page, messages.admin.products.form.sections.sales.title);
      const creator = page.getByTestId('cocreator-settings'), c = messages.affiliateCocreator;
      await expect(creator.getByLabel(c.email)).toBeEnabled();
      await creator.getByLabel(c.email).fill(admin.email);
      await creator.getByLabel(c.bps).fill('100.01');
      await creator.getByRole('button', { name: c.save, exact: true }).click();
      await expect(creator.getByLabel(c.bps)).toHaveAttribute('aria-invalid', 'true');
      await expect(creator.getByRole('alert')).toContainText(c.percentageInvalid);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const more = row.getByRole('button', { name: messages.admin.products.moreActions });
      await more.click();
      await page.getByRole('button', { name: messages.admin.products.duplicate, exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByText(messages.admin.products.form.wizard.exitMessage)).toBeVisible();
      await page.getByRole('button', { name: messages.admin.products.form.wizard.exitDiscard, exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(more).toBeFocused();
      await edit.click();
      await page.locator('#name').fill(`${name} changed`);
      await page.keyboard.press('Escape');
      await expect(page.getByText(messages.admin.products.form.wizard.exitMessage)).toBeVisible();
    } finally { await db.from('products').delete().eq('id', product.id); await admin.cleanup(); }
  });

  test(`${locale}: help-launched product form restores focus after both Escape presses @J303`, async ({ page }) => {
    const admin = await tutorialAdmin(page, 'help-form', false);
    try {
      await page.goto(`/${locale}/dashboard/templates`);
      await page.getByTestId('tutorial-menu-button').click();
      await page.getByTestId('tutorial-link-product-form').click();
      await expect(page.locator('.driver-popover.sellf-tour')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.driver-popover.sellf-tour')).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByTestId('tutorial-menu-button')).toBeFocused();
    } finally { await admin.cleanup(); }
  });

  test(`${locale}: coupon errors are reachable and long names retain visible actions`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const admin = await tutorialAdmin(page, 'coupon-form', false);
    const code = `FORM_${randomUUID().slice(0, 8)}`, t = messages.admin.coupons;
    try {
      await page.goto(`/${locale}/dashboard/coupons`);
      await page.getByRole('button', { name: t.create, exact: true }).click();
      const form = page.locator('form').filter({ has: page.getByPlaceholder(t.form.codePlaceholder) });
      const save = form.getByRole('button', { name: t.form.save, exact: true });
      await save.click();
      const codeField = form.getByPlaceholder(t.form.codePlaceholder);
      await expect(codeField).toBeFocused();
      await expect(codeField).toBeInViewport();
      await codeField.fill(code);
      await form.locator('[name=discount_value]').fill('10');
      const globalLimit = form.locator('input[type=number]').nth(1);
      await globalLimit.fill('0');
      await expect(globalLimit).toHaveValue('0');
      await save.click();
      await expect(globalLimit).toBeFocused();
      await expect(globalLimit).toHaveAttribute('aria-invalid', 'true');
      await globalLimit.fill('');
      const email = form.getByLabel(t.form.emailRestriction);
      await email.fill('bademail');
      await form.getByRole('button', { name: t.form.add, exact: true }).click();
      await expect(email).toHaveAttribute('aria-invalid', 'true');
      await expect(form.getByText(t.form.emailInvalid)).toBeVisible();
      await email.fill('buyer@example.test');
      await form.getByRole('button', { name: t.form.add, exact: true }).click();
      await form.getByLabel(t.form.nameLabel).fill('R'.repeat(200));
      const response = page.waitForResponse(r => r.url().includes('/api/v1/coupons') && r.request().method() === 'POST');
      await save.click();
      expect((await response).status()).toBe(201);
      await page.getByPlaceholder(t.searchPlaceholder).fill(code);
      const row = page.locator('tbody tr').filter({ hasText: code });
      await expect(row).toBeVisible();
      const label = row.getByText('R'.repeat(200), { exact: true });
      await expect(label).toBeVisible();
      expect(await label.evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(200);
      await expect(label).toHaveAttribute('title', 'R'.repeat(200));
      const bounds = await row.evaluate(el => el.getBoundingClientRect().right);
      expect(bounds).toBeLessThanOrEqual(page.viewportSize()!.width);
    } finally { await db.from('coupons').delete().eq('code', code); await admin.cleanup(); }
  });

  test(`${locale}: Escape from async history confirmation returns to the chosen revision`, async ({ page }) => {
    const admin = await tutorialAdmin(page, 'history-focus', false);
    const current = await db.from('storefront_config').select('revision').single();
    if (current.error) throw current.error;
    const revision = current.data.revision;
    try {
      const history = await db.from('storefront_config_history').insert([1, 2].map(offset => ({ revision: revision + offset, operation: 'publish', draft: null, published: DEFAULT_CONFIG })));
      if (history.error) throw history.error;
      const update = await db.from('storefront_config').update({ revision: revision + 2, draft: null, published: DEFAULT_CONFIG }).eq('id', true);
      if (update.error) throw update.error;
      await page.goto(`/${locale}/admin/templates/history`);
      const button = page.getByRole('button', { name: messages.templatePreview.rollback, exact: true }).first();
      await button.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(button).toBeFocused();
    } finally { await admin.cleanup(); }
  });
}
