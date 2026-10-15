/**
 * Opt-in recipe acceptance tests against local Sellf through a real stdio server.
 * @see docs-site/src/content/docs/connect-ai-agent.md
 * Run with SELLF_RECIPE_E2E=1 and admin-panel/.env.local loaded into the environment.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, expect, it } from 'vitest';

const baseUrl = process.env.SELLF_API_URL ?? 'http://localhost:3789';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const run = randomUUID().slice(0, 8);
const slug = `agent-recipe-${run}`;
const code = `RECIPE-${run.toUpperCase()}`;
const clients: Client[] = [];
const keyIds: string[] = [];
const paymentIds: string[] = [];
const transcript: unknown[] = [];
let editor: Client;
let coupons: Client;
let reporter: Client;
let productId: string;
let couponId: string;

interface CreatedRecord { id: string; is_active: boolean }
interface SavedProduct extends CreatedRecord {
  features: Array<{ title: string; items: string[] }>;
}
interface WeeklyReport {
  products: Array<{ product_id: string; sales_count: number;
    by_currency: Record<string, { revenue: number; count: number }> }>;
  filters: { period: string; limit: number; sort_by: string; start_date: string };
  generated_at: string;
}

async function fixture(path: string, method = 'GET', body?: unknown): Promise<Array<{ id: string }>> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.ok, `Fixture ${method} ${path}: ${await response.clone().text()}`).toBe(true);
  return response.json();
}

async function connect(scopes: string[]): Promise<Client> {
  const [admin] = await fixture('admin_users?select=id&limit=1');
  const key = `sf_test_${randomBytes(32).toString('hex')}`;
  const id = randomUUID();
  await fixture('api_keys', 'POST', { id, admin_user_id: admin.id,
    name: `Agent recipe ${run}`, key_hash: createHash('sha256').update(key).digest('hex'),
    key_prefix: key.slice(0, 16), scopes });
  keyIds.push(id);
  const client = new Client({ name: 'sellf-recipe-test', version: '1.0.0' });
  clients.push(client);
  await client.connect(new StdioClientTransport({
    command: process.env.SELLF_BUN_PATH ?? 'bun', args: ['src/index.ts'],
    env: { PATH: process.env.PATH!, SELLF_API_URL: baseUrl, SELLF_API_KEY: key },
    stderr: 'pipe',
  }));
  transcript.push({ connection: 'stdio', scopes });
  return client;
}

async function call<T = unknown>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  transcript.push({ name, arguments: args, result });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  const text = (result.content as Array<{ text: string }>).map(c => c.text).join('\n');
  const start = text.indexOf('{');
  return (start < 0 ? text : JSON.parse(text.slice(start))) as T;
}

beforeAll(async () => {
  for (const url of [baseUrl, supabaseUrl]) {
    expect(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Local services only').toBe(true);
  }
  editor = await connect(['products:read', 'products:write']);
  coupons = await connect(['coupons:read', 'coupons:write']);
  reporter = await connect(['analytics:read']);
}, 30_000);

afterAll(async () => {
  try {
    // Remove dependent fixtures first; never touch unrelated records.
    for (const id of paymentIds) await fixture(`payment_transactions?id=eq.${id}`, 'DELETE');
    if (couponId) await call(coupons, 'delete_coupon', { id: couponId });
    if (productId) await call(editor, 'delete_product', { id: productId });
    if (productId) expect(await fixture(`products?id=eq.${productId}&select=id`)).toEqual([]);
    if (couponId) expect(await fixture(`coupons?id=eq.${couponId}&select=id`)).toEqual([]);
    for (const id of paymentIds) expect(await fixture(`payment_transactions?id=eq.${id}&select=id`)).toEqual([]);
    transcript.push({ cleanup: 'Product, coupon and payment fixtures absent' });
  } finally {
    await Promise.all(clients.map(client => client.close()));
    for (const id of keyIds) {
      await fixture(`api_keys?id=eq.${id}`, 'DELETE');
      expect(await fixture(`api_keys?id=eq.${id}&select=id`)).toEqual([]);
    }
    transcript.push({ cleanup: 'Temporary API keys absent' });
    if (process.env.SELLF_RECIPE_TRANSCRIPT) {
      await writeFile(process.env.SELLF_RECIPE_TRANSCRIPT, JSON.stringify(transcript, null, 2));
    }
  }
}, 30_000);

it('drafts an offer with checkout fields, then verifies an explicitly published payment page', async () => {
  transcript.push({ prompt: `Use Sellf MCP. Draft this offer: Automation workbook, 49.99 PLN, a practical workbook with three exercises. Use slug ${slug}. Create a one-time product with description, full description and feature sections. Keep it inactive and unlisted. Return its ID, admin preview URL and checkout URL. Do not publish.` });
  const product = await call<CreatedRecord>(editor, 'create_product', {
    name: 'Automation workbook', slug, price: 49.99, currency: 'PLN',
    description: 'A practical workbook with three exercises.',
    long_description: 'Practice automation with three guided exercises.',
    features: [{ title: 'Included', items: ['Workbook', 'Three exercises'] }],
    product_type: 'one_time', is_listed: false,
  });
  productId = product.id;
  expect(productId).toBeTruthy();
  expect(product.is_active).toBe(false);
  const saved = await call<SavedProduct>(editor, 'get_product', { id: productId });
  expect(saved).toMatchObject({ price: 49.99, currency: 'PLN', is_active: false, is_listed: false });
  expect(saved.features).toEqual([{ title: 'Included', items: ['Workbook', 'Three exercises'] }]);
  transcript.push({ preview: `${baseUrl}/p/${slug}?preview=1`, checkout: `${baseUrl}/checkout/${slug}` });
  const draftResponse = await fetch(`${baseUrl}/checkout/${slug}`);
  expect(draftResponse.status).toBe(404);
  transcript.push({ draftCheckoutHttpStatus: draftResponse.status });
  transcript.push({ prompt: `Publish only product ${productId} for this local test. Keep it unlisted.` });
  await call(editor, 'update_product', { id: productId, is_active: true });
  const response = await fetch(`${baseUrl}/checkout/${slug}`);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('Automation workbook');
  expect(html).toContain('49.99');
  transcript.push({ checkoutHttpStatus: response.status, checkoutContainsOfferAndPrice: true });
  await call(editor, 'update_product', { id: productId, is_active: false });
}, 60_000);

it('creates and reads back a product-scoped coupon with exact limits', async () => {
  expect(productId).toBeTruthy();
  transcript.push({ prompt: `Use Sellf MCP. Create active coupon ${code}: 20% off only product ${productId}, 10 total uses, once per email, exclude order bumps. Read it back and show the restrictions. Do not change the product.` });
  const coupon = await call<CreatedRecord>(coupons, 'create_coupon', {
    code, discount_type: 'percentage', discount_value: 20, is_active: true,
    allowed_product_ids: [productId], usage_limit_global: 10,
    usage_limit_per_user: 1, exclude_order_bumps: true,
  });
  couponId = coupon.id;
  expect(couponId).toBeTruthy();
  expect(await call(coupons, 'get_coupon', { id: couponId })).toMatchObject({
    code, discount_type: 'percentage', discount_value: 20, is_active: true,
    allowed_product_ids: [productId], usage_limit_global: 10,
    usage_limit_per_user: 1, exclude_order_bumps: true,
  });
}, 30_000);

it('reports a trailing week by currency with an analytics-only key', async () => {
  expect(productId).toBeTruthy();
  // Synthetic transactions exercise money and date boundaries without Stripe charges.
  const now = Date.now();
  const rows = [
    { days: 1, amount: 4999, currency: 'PLN', status: 'completed' },
    { days: 2, amount: 2500, currency: 'USD', status: 'completed' },
    { days: 9, amount: 9900, currency: 'PLN', status: 'completed' },
    { days: 1, amount: 1000, currency: 'PLN', status: 'pending' },
  ].map(({ days, ...row }) => ({ ...row, id: randomUUID(), product_id: productId,
    session_id: `cs_test_recipe_${randomBytes(16).toString('hex')}`, customer_email: 'recipe@example.invalid',
    created_at: new Date(now - days * 86400000).toISOString() }));
  await fixture('payment_transactions', 'POST', rows);
  paymentIds.push(...rows.map(row => row.id));
  transcript.push({ fixtures: rows });
  transcript.push({ prompt: 'Use Sellf MCP with analytics:read only. Produce a sales report for the trailing seven days using get_top_products(period="week", limit=50, sort_by="sales"). State the returned start date and generation time. Show completed sales and revenue per product and currency. Convert minor units using each currency’s exponent. Never add currencies together. Explain that the report covers at most 50 returned products; if the limit is reached, say it may be incomplete. Do not forecast or claim a previous-week comparison. Do not mutate anything.' });
  const report = await call<WeeklyReport>(reporter, 'get_top_products', { period: 'week', limit: 50, sort_by: 'sales' });
  const item = report.products.find(p => p.product_id === productId)!;
  expect(item, 'Recipe product included in top 50').toBeTruthy();
  expect(item.sales_count).toBe(2);
  expect(item.by_currency).toEqual({ PLN: { revenue: 4999, count: 1 }, USD: { revenue: 2500, count: 1 } });
  expect(report.filters).toMatchObject({ period: 'week', limit: 50, sort_by: 'sales' });
  expect(Date.parse(report.filters.start_date)).toBeGreaterThan(now - 8 * 86400000);
  expect(report.generated_at).toBeTruthy();
  transcript.push({ report: { coverage: 'At most 50 products; trailing seven days; completed transactions',
    fixtureProduct: { sales: item.sales_count, PLN: '49.99', USD: '25.00' } } });
  const denied = await reporter.callTool({ name: 'get_product', arguments: { id: productId } });
  expect(denied.isError).toBe(true);
  expect(JSON.stringify(denied.content)).toMatch(/scope|permission|FORBIDDEN/i);
  transcript.push({ name: 'get_product', arguments: { id: productId }, result: denied,
    scopeCheck: 'analytics:read cannot call get_product' });
}, 30_000);
