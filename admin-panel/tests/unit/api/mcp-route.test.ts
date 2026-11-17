/**
 * POST /api/mcp: auth boundary, scope-filtered tool list, compact mode and the internal call
 * contract (caller's Authorization forwarded to this instance's /api/v1, cookies never).
 * API-key verification and the API itself are stubbed here; tests/api/mcp.test.ts drives the real app.
 * @see src/app/api/mcp/route.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const auth = vi.hoisted(() => ({ scopes: ['products:read'] as string[], fail: null as null | 'UNAUTHORIZED' | 'RATE_LIMITED' }));
vi.mock('@/lib/api/middleware', async () => {
  const { ApiAuthError } = await import('@/lib/api/errors');
  return {
    ApiAuthError,
    authenticateApiKeyPrincipal: vi.fn(async () => {
      if (auth.fail) throw new ApiAuthError(auth.fail, auth.fail);
      return { method: 'api_key', scopes: auth.scopes };
    }),
  };
});

import { DELETE, GET, OPTIONS, POST } from '@/app/api/mcp/route';

const realFetch = globalThis.fetch;
const apiCalls: Array<{ url: string; method: string; headers: Headers; body?: string }> = [];

beforeEach(() => {
  auth.scopes = ['products:read'];
  auth.fail = null;
  apiCalls.length = 0;
  process.env.PORT = '3999';
  delete process.env.SELLF_INTERNAL_URL;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    apiCalls.push({ url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body as string | undefined });
    return Response.json({ data: { id: 'p1' } }, { status: String(input).includes('missing') ? 404 : 200 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

async function connect(query = ''): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`http://shop.example/api/mcp${query}`), {
    requestInit: { headers: { authorization: 'Bearer sf_test_key', cookie: 'sb-127-auth-token=session' } },
    fetch: async (url, init) => POST(new NextRequest(String(url), init as ConstructorParameters<typeof NextRequest>[1])),
  });
  const client = new Client({ name: 'mcp-route-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}
const rpc = (headers: Record<string, string>) => POST(new NextRequest('http://shop.example/api/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
}));
const text = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as Array<{ text: string }>)[0].text;

describe('POST /api/mcp', () => {
  it('401 without a Bearer key (a session cookie alone is not accepted), 401 for a rejected key, 429 when rate limited', async () => {
    for (const headers of [{}, { cookie: 'sb-127-auth-token=session' }, { authorization: 'Basic abc' }]) {
      const res = await rpc(headers);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/);
    }
    auth.fail = 'UNAUTHORIZED';
    expect((await rpc({ authorization: 'Bearer sf_test_bad' })).status).toBe(401);
    auth.fail = 'RATE_LIMITED';
    expect((await rpc({ authorization: 'Bearer sf_test_key' })).status).toBe(429);
  });

  it('is stateless: GET and DELETE answer 405; OPTIONS allows Authorization from any origin', async () => {
    expect(GET().status).toBe(405);
    expect(DELETE().status).toBe(405);
    expect(OPTIONS().headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('lists only operations the key scope allows and calls the API with the caller key, never the cookie', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('list_products');
    expect(names).not.toContain('create_product');
    expect(names).not.toContain('list_coupons');

    const result = await client.callTool({ name: 'get_product', arguments: { id: 'p 1' } });
    expect(result.isError).toBe(false);
    expect(JSON.parse(text(result))).toEqual({ data: { id: 'p1' } });
    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0].url).toBe('http://127.0.0.1:3999/api/v1/products/p%201');
    expect(apiCalls[0].headers.get('authorization')).toBe('Bearer sf_test_key');
    expect(apiCalls[0].headers.get('cookie')).toBeNull();

    const refused = await client.callTool({ name: 'create_product', arguments: { body: { name: 'x' } } });
    expect(refused.isError).toBe(true);
    expect(apiCalls).toHaveLength(1);
    await client.close();
  });

  it('turns an API error status into isError and honours SELLF_INTERNAL_URL', async () => {
    process.env.SELLF_INTERNAL_URL = 'http://sellf-internal:8080/';
    const client = await connect();
    const result = await client.callTool({ name: 'get_product', arguments: { id: 'missing' } });
    expect(result.isError).toBe(true);
    expect(apiCalls[0].url).toBe('http://sellf-internal:8080/api/v1/products/missing');
    await client.close();
  });

  it('compact mode: two tools, search within the key scope, call_operation through the same API path', async () => {
    auth.scopes = ['products:write'];
    const client = await connect('?mode=compact');
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['search_operations', 'call_operation']);
    const found = JSON.parse(text(await client.callTool({ name: 'search_operations', arguments: { query: 'create product' } })));
    expect(found.map((op: { operationId: string }) => op.operationId)).toContain('create_product');
    expect(found[0].inputSchema.properties.body).toBeDefined();
    // Coupon operations are outside the key scope; product operations may still mention coupons.
    const couponOps = JSON.parse(text(await client.callTool({ name: 'search_operations', arguments: { query: 'coupon' } }))) as { operationId: string }[];
    expect(couponOps.map(op => op.operationId).filter(id => id.includes('coupon'))).toEqual([]);

    const created = await client.callTool({ name: 'call_operation', arguments: { operationId: 'create_product', params: { body: { name: 'x' } } } });
    expect(created.isError).toBe(false);
    expect(apiCalls[0]).toMatchObject({ url: 'http://127.0.0.1:3999/api/v1/products', method: 'POST', body: '{"name":"x"}' });
    expect(apiCalls[0].headers.get('content-type')).toBe('application/json');
    expect((await client.callTool({ name: 'call_operation', arguments: { operationId: 'list_coupons' } })).isError).toBe(true);
    expect((await client.callTool({ name: 'call_operation', arguments: { operationId: 'get_product' } })).isError).toBe(true); // missing id
    expect(apiCalls).toHaveLength(1);
    await client.close();
  });
});
