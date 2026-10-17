/** Default storefront acceptance: independent groups and retained buyer facts. */
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { acceptAllCookies } from './helpers/consent';
import { createTestAdmin, setAuthSession } from './helpers/admin-auth';
import { ProductStateGuard } from './helpers/product-state';
import type { BrowserContext, Page } from '@playwright/test';
import type { ProductCreateInput } from '@/lib/api/dto/product';

test.describe.configure({ mode: 'serial' });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
let admin: Awaited<ReturnType<typeof createTestAdmin>>;
let context: BrowserContext;
let guard: ProductStateGuard;
let productIds: string[] = [];

async function createProduct(input: Partial<ProductCreateInput> = {}) {
  const data = { name: 'Test product', slug: `storefront-${randomUUID()}`, description: 'Seller product description', price: 0, currency: 'USD', is_active: true, is_listed: true, ...input };
  const response = await context.request.post('/api/v1/products', { data });
  expect(response.status(), await response.text()).toBe(201);
  const product = (await response.json()).data as { id: string; name: string; slug: string; description: string; price: number };
  productIds.push(product.id);
  return product;
}
async function cleanup() {
  for (const id of productIds) {
    const response = await context.request.delete(`/api/v1/products/${id}`);
    expect(response.status(), await response.text()).toBe(204);
  }
  productIds = [];
}
async function open(page: Page) {
  await acceptAllCookies(page);
  await page.goto('/');
  await expect(page.getByTestId('storefront')).toBeVisible();
}
function group(page: Page, name: string) { return page.locator('#catalogue h3').filter({ hasText: new RegExp(`^${name}$`) }).locator('..'); }

test.beforeAll(async ({ browser, baseURL }) => {
  admin = await createTestAdmin('storefront-fixtures');
  context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
  await setAuthSession(await context.newPage(), admin.email, admin.password);
  guard = new ProductStateGuard(db, context.request);
  await guard.save();
});
test.beforeEach(async () => { await guard.deactivateAll(); });
test.afterEach(async () => { await cleanup(); await guard.restore(); });
test.afterAll(async () => { await guard?.restore(); await context?.close(); await admin?.cleanup(); });

test('FREE-ONLY shop: free hero, descriptions and free group', async ({ page }) => {
  const products = [];
  for (let i = 1; i <= 3; i++) products.push(await createProduct({ name: `Free Resource ${i}`, description: `Free resource description ${i}` }));
  await open(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Start Your Journey');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Completely Free');
  await expect(page.getByText(/Access.*3.*premium resources at no cost/i)).toBeVisible();
  await expect(group(page, 'Free products').locator('article')).toHaveCount(3);
  await expect(group(page, 'Paid products')).toHaveCount(0);
  for (const product of products) {
    const card = group(page, 'Free products').locator('article').filter({ hasText: product.name });
    await expect(card.getByText(product.description, { exact: true })).toBeVisible();
    await expect(card.getByText('Free', { exact: true })).toBeVisible();
  }
});

test('PAID-ONLY shop: premium hero, descriptions and prices', async ({ page }) => {
  const products = [];
  for (let i = 1; i <= 3; i++) products.push(await createProduct({ name: `Premium Product ${i}`, description: `Premium description ${i}`, price: 99 * i }));
  await open(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Premium Quality');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Professional Results');
  await expect(page.getByText(/Invest in excellence with.*3.*carefully crafted premium products/i)).toBeVisible();
  await expect(group(page, 'Paid products').locator('article')).toHaveCount(3);
  await expect(group(page, 'Free products')).toHaveCount(0);
  for (const product of products) {
    const card = group(page, 'Paid products').locator('article').filter({ hasText: product.name });
    await expect(card.getByText(product.description, { exact: true })).toBeVisible();
    await expect(card.getByText(`$${product.price.toFixed(2)}`, { exact: true })).toBeVisible();
  }
});

