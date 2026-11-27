/**
 * Product and webhook editors speak the panel language and keep keyboard focus:
 * a record that cannot be loaded, an editor opened from a link (`?open=<id>`), an archived
 * bundle (contents locked) and a refused save of an archived product.
 *
 * @see src/components/ProductsPageContent.tsx
 * @see src/components/ProductFormModal/sections/BundleItemsSection.tsx
 * @see src/components/ProductFormModal/wizard/WizardFooter.tsx
 * @see src/components/webhooks/WebhookListTable.tsx
 */
import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { tutorialAdmin } from './helpers/tutorials';
import { supabaseAdmin as db } from './helpers/admin-auth';
import { openFormSection } from './helpers/product-form';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SUPABASE_URL ?? '')) throw new Error('Requires a disposable local database');
test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

const productIds: string[] = [];
const webhookIds: string[] = [];
async function product(fields: Record<string, unknown>): Promise<string> {
  const name = `Feedback ${randomUUID()}`;
  const { data, error } = await db.from('products').insert({ name, slug: name.toLowerCase().replaceAll(' ', '-'), price: 49, currency: 'PLN', vat_rate: 23, ...fields }).select('id').single();
  if (error || !data) throw error ?? new Error('Missing product');
  productIds.unshift(data.id);
  return data.id;
}
const focused = (page: Page) => page.evaluate(() => {
  const element = document.activeElement;
  return { body: element === document.body, id: element?.id ?? '', tag: element?.tagName ?? '', inDialog: !!element?.closest('[role="dialog"]') };
});

test.afterAll(async () => {
  for (const id of webhookIds) await db.from('webhook_endpoints').delete().eq('id', id);
  await db.from('bundle_items').delete().in('bundle_product_id', productIds);
  for (const id of productIds) await db.from('products').delete().eq('id', id);
});

for (const locale of ['pl', 'en'] as const) {
  const messages = locale === 'pl' ? pl : en;
  const p = messages.admin.products;

  test(`${locale}: a product link that cannot be loaded is reported in words and leaves the URL`, async ({ page }) => {
    const missing: string[] = [];
    page.on('console', message => { if (message.text().includes('MISSING_MESSAGE')) missing.push(message.text()); });
    await tutorialAdmin(page, 'editor-feedback', false);
    await page.goto(`/${locale}/dashboard/products?open=00000000-0000-4000-8000-000000000000`);
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: p.loadError })).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]open=/);
    expect(missing).toEqual([]);
  });

  test(`${locale}: closing an editor opened from a link clears ?open= and keeps focus on the page`, async ({ page }) => {
    const id = await product({ is_active: true });
    await tutorialAdmin(page, 'editor-feedback', false);
    await page.goto(`/${locale}/dashboard/products?open=${id}`);
    await expect(page.getByRole('button', { name: p.form.updateProduct, exact: true })).toBeEnabled();
    const historyLength = await page.evaluate(() => history.length);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]open=/);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    // Its row when the product is on the first page, otherwise the page heading.
    await expect.poll(async () => { const f = await focused(page); return f.id === `product-edit-${id}` || f.tag === 'H1'; }).toBe(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test(`${locale}: an archived bundle opens as archived with its contents locked`, async ({ page }) => {
    const componentName = `Component ${randomUUID()}`;
    const component = await product({ name: componentName, slug: componentName.toLowerCase().replaceAll(' ', '-'), is_active: true });
    const bundle = await product({ is_bundle: true, is_active: false });
    expect((await db.from('bundle_items').insert({ bundle_product_id: bundle, component_product_id: component, display_order: 0 })).error).toBeNull();
    expect((await db.from('products').update({ archived_at: new Date().toISOString() }).eq('id', bundle)).error).toBeNull();
    await tutorialAdmin(page, 'editor-feedback', false);
    await page.goto(`/${locale}/dashboard/products?open=${bundle}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(p.form.archived, { exact: true })).toBeVisible();
    await expect(dialog.getByText(p.form.inactive, { exact: true })).toHaveCount(0);
    await openFormSection(page, p.form.sections.delivery.title);
    await expect(dialog.getByText(p.form.bundle.lockedArchived)).toBeVisible();
    await expect(dialog.getByText(componentName)).toBeVisible();
    await expect(dialog.getByRole('button', { name: messages.orderedPicker.remove.replace('{name}', componentName) })).toHaveCount(0);
    await expect(dialog.getByPlaceholder(messages.orderedPicker.search)).toHaveCount(0);
  });

  test(`${locale}: activating an archived product is refused in the panel language and focus stays in the form`, async ({ page }) => {
    const id = await product({ is_active: false });
    expect((await db.from('products').update({ archived_at: new Date().toISOString() }).eq('id', id)).error).toBeNull();
    await tutorialAdmin(page, 'editor-feedback', false);
    await page.goto(`/${locale}/dashboard/products?open=${id}&section=sales`);
    const save = page.getByRole('button', { name: p.form.updateProduct, exact: true });
    await expect(save).toBeEnabled();
    await page.locator('#is_active').check();
    const refused = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes(`/api/v1/products/${id}`));
    await save.click();
    expect((await refused).status()).toBe(409);
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: p.productArchivedError })).toBeVisible();
    await expect(save).toBeFocused();
    expect((await db.from('products').select('is_active').eq('id', id).single()).data?.is_active).toBe(false);
  });

  test(`${locale}: webhook row actions name their webhook`, async ({ page }) => {
    const description = `Feedback hook ${randomUUID()}`;
    const { data, error } = await db.from('webhook_endpoints').insert({ url: 'https://example.com/editor-feedback', description, events: ['purchase.completed'], secret: randomUUID(), is_active: false }).select('id').single();
    if (error || !data) throw error ?? new Error('Missing webhook');
    webhookIds.push(data.id);
    await tutorialAdmin(page, 'editor-feedback', false);
    await page.goto(`/${locale}/dashboard/webhooks`);
    const row = page.getByRole('row').filter({ hasText: description });
    const w = messages.admin.webhooks;
    for (const key of ['editLabel', 'deleteLabel', 'testLabel', 'logsLabel'] as const) {
      await expect(row.getByRole('button', { name: w[key].replace('{name}', description), exact: true })).toBeVisible();
    }
  });
}
