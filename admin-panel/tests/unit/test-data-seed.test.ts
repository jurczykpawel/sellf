/** Dataset seed contract. @see ../../scripts/test-data/README.md */
import { describe, expect, it } from 'vitest';
import { mapApiInputToProductRow } from '@/lib/api/dto/product';
import { validateUpdateProduct } from '@/lib/validations/product';
import { seedTestEnv } from '../../scripts/test-data/seed-test-env';
function mockApi() {
  const tables: Record<string, Record<string, unknown>[]> = { products: [], coupons: [], 'order-bumps': [] };
  const writes: Record<string, unknown>[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const [table, id] = new URL(String(input)).pathname.split('/').slice(3);
    const rows = tables[table];
    if (!init?.method || init.method === 'GET') return Response.json({ data: rows });
    const body = JSON.parse(String(init.body));
    if (table === 'products' && id && !validateUpdateProduct(mapApiInputToProductRow(body, 'update')).isValid) return Response.json({}, { status: 400 });
    expect(body).not.toHaveProperty('current_usage_count');
    writes.push(body);
    const row = id ? rows.find(r => r.id === id)! : { id: String(writes.length) };
    Object.assign(row, body);
    if (!id) rows.push(row);
    return Response.json({ data: row });
  };
  return { tables, writes, fetcher: fetcher as typeof fetch };
}
const options = { url: 'http://localhost:3779', key: 'test-key', confirmedTest: true };
describe('test dataset seed', () => {
  it('creates once, then leaves all rows unchanged and retains coupon counts', async () => {
    const api = mockApi();
    const first = await seedTestEnv({ ...options, fetcher: api.fetcher });
    expect(first.every(r => r.action === 'utworzone')).toBe(true);
    expect(first).toHaveLength(13);
    api.tables.coupons.forEach(row => { row.current_usage_count = 7; });
    const count = api.writes.length;
    const second = await seedTestEnv({ ...options, fetcher: api.fetcher });
    expect(second.every(r => r.action === 'bez zmian')).toBe(true);
    expect(api.writes).toHaveLength(count);
    api.tables.coupons[0].discount_value = 1;
    expect((await seedTestEnv({ ...options, fetcher: api.fetcher })).filter(r => r.action === 'zaktualizowane')).toHaveLength(1);
    expect(api.tables.coupons.every(row => row.current_usage_count === 7)).toBe(true);
  });
  it.each(['sellf.techskills.academy', 'demo.sellf.app', 'sub.demo.sellf.app', 'DEMO.SELLF.APP.'])('refuses %s before requests', async host => {
    let calls = 0;
    await expect(seedTestEnv({ ...options, url: `https://${host}`, fetcher: (async () => { calls++; }) as unknown as typeof fetch })).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it('requires explicit test confirmation', async () => {
    await expect(seedTestEnv({ ...options, confirmedTest: false })).rejects.toThrow('--i-know-this-is-test');
  });
  it('dry run plans dependent bump without writing', async () => {
    const api = mockApi();
    const result = await seedTestEnv({ ...options, dryRun: true, fetcher: api.fetcher });
    expect(result).toHaveLength(13);
    expect(result.every(r => r.action === 'utworzone')).toBe(true);
    expect(api.writes).toHaveLength(0);
  });
  it('reads subsequent pages before matching existing rows', async () => {
    const api = mockApi();
    await seedTestEnv({ ...options, fetcher: api.fetcher });
    const writes = api.writes.length;
    let pages = 0;
    const fetcher = (async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === 'GET' && !url.searchParams.has('cursor')) {
        pages++;
        return Response.json({ data: [], pagination: { has_more: true, next_cursor: 'second' } });
      }
      return api.fetcher(input, init);
    }) as typeof fetch;
    const rows = await seedTestEnv({ ...options, fetcher });
    expect(pages).toBe(3);
    expect(rows.every(row => row.action === 'bez zmian')).toBe(true);
    expect(api.writes).toHaveLength(writes);
  });
  it('dry run reports an existing change without applying it', async () => {
    const api = mockApi();
    await seedTestEnv({ ...options, fetcher: api.fetcher });
    api.tables.products[0].price = 1;
    const writes = api.writes.length;
    const rows = await seedTestEnv({ ...options, dryRun: true, fetcher: api.fetcher });
    expect(rows.filter(row => row.action === 'zaktualizowane')).toHaveLength(1);
    expect(api.tables.products[0].price).toBe(1);
    expect(api.writes).toHaveLength(writes);
  });
  it('stops on an API read error without writing', async () => {
    const api = mockApi();
    const fetcher = (async (input, init) => String(input).includes('/coupons')
      ? Response.json({}, { status: 403 }) : api.fetcher(input, init)) as typeof fetch;
    await expect(seedTestEnv({ ...options, fetcher })).rejects.toThrow('HTTP 403');
    expect(api.writes).toHaveLength(0);
  });

  it('restores subscription fields with a complete recurring configuration', async () => {
    const api = mockApi();
    await seedTestEnv({ ...options, fetcher: api.fetcher });
    const subscription = api.tables.products.find(row => row.product_type === 'subscription')!;
    subscription.recurring_price = 48;
    const rows = await seedTestEnv({ ...options, fetcher: api.fetcher });
    expect(rows.filter(row => row.action === 'zaktualizowane')).toHaveLength(1);
    expect(subscription.recurring_price).toBe(49);
  });

});
