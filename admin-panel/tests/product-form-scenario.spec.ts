/**
 * "What are you selling?" in the product form: a starting aid that sets existing product fields, shows the difference
 * before a switch, can be skipped, and leaves an opened product exactly as stored when it is saved without changes.
 * @see src/components/ProductFormModal/wizard/ScenarioBar.tsx
 */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestAdmin, loginAsAdmin, supabaseAdmin as db } from './helpers/admin-auth';
import { openFormSection } from './helpers/product-form';
import pl from '../src/messages/pl.json';
import en from '../src/messages/en.json';
import type { Page } from '@playwright/test';

if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SUPABASE_URL ?? '')) throw new Error('Requires a local disposable Supabase stack');
test.describe.configure({ mode: 'serial' });

const S = pl.admin.products.form.scenario;
const cleanups: Array<() => Promise<unknown>> = [];
let admin: Awaited<ReturnType<typeof createTestAdmin>>;
test.beforeAll(async () => { admin = await createTestAdmin('scenario'); });
test.afterAll(async () => { while (cleanups.length) await cleanups.pop()!(); await admin.cleanup(); });

async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<NonNullable<T>> { if (error) throw error; return data!; }
const picker = (page: Page, title = S.title) => page.getByRole('dialog').getByRole('group', { name: title });
const scenarioBar = (page: Page) => page.getByRole('dialog').locator('[data-tour="form-scenario"]');

