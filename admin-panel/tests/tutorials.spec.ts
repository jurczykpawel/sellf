/** Guided tutorials: first-visit start, per-user memory, every tutorial walked on its real screen, keyboard, mobile and menu. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { supabaseAdmin as db } from './helpers/admin-auth';
import { checkAccessibility } from './helpers/axe';
import { menuName, mustAct, popover, popoverTitle, seenTutorials, stepText, tutorialAdmin, walk } from './helpers/tutorials';
import type { Page } from '@playwright/test';

if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.SUPABASE_URL ?? '')) throw new Error('Requires a local disposable Supabase stack');
test.setTimeout(90_000);

const cleanups: Array<() => Promise<unknown>> = [];
test.afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function checked<T>({ data, error }: { data: T; error: unknown }): Promise<NonNullable<T>> { if (error) throw error; return data!; }
async function productFixture(prefix: string, extra: Record<string, unknown> = {}) {
  const name = `${prefix} ${randomUUID().slice(0, 8)}`;
  const product = await checked(await db.from('products').insert({ name, slug: name.toLowerCase().replaceAll(' ', '-'), description: '', price: 50, currency: 'PLN', vat_rate: 23, ...extra }).select('id').single());
  cleanups.push(() => db.from('products').delete().eq('id', product.id));
  return { ...product, name };
}
async function admin(page: Page, prefix: string, autostart = true) {
  const session = await tutorialAdmin(page, prefix, autostart);
  cleanups.push(() => session.cleanup());
  return session;
}
async function openSalesSettings(page: Page, productName: string) {
  await page.goto('/pl/dashboard/products');
  const search = page.getByPlaceholder(/Szukaj/i).first();
  await search.fill(productName);
  await page.locator('tr').filter({ hasText: productName }).locator('button[title*="Edytuj"], button[title*="Edit"]').first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Dalej/i }).click();
  await dialog.getByRole('button', { name: /Dalej/i }).click();
  await page.locator('[data-step3-group="B"]').getByRole('button').first().click();
}

test('store templates tutorial starts on the first visit, is remembered per user and can be replayed from the help menu @J210', async ({ page, browser }) => {
  const session = await admin(page, 'tour-templates');
  await page.goto('/pl/dashboard/templates');
  await expect(popoverTitle(page)).toHaveText(stepText('storefront-templates', 'intro').title);
  await walk(page, 'storefront-templates', ['intro', 'workspace', 'template', 'sections', 'section', 'appearance', 'save', 'preview']);
  await expect.poll(() => seenTutorials(session.userId)).toEqual(['storefront-templates']);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Szablony sklepu' })).toBeVisible();
  await page.waitForFunction(() => performance.now() > 3000);
  await expect(popover(page)).toHaveCount(0);

  await page.getByTestId('tutorial-menu-button').click();
  await page.getByTestId('tutorial-start-storefront-templates').click();
  await expect(popoverTitle(page)).toHaveText(stepText('storefront-templates', 'intro').title);
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);

  const other = await browser.newPage();
  const second = await admin(other, 'tour-templates-b');
  await other.goto('/pl/dashboard/templates');
  await expect(popoverTitle(other)).toHaveText(stepText('storefront-templates', 'intro').title);
  await expect.poll(() => seenTutorials(second.userId)).toContain('storefront-templates');
  await other.close();
});

test('product offer tutorial walks the offer editor of a chosen product @J211', async ({ page }) => {
  const session = await admin(page, 'tour-offer');
  const product = await productFixture('Oferta samouczek');
  await page.goto(`/pl/dashboard/templates?surface=offer&product=${product.id}`);
  await walk(page, 'offer-page', ['intro', 'product', 'save', 'publication', 'sections', 'editor']);
  await expect.poll(() => seenTutorials(session.userId)).toEqual(['offer-page']);
});

test('business cart tutorial starts when the custom cart is switched on and its prompt waits for a click when started by hand @J212', async ({ page }) => {
  const session = await admin(page, 'tour-profile');
  const product = await productFixture('Koszyk samouczek');
  await openSalesSettings(page, product.name);
  await expect(page.getByLabel('Własny koszyk dla tego produktu')).not.toBeChecked();
  await page.waitForFunction(() => performance.now() > 3000);
  await expect(popover(page)).toHaveCount(0);

  await page.getByLabel('Własny koszyk dla tego produktu').check();
  await expect(popoverTitle(page)).toHaveText(stepText('b2b-checkout-profile', 'intro').title);
  await walk(page, 'b2b-checkout-profile', ['intro', 'enable', 'buyer', 'recipient', 'quantity', 'participants']);
  await expect.poll(() => seenTutorials(session.userId)).toEqual(['b2b-checkout-profile']);

  await page.getByLabel('Własny koszyk dla tego produktu').uncheck();
  await page.getByTestId('tutorial-help-b2b-checkout-profile').click();
  await popover(page).locator('.driver-popover-next-btn').click();
  await expect(popover(page).locator('.driver-popover-description')).toHaveText(stepText('b2b-checkout-profile', 'enable').bodyAct!);
  await popover(page).locator('.driver-popover-next-btn').click();
  await expect(popover(page).locator('.driver-popover-description')).toHaveText(mustAct);
  await page.getByLabel('Własny koszyk dla tego produktu').check();
  await expect(popoverTitle(page)).toHaveText(stepText('b2b-checkout-profile', 'buyer').title);
});

test('event tutorial leads from switching on event mode to adding a date and a price tier @J213', async ({ page }) => {
  const session = await admin(page, 'tour-events');
  const product = await productFixture('Wydarzenie samouczek');
  await openSalesSettings(page, product.name);
  await expect(page.getByRole('region', { name: 'Terminy i ceny' })).toBeVisible();
  await page.getByLabel('Tryb wydarzenia', { exact: true }).check();
  await expect(popoverTitle(page)).toHaveText(stepText('events', 'intro').title);
  await popover(page).locator('.driver-popover-next-btn').click();
  await expect(popoverTitle(page)).toHaveText(stepText('events', 'enable').title);
  await popover(page).locator('.driver-popover-next-btn').click();
  await expect(popoverTitle(page)).toHaveText(stepText('events', 'addSession').title);
  await expect(popover(page).locator('.driver-popover-description')).toHaveText(stepText('events', 'addSession').bodyAct!);
  await page.getByRole('button', { name: 'Dodaj termin', exact: true }).click();
  await walk(page, 'events', ['session', 'tier', 'addTier']);
  await expect(page.getByRole('group', { name: /^Termin 1/ })).toBeVisible();
  await expect.poll(() => seenTutorials(session.userId)).toEqual(['events']);
});

test('bank transfer settings tutorial covers the payment tab @J214', async ({ page }) => {
  const session = await admin(page, 'tour-transfer');
  await page.goto('/pl/dashboard/settings?tab=payments');
  await walk(page, 'bank-transfer-setup', ['intro', 'enable', 'account', 'due', 'reservation', 'save']);
  await expect.poll(() => seenTutorials(session.userId)).toEqual(['bank-transfer-setup']);
});

test.describe('unpaid transfer order', () => {
  let bankConfig: Record<string, unknown>;
  test.beforeAll(async () => {
    bankConfig = await checked(await db.from('bank_transfer_config').select('*').single());
    await checked(await db.from('bank_transfer_config').update({ bank_transfer_enabled: true, bank_account_holder: 'Sklep samouczek', bank_account_number: 'PL61109010140000071219812874' }).eq('id', true).select());
  });
  test.afterAll(async () => { await db.from('bank_transfer_config').update(bankConfig).eq('id', true); });

  test('guides the seller through settling an order that waits for a transfer @J215', async ({ page }) => {
    const session = await admin(page, 'tour-unpaid');
    const product = await productFixture('Przelew samouczek', { vat_exempt: true, checkout_profile: { v: 1, modules: [{ id: 'buyer', types: ['person', 'organization'], gus: false, bank_transfer_for: ['organization'] }] } });
    const buyer = `tour-unpaid-${randomUUID()}@example.com`;
    const lines = [{ product_id: product.id, item_type: 'main_product', quantity: 1, unit_price: 50, total_price: 50, discounted_total: 50, currency: 'PLN' }];
    const placed = await checked(await db.rpc('bank_transfer_order', { p_order: { product_id: product.id, currency: 'PLN', customer_email: buyer, order_details: { v: 1, buyer: { type: 'organization', terms_accepted: true } }, metadata: { locale: 'pl' } }, p_lines: lines })) as { transaction_id: string };
    cleanups.push(() => db.from('payment_transactions').delete().eq('id', placed.transaction_id));
    await page.goto('/pl/dashboard/payments');
    await expect(popoverTitle(page)).toHaveText(stepText('payments-orders', 'intro').title);
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
    await page.getByPlaceholder(/e-mail|email/i).first().fill(buyer);
    await page.getByRole('button', { name: 'Szczegóły' }).first().click();
    await walk(page, 'unpaid-orders', ['intro', 'instructions', 'markPaid', 'cancel', 'lifecycle', 'invoice']);
    await expect.poll(() => seenTutorials(session.userId)).toContain('unpaid-orders');
  });
});

test('affiliate programme tutorial introduces the programme screens @J216', async ({ page }) => {
  const session = await admin(page, 'tour-affiliates');
  await page.goto('/pl/dashboard/affiliates');
  const { count } = await db.from('affiliate_memberships').select('id', { count: 'exact', head: true });
  await walk(page, 'affiliates', ['intro', 'navigation', 'settings', 'applications', ...(count ? ['member'] : [])]);
  await expect.poll(() => seenTutorials(session.userId)).toEqual(['affiliates']);
});

test('license tutorial covers issuing and managing product licenses @J217', async ({ page }) => {
  const session = await admin(page, 'tour-licenses');
  await page.goto('/pl/dashboard/licenses');
  await walk(page, 'licenses', ['intro', 'issue', 'filters', 'table']);
  await expect.poll(() => seenTutorials(session.userId)).toEqual(['licenses']);
});

test('purchase source tutorial covers retention and channel rules @J218', async ({ page }) => {
  const session = await admin(page, 'tour-sources');
  await page.goto('/pl/dashboard/settings?tab=legal');
  await walk(page, 'attribution', ['intro', 'retention', 'rules', 'addRule', 'save']);
  await expect.poll(() => seenTutorials(session.userId)).toEqual(['attribution']);
});

test('payments tutorial walks the list and points at the order details @J219', async ({ page }) => {
  const session = await admin(page, 'tour-payments');
  const product = await productFixture('Platnosc samouczek');
  const row = await checked(await db.from('payment_transactions').insert({ session_id: `cs_test_tour_${Date.now()}`, product_id: product.id, customer_email: `tour-pay-${randomUUID()}@example.com`, amount: 5000, currency: 'PLN', status: 'completed', stripe_payment_intent_id: `pi_test_tour_${Date.now()}` }).select('id').single());
  cleanups.push(() => db.from('payment_transactions').delete().eq('id', row.id));
  await page.goto('/pl/dashboard/payments');
  await walk(page, 'payments-orders', ['intro', 'stats', 'filters', 'table', 'details', 'ordersTab', 'ordersFilters'], { ordersTab: () => page.getByRole('tab', { name: 'Zamówienia' }).click() });
  await expect.poll(() => seenTutorials(session.userId)).toEqual(['payments-orders']);
});

test('tutorial popover is a labelled dialog operated from the keyboard without accessibility violations', async ({ page }) => {
  await admin(page, 'tour-keyboard');
  await page.goto('/pl/dashboard/templates');
  const dialog = popover(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-labelledby', 'driver-popover-title');
  await expect(dialog).toHaveAttribute('aria-describedby', 'driver-popover-description');
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.driver-popover') !== null)).toBe(true);
  const results = await checkAccessibility(page, { excludeSelectors: ['body > :not(.driver-popover)'] });
  expect(results.violations).toEqual([]);
  await page.keyboard.press('ArrowRight');
  await expect(popoverTitle(page)).toHaveText(stepText('storefront-templates', 'workspace').title);
  await page.keyboard.press('ArrowLeft');
  await expect(popoverTitle(page)).toHaveText(stepText('storefront-templates', 'intro').title);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('.driver-popover') === null)).toBe(true);
});

test('tutorial fits a 390 px phone screen and the help menu stays reachable', async ({ page }) => {
  await admin(page, 'tour-mobile');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/pl/dashboard/templates');
  await expect(popoverTitle(page)).toBeVisible();
  for (let step = 0; step < 4; step++) {
    const box = await popover(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await expect(popover(page).locator('.driver-popover-next-btn')).toBeInViewport();
    await popover(page).locator('.driver-popover-next-btn').click();
  }
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);
  await page.getByTestId('tutorial-menu-button').click();
  await expect(page.getByTestId('tutorial-start-storefront-templates')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('help menu lists the open screen first and opens other tutorials on their screens', async ({ page }) => {
  await admin(page, 'tour-menu', false);
  await page.goto('/pl/dashboard/templates');
  await page.getByTestId('tutorial-menu-button').click();
  await expect(page.getByTestId('tutorial-start-storefront-templates')).toHaveText(menuName('storefront-templates'));
  await expect(page.getByTestId('tutorial-link-b2b-checkout-profile')).toContainText('Produkty, edycja produktu');
  await page.getByTestId('tutorial-link-attribution').click();
  await expect(page).toHaveURL(/dashboard\/settings\?tab=legal&tutorial=attribution|dashboard\/settings\?tab=legal$/);
  await expect(popoverTitle(page)).toHaveText(stepText('attribution', 'intro').title);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tutorial-menu-button')).toBeVisible();
});
