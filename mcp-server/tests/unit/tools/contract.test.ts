/** MCP contract regressions, verified against the v1 endpoint implementations. */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { registerProductsTools } from '../../../src/tools/products.js';
import { registerCouponsTools } from '../../../src/tools/coupons.js';
import { registerPaymentsTools } from '../../../src/tools/payments.js';
import { registerAnalyticsTools } from '../../../src/tools/analytics.js';
import { registerUsersTools } from '../../../src/tools/users.js';
import { registerPrompts } from '../../../src/prompts/index.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../../../src/api-client.js', () => ({ getApiClient: () => api }));
interface Tool {
  description: string;
  schema: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
}
const tools = new Map<string, Tool>();
beforeEach(() => {
  vi.resetAllMocks();
  tools.clear();
  const server = { tool: (name: string, description: string, schema: Tool['schema'], handler: Tool['handler']) => {
    tools.set(name, { description, schema, handler });
  } } as unknown as McpServer;
  [registerProductsTools, registerCouponsTools, registerPaymentsTools, registerAnalyticsTools, registerUsersTools].forEach(register => register(server));
});

const productMoney = ['price', 'sale_price', 'recurring_price', 'custom_price_min', 'custom_price_presets'];
describe('money contracts', () => {
  for (const tool of ['create_product', 'update_product']) {
    for (const field of productMoney) {
      it(`${tool}.${field} uses major units`, () => {
        expect(tools.get(tool)!.schema[field]?.description).toContain('major units');
        expect(tools.get(tool)!.schema[field]?.description).toContain('49.99 means 49.99');
      });
    }
  }
  for (const tool of ['create_coupon', 'update_coupon']) {
    it(`${tool}.discount_value uses major units for fixed discounts`, () => {
      expect(tools.get(tool)!.schema.discount_value.description).toContain('major units');
      expect(tools.get(tool)!.schema.discount_value.description).toContain('49.99 means 49.99');
      expect(tools.get(tool)!.schema.discount_value.description).toContain('25 means 25%');
    });
  }
  it('process_refund.amount uses minor units', () => {
    expect(tools.get('process_refund')!.schema.amount.description).toContain('minor units');
    expect(tools.get('process_refund')!.schema.amount.description).toContain('4999 means 49.99');
  });
  for (const tool of ['list_payments', 'search_payments', 'export_payments', 'list_failed_payments', 'get_user_purchases']) {
    it(`${tool} distinguishes line prices from transaction amounts`, () => {
      const description = tools.get(tool)!.description;
      expect(description).toContain('line_items.unit_price');
      expect(description).toContain('line_items.total_price');
      expect(description).toContain('major units');
      expect(description).toContain('net_total');
      expect(description).toContain('tax_total');
      expect(description).toContain('net_amount');
      expect(description).toContain('tax_amount');
    });
  }
  it('get_payment labels product price and tax totals', () => {
    const description = tools.get('get_payment')!.description;
    expect(description).toContain('product.price');
    expect(description).toContain('net_total');
    expect(description).toContain('tax_total');
  });
  const outputUnits: Record<string, string[]> = {
    list_products: ['major units'], get_product: ['major units'], create_product: ['major units'], update_product: ['major units'], duplicate_product: ['major units'],
    get_product_stats: ['major units', 'minor units'],
    list_coupons: ['major units'], get_coupon: ['major units'], create_coupon: ['major units'], update_coupon: ['major units'], get_coupon_stats: ['major units'],
    list_payments: ['minor units'], get_payment: ['major units', 'minor units'], search_payments: ['minor units'], process_refund: ['minor units'], export_payments: ['minor units'], list_failed_payments: ['minor units'], get_payment_stats: ['minor units'],
    get_dashboard: ['minor units'], get_revenue_stats: ['minor units'], get_revenue_by_product: ['major units', 'minor units'], get_sales_trends: ['minor units'], get_top_products: ['major units', 'minor units'], get_refund_stats: ['minor units'], compare_periods: ['minor units'],
    list_users: ['major units'], get_user: ['major units'], search_users: ['major units'], extend_access: ['major units'], get_user_purchases: ['minor units'],
  };
  for (const [name, units] of Object.entries(outputUnits)) {
    it(`${name} labels returned money`, () => {
      for (const unit of units) expect(tools.get(name)!.description).toContain(unit);
    });
  }
});