async function openNewForm(page: Page, locale: 'pl' | 'en' = 'pl', width?: number) {
  await loginAsAdmin(page, admin.email, admin.password);
  // The login helper waits for the desktop navigation, so the phone width is set after signing in.
  if (width) await page.setViewportSize({ width, height: 844 });
  await page.goto(`/${locale}/dashboard/products`);
  await page.locator('button', { hasText: locale === 'pl' ? /Dodaj produkt/i : /Add product/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('creating: a scenario is picked from the keyboard, a switch shows its difference first, and the choice can be skipped', async ({ page }) => {
  await openNewForm(page);
  const group = picker(page);
  await expect(group).toBeInViewport();
  await expect(group.getByRole('button').first()).toBeFocused();
  await expect(group.getByRole('button')).toHaveText([...Object.values(S.options).map(option => `${option.name}${option.tagline}`), S.manual]);

  await group.getByRole('button', { name: new RegExp(`^${S.options.free.name}`) }).focus();
  await page.keyboard.press('Enter');
  await expect(picker(page)).toHaveCount(0);
  await expect(scenarioBar(page)).toContainText(`${S.current} ${S.options.free.name}`);
  const change = scenarioBar(page).getByRole('button', { name: S.changeLabel });
  await expect(change).toBeFocused();
  await expect(page.locator('[data-buyer-summary]')).toContainText('za darmo');

  await page.keyboard.press('Enter');
  await expect(picker(page).getByRole('button').first()).toBeFocused();
  await picker(page).getByRole('button', { name: new RegExp(`^${S.options.event.name}`) }).focus();
  await page.keyboard.press('Space');
  const preview = page.getByRole('region', { name: S.confirm.title.replace('{name}', S.options.event.name) });
  await expect(preview.getByRole('heading')).toBeFocused();
  await expect(preview.getByRole('listitem')).toHaveText([
    `${S.fields.payment}: ${S.values.payment['lead-magnet']} → ${S.values.payment.standard}`,
    `${S.fields.event}: ${S.values.off} → włączone (0 terminów)`,
    `${S.fields.repeat}: ${S.values.no} → ${S.values.yes}`,
  ]);
  await preview.getByRole('button', { name: S.confirm.cancel }).click();
  await expect(scenarioBar(page)).toContainText(S.options.free.name);

  await change.click();
  await picker(page).getByRole('button', { name: new RegExp(`^${S.options.event.name}`) }).click();
  await page.getByRole('button', { name: S.confirm.apply }).click();
  await expect(scenarioBar(page)).toContainText(S.options.event.name);
  await openFormSection(page, pl.admin.products.form.sections.schedule.title);
  await expect(page.getByLabel(pl.events.enabled, { exact: true })).toBeChecked();

  // Skipping leaves the form to be set by hand.
  await page.reload();
  await page.locator('button', { hasText: /Dodaj produkt/i }).click();
  await picker(page).getByRole('button', { name: S.manual }).click();
  await expect(scenarioBar(page)).toContainText(`${S.current} ${S.manualCurrent}`);
  await expect(scenarioBar(page).getByRole('button', { name: S.choose })).toBeVisible();
});

test('creating: the free scenario is saved as ordinary product fields', async ({ page }) => {
  const name = `Scenariusz darmowy ${randomUUID().slice(0, 8)}`;
  await openNewForm(page);
  await picker(page).getByRole('button', { name: new RegExp(`^${S.options.free.name}`) }).click();
  await page.locator('input#name').fill(name);
  // A free material needs the material itself before it can be published.
  await openFormSection(page, pl.admin.products.form.sections.delivery.title);
  await page.getByRole('dialog').getByRole('button', { name: /Dodaj element treści/i }).click();
  await page.locator('input#content_url_0').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await openFormSection(page, pl.admin.products.form.sections.offer.title);
  await page.fill('textarea#description', 'Darmowy poradnik');
  await page.getByRole('button', { name: /Publikuj/i }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  const row = await checked(await db.from('products').select('*').eq('name', name).single());
  cleanups.push(() => db.from('products').delete().eq('id', row.id));
  expect(row).toMatchObject({ price: 0, product_type: 'one_time', allow_custom_price: false, is_bundle: false, event_mode: false, checkout_template: 'default' });
  expect(Object.keys(row).filter(key => /scenario/i.test(key))).toEqual([]);
});

// ===== EDIT: opening and saving without changes keeps the stored configuration =====

// Stored the way the panel stores products: the form loads a missing icon as 🚀 and empty texts as '' (useProductForm).
const base = { description: 'Opis', long_description: '', success_redirect_url: '', icon: '📦', currency: 'PLN', vat_rate: 23, price_includes_vat: true, is_active: true };
const STORED: Array<[keyof typeof S.options, Record<string, unknown>]> = [
  ['download', { price: 149, auto_grant_duration_days: 365, content_delivery_type: 'content', content_config: { content_items: [{ id: 'pdf', type: 'download_link', title: 'PDF', config: { download_url: 'https://drive.google.com/file/d/abc/view' }, order: 0, is_active: true }] } }],
  // A free product is never stored as "price includes VAT" (submit-vat.ts), so that is how the panel keeps it.
  ['free', { price: 0, price_includes_vat: false, lead_consent_required: true }],
  ['subscription', { price: 0, product_type: 'subscription', recurring_price: 30, billing_interval: 'month', billing_interval_count: 1, trial_days: 7 }],
  ['donation', { price: 0, allow_custom_price: true, custom_price_min: 10, custom_price_presets: [20, 50], checkout_template: 'tip-jar' }],
  ['bundle', { price: 99, is_bundle: true }],
  ['event', { price: 149, event_mode: true, allow_repeat_purchase: true, checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['person', 'organization'], bank_transfer_for: ['organization'] }, { id: 'quantity', min: 1, max: 30, mode: 'checkout' }] } }],
];

async function storedProduct(id: string, extra: Record<string, unknown>) {
  const name = `Scenariusz ${id} ${randomUUID().slice(0, 8)}`;
  const product = await checked(await db.from('products').insert({ name, slug: name.toLowerCase().replaceAll(' ', '-'), ...base, ...extra }).select('id').single());
  cleanups.push(() => db.from('products').delete().eq('id', product.id));
  if (id === 'bundle') {
    // A name the bundle search does not match, so the edited row is the bundle itself.
    const componentName = `Skladnik ${randomUUID().slice(0, 8)}`;
    const component = await checked(await db.from('products').insert({ name: componentName, slug: componentName.toLowerCase().replaceAll(' ', '-'), ...base, price: 50 }).select('id').single());
    cleanups.push(() => db.from('products').delete().eq('id', component.id));
    await checked(await db.from('bundle_items').insert({ bundle_product_id: product.id, component_product_id: component.id, display_order: 0 }).select());
  }
  if (id === 'event') {
    const session = await checked(await db.from('product_sessions').insert({ product_id: product.id, title: 'Szkolenie', starts_at: '2099-06-01T08:00:00Z', timezone: 'Europe/Warsaw', capacity: 30 }).select('id').single());
    await checked(await db.from('product_price_tiers').insert({ session_id: session.id, price: 149, sort: 0 }).select());
  }
  return { ...product, name };
}

/** The stored configuration as the buyer and the checkout read it (bookkeeping timestamps aside). */
async function configuration(productId: string) {
  const row = await checked(await db.from('products').select('*, sessions:product_sessions(*, tiers:product_price_tiers(*)), bundle:bundle_items!bundle_items_bundle_product_id_fkey(component_product_id, display_order)').eq('id', productId).single()) as Record<string, unknown>;
  // Bookkeeping of every save, not configuration: the update time and the product revision sent to webhooks.
  delete row.updated_at;
  delete row.webhook_revision;
  for (const session of (row.sessions as Array<Record<string, unknown>>)) { delete session.updated_at; for (const tier of session.tiers as Array<Record<string, unknown>>) delete tier.updated_at; }
  return row;
}

test('editing: each of the six scenarios is shown with only "Change", and saving without changes keeps the stored configuration', async ({ page }) => {
  test.setTimeout(180_000);
  await loginAsAdmin(page, admin.email, admin.password);
  for (const [id, extra] of STORED) {
    await test.step(id, async () => {
      const product = await storedProduct(id, extra);
      const before = await configuration(product.id);
      await page.goto('/pl/dashboard/products');
      await page.getByPlaceholder(/Szukaj/i).first().fill(product.name);
      await page.locator('tr').filter({ hasText: product.name }).locator('button[title*="Edytuj"]').first().click();
      await expect(scenarioBar(page)).toContainText(`${S.current} ${S.options[id].name}`);
      await expect(picker(page)).toHaveCount(0);
      await expect(scenarioBar(page).getByRole('button', { name: S.manual })).toHaveCount(0);
      await page.getByRole('button', { name: 'Aktualizuj produkt' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
      expect(await configuration(product.id)).toEqual(before);
    });
  }
});

test('phone and English: the choice fits 390 px and reads in English', async ({ page }) => {
  await openNewForm(page, 'en', 390);
  const E = en.admin.products.form.scenario;
  const group = picker(page, E.title);
  await expect(group.getByText(E.title)).toBeInViewport();
  await expect(group.getByText(E.hint)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await group.getByRole('button', { name: new RegExp(`^${E.options.subscription.name}`) }).click();
  await expect(scenarioBar(page)).toContainText(`${E.current} ${E.options.subscription.name}`);
  await expect(page.locator('[data-buyer-summary]')).toContainText('for as long as the subscription is paid');
});

test('editing: a switch confirmed after typing keeps what was typed, and an event turns off the buyer-chosen amount it cannot sell', async ({ page }) => {
  const product = await storedProduct('download', { price: 149, allow_custom_price: true, custom_price_min: 20, show_price_presets: true, custom_price_presets: [30, 50] });
  const renamed = `${product.name} po podglądzie`;
  await loginAsAdmin(page, admin.email, admin.password);
  await page.goto('/pl/dashboard/products');
  await page.getByPlaceholder(/Szukaj/i).first().fill(product.name);
  await page.locator('tr').filter({ hasText: product.name }).locator('button[title*="Edytuj"]').first().click();
  await scenarioBar(page).getByRole('button', { name: S.changeLabel }).click();
  await picker(page).getByRole('button', { name: new RegExp(`^${S.options.event.name}`) }).click();
  const preview = page.getByRole('region', { name: S.confirm.title.replace('{name}', S.options.event.name) });
  await expect(preview.getByRole('listitem').filter({ hasText: S.fields.customPrice })).toHaveText(`${S.fields.customPrice}: od 20,00 zł, propozycje: 30,00 zł, 50,00 zł → ${S.values.off}`);
  await expect(preview.getByText(S.warnings.eventIncompatible)).toHaveCount(0);

  await page.locator('input#name').fill(renamed);
  await preview.getByRole('button', { name: S.confirm.apply }).click();
  await expect(page.locator('input#name')).toHaveValue(renamed);
  await page.getByRole('button', { name: 'Aktualizuj produkt' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  expect(await configuration(product.id)).toMatchObject({ name: renamed, event_mode: true, allow_custom_price: false, price: 149, custom_price_min: 20, custom_price_presets: [30, 50] });
});
