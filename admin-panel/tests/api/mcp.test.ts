/**
 * API integration: POST /api/mcp with the official MCP SDK client against the running app.
 * initialize → tools/list → tools/call on a real endpoint with a key limited to products:read;
 * no key / a valid admin session alone → 401; an operation outside the scope is invisible and refused.
 * Run: bun run test:api (requires dev server + supabase running)
 * @see src/app/api/mcp/route.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { API_URL } from './setup';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const stamp = randomBytes(4).toString('hex');
const limitedKey = `sf_test_${randomBytes(32).toString('hex')}`;
let keyId = '';
let productId = '';

async function sessionCookie(): Promise<string> {
  const email = (await supabase.auth.admin.getUserById(process.env.TEST_AUTH_USER_ID!)).data.user!.email!;
  const { data } = await createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').auth.signInWithPassword({ email, password: 'TestPassword123!' });
  if (!data.session) throw new Error('admin login failed');
  return `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`;
}

async function connect(query = ''): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${API_URL}/api/mcp${query}`), {
    requestInit: { headers: { authorization: `Bearer ${limitedKey}` } },
  });
  const client = new Client({ name: 'sellf-mcp-integration', version: '1.0.0' });
  await client.connect(transport);
  return client;
}
const text = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as Array<{ text: string }>)[0].text;
const listRpc = (headers: Record<string, string>) => fetch(`${API_URL}/api/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});

beforeAll(async () => {
  const { data: admin } = await supabase.from('admin_users').select('id').eq('user_id', process.env.TEST_AUTH_USER_ID!).single();
  const key = await supabase.from('api_keys').insert({
    name: `mcp-limited-${stamp}`, key_prefix: limitedKey.substring(0, 12), key_hash: createHash('sha256').update(limitedKey).digest('hex'),
    admin_user_id: admin!.id, scopes: ['products:read'], rate_limit_per_minute: 1000, is_active: true,
  }).select('id').single();
  if (key.error) throw key.error;
  keyId = key.data.id;
  const product = await supabase.from('products').insert({ name: `MCP ${stamp}`, slug: `mcp-${stamp}`, description: 'mcp test', price: 49, currency: 'PLN', is_active: false }).select('id').single();
  if (product.error) throw product.error;
  productId = product.data.id;
});

afterAll(async () => {
  if (productId) await supabase.from('products').delete().eq('id', productId);
  if (keyId) await supabase.from('api_keys').delete().eq('id', keyId);
});

describe('POST /api/mcp (real app)', () => {
  it('401 without a key, with a wrong key, and with a valid admin session that /api/v1 itself accepts @J700', async () => {
    const cookie = await sessionCookie();
    expect((await fetch(`${API_URL}/api/v1/products?limit=1`, { headers: { cookie } })).status).toBe(200);
    for (const headers of [{}, { authorization: 'Bearer sf_test_nope' }, { cookie }]) {
      const res = await listRpc(headers);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/);
    }
  });

  it('initialize → tools/list shows exactly the products:read operations → tools/call reads the real product @J700', async () => {
    const client = await connect();
    expect(client.getServerVersion()?.name).toBe('Sellf');
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_products', 'get_product', 'list_tags']));
    expect(names).not.toContain('create_product');
    expect(names).not.toContain('list_payments');

    const result = await client.callTool({ name: 'get_product', arguments: { id: productId } });
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result)).data).toMatchObject({ id: productId, slug: `mcp-${stamp}`, price: 49 });

    const refused = await client.callTool({ name: 'update_product', arguments: { id: productId, body: { name: 'hijacked' } } });
    expect(refused.isError).toBe(true);
    const { data: row } = await supabase.from('products').select('name').eq('id', productId).single();
    expect(row!.name).toBe(`MCP ${stamp}`);
    await client.close();
  });

  it('compact mode searches within the scope and calls through the API (API errors come back as isError) @J700', async () => {
    const client = await connect('?mode=compact');
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['search_operations', 'call_operation']);
    const found = JSON.parse(text(await client.callTool({ name: 'search_operations', arguments: { query: 'product' } }))) as Array<{ operationId: string }>;
    expect(found.map((op) => op.operationId)).toContain('get_product');
    expect(found.map((op) => op.operationId)).not.toContain('create_product');
    const ok = await client.callTool({ name: 'call_operation', arguments: { operationId: 'list_products', params: { search: `MCP ${stamp}`, limit: 5 } } });
    expect(JSON.parse(text(ok)).data.map((p: { id: string }) => p.id)).toContain(productId);
    const missing = await client.callTool({ name: 'call_operation', arguments: { operationId: 'get_product', params: { id: '00000000-0000-4000-8000-000000000000' } } });
    expect(missing.isError).toBe(true);
    expect((await client.callTool({ name: 'call_operation', arguments: { operationId: 'create_product', params: { body: {} } } })).isError).toBe(true);
    await client.close();
  });
});