describe('product contracts', () => {
  it('offers only product fields backed by database columns', () => {
    for (const name of ['create_product', 'update_product']) {
      for (const field of ['tip_icon', 'metadata']) {
        expect(tools.get(name)!.schema).not.toHaveProperty(field);
      }
    }
  });

  it('creates a draft when is_active is omitted, including direct handler calls', async () => {
    const tool = tools.get('create_product')!;
    api.post.mockResolvedValue({ data: {} });
    await tool.handler({ name: 'Course', slug: 'course', price: 149 });
    expect(api.post).toHaveBeenCalledWith('/api/v1/products', expect.objectContaining({ price: 149, is_active: false }));
    expect(z.object(tool.schema).parse({ name: 'Course', slug: 'course', description: 'Course', price: 149 }).is_active).toBe(false);
    expect(tool.description).toContain('draft');
    expect(tool.description).toContain('update_product');
  });
  it('allows explicit publishing and does not default update status', async () => {
    api.post.mockResolvedValue({ data: {} });
    await tools.get('create_product')!.handler({ name: 'Course', slug: 'course', price: 149, is_active: true });
    expect(api.post).toHaveBeenCalledWith('/api/v1/products', expect.objectContaining({ is_active: true }));
    expect(z.object(tools.get('update_product')!.schema).parse({ id: '11111111-1111-4111-8111-111111111111' })).not.toHaveProperty('is_active');
  });
  const dto = readFileSync(new URL('../../../../admin-panel/src/lib/api/dto/product.ts', import.meta.url), 'utf8');
  const fields = [...dto.split('const baseShape = {')[1].split('export const ProductCreateDTO')[0].matchAll(/^  ([a-z_]+):/gm)].map(match => match[1]).filter(field => !['tip_icon', 'suggested_amounts', 'min_amount', 'metadata'].includes(field));
  for (const name of ['create_product', 'update_product']) {
    it(`${name} exposes every persisted DTO field`, () => {
      expect(Object.keys(tools.get(name)!.schema)).toEqual(expect.arrayContaining([...fields, 'categories', 'tags', 'bundleItemIds']));
    });
    it(`${name} matches DTO bounds and nullable fields`, () => {
      const shape = tools.get(name)!.schema;
      const valid = { long_description: null, image_url: null, trial_days: 0, auto_grant_duration_days: null, available_from: '', features: [{ title: 'Included', items: ['Video'] }], name: 'x'.repeat(200), slug: 'COURSE' };
      for (const [field, value] of Object.entries(valid)) expect(shape[field]?.safeParse(value).success, field).toBe(true);
      const invalid = { long_description: 'x'.repeat(20001), image_url: 'x'.repeat(2049), trial_days: -1, billing_interval_count: 0, auto_grant_duration_days: 1.5, available_from: 'tomorrow', categories: ['not-a-uuid'], tags: ['not-a-uuid'], custom_price_presets: Array(21).fill(1), success_redirect_url: 'ftp://example.com', slug: 'with space' };
      for (const [field, value] of Object.entries(invalid)) expect(shape[field]?.safeParse(value).success, field).toBe(false);
    });
  }
  it('forwards product content and subscription fields without converting prices', async () => {
    api.post.mockResolvedValue({ data: {} });
    const input = { name: 'Course', slug: 'course', price: 149, long_description: 'Lessons', image_url: '/cover.png', product_type: 'subscription', recurring_price: 49.99, billing_interval: 'month', trial_days: 7 };
    const parsed = z.object(tools.get('create_product')!.schema).parse(input);
    await tools.get('create_product')!.handler(parsed);
    expect(api.post).toHaveBeenCalledWith('/api/v1/products', expect.objectContaining(input));
  });
});

describe('analytics contracts', () => {
  it('identifies the product payment sample and keeps currencies separate', async () => {
    api.get.mockResolvedValueOnce({ data: { id: 'p', price: 149, currency: 'PLN' } }).mockResolvedValueOnce({ data: [{ status: 'completed', amount: 14900, currency: 'PLN' }, { status: 'completed', amount: 4999, currency: 'USD' }], pagination: { has_more: true, next_cursor: 'next' } });
    const tool = tools.get('get_product_stats')!;
    const result = JSON.parse((await tool.handler({ product_id: 'p' })).content[0].text);
    expect(tool.description).toContain('sample');
    expect(result.sample).toEqual({ limit: 100, returned: 2, has_more: true, next_cursor: 'next' });
    expect(result.sales.by_currency).toEqual({ PLN: 14900, USD: 4999 });
  });
  it('names access share without presenting it as purchase conversion', async () => {
    api.get.mockResolvedValue({ data: { users: { total: 8, with_access: 2 }, products: { total: 4, active: 1 } } });
    const tool = tools.get('get_conversion_stats')!;
    expect(tool.description).toContain('not visit-to-purchase conversion');
    expect(tool.description).toContain('free');
    const result = JSON.parse((await tool.handler({})).content[0].text);
    expect(result.users_with_access_percent).toBe(25);
    expect(result).not.toHaveProperty('conversion_rate');
  });
  it('describes compare_periods as current windows, with top-50 coverage', () => {
    const tool = tools.get('compare_periods')!;
    expect(tool.description).toContain('both ending now');
    expect(tool.description).toContain('top 50');
    expect(tool.description).toContain('not the previous week or month');
    expect(tool.schema.previous_period.description).toContain('ending now');
  });
  it('handles windows with no sales', async () => {
    api.get.mockResolvedValue({ data: { products: [], filters: { period: 'week' } } });
    const result = JSON.parse((await tools.get('compare_periods')!.handler({ current_period: 'week', previous_period: 'month' })).content[0].text);
    expect(result.current_period.revenue).toBe(0);
    expect(result.previous_period.sales).toBe(0);
  });
  it('prompts use observed metrics and do not request forecasts or conversion funnels', () => {
    const texts: string[] = [];
    const server = { prompt: (_name: string, _description: string, ...args: unknown[]) => {
      const handler = args.at(-1) as (args: Record<string, string>) => { messages: Array<{ content: { text: string } }> };
      texts.push(handler({ product_id: 'p' }).messages[0].content.text);
    } } as unknown as McpServer;
    registerPrompts(server);
    expect(texts.join('\n')).not.toMatch(/create a revenue forecast|Projected Revenue|Conversion Funnel Analysis|current month vs previous month/i);
    expect(texts.join('\n')).toContain('sample');
  });
});

describe('refund and scope guidance', () => {
  it('requires explicit human confirmation and the refund scope', () => {
    expect(tools.get('process_refund')!.description).toContain('explicit human confirmation');
    expect(tools.get('process_refund')!.description).toContain('payments:refund');
  });
  it('recommends separate minimal scopes for each use case', () => {
    const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
    expect(readme).not.toContain('Create a new API key with `*`');
    expect(readme).toContain('Read-only reporting');
    expect(readme).toContain('Product editing');
    expect(readme).toContain('`payments:refund`');
  });
});