test('MIXED shop: mixed hero and both independent groups', async ({ page }) => {
  for (let i = 1; i <= 2; i++) { await createProduct({ name: `Free Tool ${i}` }); await createProduct({ name: `Pro Course ${i}`, price: 199 }); }
  await open(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('From Free');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('To Professional');
  await expect(page.getByText(/Start with.*2 free.*resources.*upgrade to.*2 premium/i)).toBeVisible();
  for (const name of ['Free products', 'Paid products']) await expect(group(page, name).locator('article')).toHaveCount(2);
});

test('FEATURED products: distinct featured group retains each product and description', async ({ page }) => {
  const products = [];
  for (let i = 1; i <= 3; i++) products.push(await createProduct({ name: `Featured Product ${i}`, description: `Featured description ${i}`, price: i === 1 ? 0 : 299, is_featured: true }));
  await open(page);
  const featured = group(page, 'Featured');
  await expect(featured.locator('article')).toHaveCount(3);
  for (const product of products) {
    const card = featured.locator('article').filter({ hasText: product.name });
    await expect(card.getByRole('heading', { name: product.name, exact: true })).toBeVisible();
    await expect(card.getByText(product.description, { exact: true })).toBeVisible();
  }
});

test('TEMPORAL availability: visible deadline; future and expired offers excluded', async ({ page }) => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  await createProduct({ name: 'Limited Time Offer', price: 49, available_until: tomorrow });
  await createProduct({ name: 'Coming Soon Product', price: 99, available_from: tomorrow });
  await createProduct({ name: 'Expired Product', price: 99, available_until: new Date(Date.now() - 86400000).toISOString() });
  await open(page);
  const card = group(page, 'Paid products').locator('article');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('heading', { name: 'Limited Time Offer' })).toBeVisible();
  await expect(card.locator('time')).toHaveAttribute('datetime', tomorrow);
  await expect(card.locator('time')).toBeVisible();
  for (const name of ['Coming Soon Product', 'Expired Product']) await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
});

test('ACCESS DURATION: 30-day badge remains visible', async ({ page }) => {
  await createProduct({ name: '30-Day Access Course', price: 79, auto_grant_duration_days: 30 });
  await open(page);
  const badge = group(page, 'Paid products').getByText('30d access', { exact: true });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveClass(/text-sf-accent/);
});

for (const kind of ['free', 'paid'] as const) test(`PAGINATION ${kind}: twelve initially, next page independent with no duplicates`, async ({ page }) => {
  const other = kind === 'free' ? 'paid' : 'free';
  for (let i = 1; i <= 14; i++) await createProduct({ name: `${kind} resource ${i}`, price: kind === 'free' ? 0 : 99 });
  for (let i = 1; i <= 4; i++) await createProduct({ name: `${other} resource ${i}`, price: other === 'free' ? 0 : 99 });
  await open(page);
  const target = group(page, kind === 'free' ? 'Free products' : 'Paid products');
  const untouched = group(page, kind === 'free' ? 'Paid products' : 'Free products');
  await expect(target.locator('article')).toHaveCount(12);
  await expect(untouched.locator('article')).toHaveCount(4);
  const originalOther = await untouched.getByRole('heading').allTextContents();
  const more = page.getByRole('button', { name: `More ${kind} products`, exact: true });
  await more.click();
  await expect(target.locator('article')).toHaveCount(14);
  await expect(more).toHaveCount(0);
  const names = await target.locator('article').getByRole('heading').allTextContents();
  expect(new Set(names).size).toBe(14);
  expect(await untouched.getByRole('heading').allTextContents()).toEqual(originalOther);
  await expect(untouched.getByRole('button')).toHaveCount(0);
});

test('COMPOSITION: accepted default storefront and catalogue render', async ({ page }) => {
  await createProduct(); await open(page);
  await expect(page.getByTestId('storefront')).toHaveAttribute('data-template', 'default');
  await expect(page.locator('#catalogue')).toBeVisible();
});

test('SHOP NAME: configured seller branding remains visible', async ({ page }) => {
  await createProduct(); await open(page);
  const shop = await db.from('shop_config').select('shop_name').single(); expect(shop.error).toBeNull();
  expect(shop.data!.shop_name).toBeTruthy();
  await expect(page.getByText(new RegExp(shop.data!.shop_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).first()).toBeVisible();
});

test('CTA BUTTONS: both price groups link to their product details', async ({ page }) => {
  const free = await createProduct({ name: 'Free CTA Test' });
  const paid = await createProduct({ name: 'Paid CTA Test', price: 99 });
  await open(page);
  for (const product of [free, paid]) {
    const link = page.getByRole('link', { name: `View details: ${product.name}`, exact: true });
    await expect(link).toBeVisible(); await expect(link).toHaveAttribute('href', `/en/p/${product.slug}`);
  }
});

test('RESPONSIVE: storefront content is in the server response and fits a narrow screen', async ({ page }) => {
  await createProduct({ name: 'First paint product' });
  await acceptAllCookies(page);
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(await response!.text()).toContain('First paint product');
  await expect(page.getByTestId('storefront')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('PRODUCT COUNT: bounded shown count follows one and three products', async ({ page }) => {
  await createProduct({ name: 'Single product' }); await open(page);
  await expect(page.locator('#catalogue [role=status]')).toHaveText('Products shown: 1');
  await cleanup();
  for (let i = 1; i <= 3; i++) await createProduct({ name: `Product ${i}` });
  await page.reload();
  await expect(page.locator('#catalogue [role=status]')).toHaveText('Products shown: 3');
  await expect(group(page, 'Free products').locator('article')).toHaveCount(3);
});
