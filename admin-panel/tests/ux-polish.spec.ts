/** Buyer and seller UX regression paths on a disposable local database. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestAdmin, setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import en from '@/messages/en.json';
import pl from '@/messages/pl.json';

test.describe.configure({ mode: 'serial' });
const productId = randomUUID();
const couponId = randomUUID();
const transactionId = randomUUID();
const upsellId = randomUUID();
const downsellId = randomUUID();
const offerId = randomUUID();
const slug = `ux-guide-${productId}`;
const email = `ux-${productId}@example.com`;
let admin: Awaited<ReturnType<typeof createTestAdmin>>;

test.beforeAll(async () => {
  admin = await createTestAdmin('ux-polish');
  const insert = async (table: string, value: object) => {
    const { error } = await supabaseAdmin.from(table).insert(value);
    if (error) throw error;
  };
  await insert('products', { id: productId, name: `Make Community Guide ${productId}`, slug, price: 19.99, currency: 'PLN', allow_custom_price: true, custom_price_min: 0, is_active: true, is_listed: true });
  await insert('coupons', { id: couponId, code: `UX${productId.replaceAll('-', '').slice(0, 12)}`, discount_type: 'percentage', discount_value: 10, is_active: true });
  for (const id of [upsellId, downsellId]) await insert('products', { id, name: 'UX offer', slug: `ux-offer-${id}`, price: 29, currency: 'PLN', checkout_template: 'oto', is_active: true });
  await insert('oto_offers', { id: offerId, source_product_id: productId, oto_product_id: upsellId, discount_type: 'percentage', discount_value: 10, duration_minutes: 15,
    downsell_product_id: downsellId, downsell_discount_type: 'percentage', downsell_discount_value: 20, downsell_duration_minutes: 15, is_active: true });
  await insert('payment_transactions', { id: transactionId, product_id: productId, metadata: { coupon_id: couponId, has_coupon: true }, customer_email: email,
    session_id: `cs_test_${productId.replaceAll('-', '')}`, amount: 4410, currency: 'PLN', status: 'completed' });
  await insert('coupon_redemptions', { transaction_id: transactionId, coupon_id: couponId, customer_email: email, discount_amount: 0 });
  await insert('payment_line_items', { transaction_id: transactionId, product_id: productId, product_name: 'Guide', item_type: 'main_product', quantity: 1, unit_price: 49, total_price: 49, discounted_total: null, currency: 'PLN' });
});
test.afterAll(async () => {
  await supabaseAdmin.from('coupons').delete().eq('source_transaction_id', transactionId);
  await supabaseAdmin.from('oto_offers').delete().eq('id', offerId);
  await supabaseAdmin.from('payment_line_items').delete().eq('transaction_id', transactionId);
  await supabaseAdmin.from('coupon_redemptions').delete().eq('transaction_id', transactionId);
  await supabaseAdmin.from('payment_transactions').delete().eq('id', transactionId);
  await supabaseAdmin.from('coupons').delete().eq('id', couponId);
  await supabaseAdmin.from('products').delete().in('id', [productId, upsellId, downsellId]);
  await admin?.cleanup();
});

for (const locale of ['en', 'pl'] as const) {
  const labels = locale === 'pl' ? pl : en;
  test(`${locale}: guest declines both offers and returns to purchase status @J81`, async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/${locale}/p/${slug}/payment-status?session_id=cs_test_${productId.replaceAll('-', '')}`);
    await expect(page).toHaveURL(new RegExp(`/checkout/ux-offer-${upsellId}`));
    const original = new URL(page.url()).searchParams.get('purchase_return');
    expect(original).toContain(`/${locale}/p/${slug}/payment-status?session_id=`);
    await page.getByTestId('oto-decline-button').click();
    await expect(page).toHaveURL(new RegExp(`/checkout/ux-offer-${downsellId}`));
    expect(new URL(page.url()).searchParams.get('purchase_return')).toBe(original);
    await page.getByTestId('oto-decline-button').click();
    await expect(page).toHaveURL(new RegExp(`/p/${slug}/payment-status.*offer_declined=1`));
    await expect(page.getByRole('heading', { name: /Sellf Admin/ })).toHaveCount(0);
    await expect(page.getByText(labels.paymentStatus.step1CheckEmail.replace('{email}', `(${email})`), { exact: true })).toBeVisible();
  });
  test(`${locale}: payment details explain the coupon and discount`, async ({ page }) => {
    await setAuthSession(page, admin.email, admin.password);
    await page.goto(`/${locale}/dashboard/payments`);
    const search = page.getByPlaceholder(labels.admin.payments.filters.searchPlaceholder);
    await search.fill(email);
    // Payments rows show the order number since cf62fe26 (orders list, W135).
    const { data: tx } = await supabaseAdmin.from('payment_transactions').select('order_number').eq('id', transactionId).single();
    const row = page.getByRole('row').filter({ hasText: new RegExp(`#${tx!.order_number}\\b`) });
    await expect(row).toContainText(email);
    await row.getByRole('button', { name: labels.admin.payments.transactions.details }).click();
    await expect(page.getByText(`${labels.checkout.couponDiscount} (UX${productId.replaceAll('-', '').slice(0, 12)})`, { exact: true })).toBeVisible();
    await expect(page.getByText(/−.*4[,.]90/)).toBeVisible();
    await expect(page.getByText(/44[,.]10/).last()).toBeVisible();
  });
  test(`${locale}: search and price filters survive product navigation and Back @J80`, async ({ page }) => {
    await acceptAllCookies(page);
    await page.goto(`/${locale}/store`);
    const search = page.getByRole('searchbox');
    await search.fill(`Make Community Guide ${productId}`);
    await search.press('Enter');
    await expect(page).toHaveURL(/search=Make/);
    const price = page.locator('select').filter({ has: page.locator('option[value=pwyw]') });
    await price.selectOption('pwyw');
    await expect(page).toHaveURL(/priceKind=pwyw/);
    const details = page.locator(`a[href="/${locale}/p/${slug}"]`).first();
    await expect(details).toBeVisible();
    await details.click();
    await expect(page).toHaveURL(new RegExp(`/p/${slug}`));
    await page.goBack();
    await expect(search).toHaveValue(`Make Community Guide ${productId}`);
    await expect(price).toHaveValue('pwyw');
    await page.reload();
    await expect(search).toHaveValue(`Make Community Guide ${productId}`);
    await expect(price).toHaveValue('pwyw');
    await expect(page.locator(`a[href="/${locale}/p/${slug}"]`).first()).toBeVisible();
  });
  test(`${locale}: discovery displays the PWYW minimum`, async ({ page }) => {
    await setAuthSession(page, admin.email, admin.password);
    await page.goto(`/${locale}/my-products`);
    const card = page.locator('.group').filter({ has: page.getByRole('heading', { name: `Make Community Guide ${productId}` }) });
    await expect(card.getByText(labels.variants.payWhatYouWant, { exact: true })).toBeVisible();
    await expect(card.getByText(locale === 'pl' ? /od.*0,00/ : /from.*0.00/)).toBeVisible();
    await expect(card.getByText('Premium', { exact: true })).toHaveCount(0);
  });
  test(`${locale}: zero payout has a balance-specific heading`, async ({ page }) => {
    await setAuthSession(page, admin.email, admin.password);
    await page.goto(`/${locale}/dashboard/affiliates/payouts`);
    const picker = page.getByRole('combobox').first();
    await picker.fill('Demo');
    await page.getByRole('option', { name: 'Demo Partner', exact: true }).click();
    await expect(page.getByText(`Demo Partner · ${locale === 'pl' ? 'Brak kwoty do wypłaty' : 'No amount available for payout'}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Demo Partner · ${labels.affiliates.payouts.payable}`, { exact: true })).toHaveCount(0);
  });
}

test('embedded Polish page uses Polish Stripe configuration and network errors', async ({ page }) => {
  await page.route('**/embed-host', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="pl"><body>
    <div data-sellf-embed data-product-slug="${slug}" data-coupon="LINK"></div>
    <script>window.Stripe=function(key, options){window.stripeOptions=options;return {initEmbeddedCheckout:async()=>({mount(target){target.textContent='Stripe fixture'},destroy(){}})}};</script>
    <script src="/embed/v1/checkout.js"></script></body></html>` }));
  await page.route('**/api/embed/checkout-session?*', route => route.request().postDataJSON().couponCode === 'SAVE'
    ? route.abort('failed') : route.fulfill({ json: { kind: 'paid', clientSecret: 'fixture' } }));
  await page.goto('/embed-host');
  await expect(page.getByText('Stripe fixture')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { stripeOptions: object }).stripeOptions)).toEqual({ locale: 'pl' });
  await page.getByRole('textbox', { name: 'Kod kuponu' }).fill('SAVE');
  await page.getByRole('button', { name: 'Zastosuj' }).click();
  await expect(page.getByRole('status')).toHaveText('Nie udało się połączyć. Spróbuj ponownie.');
});
