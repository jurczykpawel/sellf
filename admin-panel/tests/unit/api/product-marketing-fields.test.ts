/** Product API editorial metadata. @see spec/contracts/product-marketing-fields.md */
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapApiInputToProductRow } from '@/lib/api/dto/product';
import { storedJsonBytes } from '@/lib/storefront-templates/json';
import { marketingFieldsSchema, marketingFieldsShapeSchema, marketingProjectionSchema } from '@/lib/validations/product-marketing';
import { PRODUCT_API_FIELDS } from '@/lib/validations/product';
import { productCreateShape, productUpdateShape } from '../../../../mcp-server/src/tools/product-schema';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/api', async () => ({ ...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'), authenticate: mocks.authenticate }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { API_SCOPES, ApiAuthError } from '@/lib/api';
import { POST, GET as LIST } from '@/app/api/v1/products/route';
import { PATCH, GET } from '@/app/api/v1/products/[id]/route';

const id = '11111111-1111-4111-8111-111111111111';
const copy = { result: null, tools: [], requirements: [] };
const empty = { format: null, sourceLocale: 'en', en: copy };
const translated = { format: 'workshop', sourceLocale: 'pl', en: copy, pl: { result: 'Zbuduj raport', tools: ['n8n'], requirements: ['Podstawy arkuszy'] } };
const base = { name: 'Example', slug: 'example', price: 10 };
const params = { params: Promise.resolve({ id }) };
const request = (method: string, body?: unknown) => new NextRequest(`http://localhost/api/v1/products${method === 'POST' ? '' : `/${id}`}`, {
  method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
});

function boundary(bytes: number) {
  const long = { result: 'a'.repeat(240), tools: Array.from({ length: 12 }, (_, i) => `${i.toString(16)}${'a'.repeat(79)}`), requirements: Array.from({ length: 12 }, (_, i) => `${i.toString(16)}${'a'.repeat(219)}`) };
  const value = { format: 'course', sourceLocale: 'en', en: long, pl: structuredClone(long) };
  const gap = bytes - storedJsonBytes(value)!;
  value.pl.result = 'é'.repeat(gap) + 'a'.repeat(240 - gap);
  return value;
}
const invalid = [null, {}, { ...empty, extra: true }, { ...empty, en: { ...copy, extra: true } },
  { ...empty, sourceLocale: 'pl' }, { ...empty, format: 'subscription' }, { ...empty, en: { tools: [], requirements: [] } },
  ...['a'.repeat(241), '<b>Text</b>', 'https://example.com', '\uD800'].map(result => ({ ...empty, en: { ...copy, result } })),
  { ...empty, en: { ...copy, tools: ['Same', 'Same'] } },
  { ...empty, en: { ...copy, tools: ['a'.repeat(81)] } },
  { ...empty, en: { ...copy, requirements: ['a'.repeat(241)] } },
  { ...empty, en: { ...copy, tools: Array.from({ length: 13 }, (_, i) => String(i)) } },
  JSON.parse('{"format":null,"sourceLocale":"en","en":{"result":null,"tools":[],"requirements":[]},"__proto__":{}}'), boundary(8193)];

describe('marketing DTO and MCP parity', () => {
  for (const context of ['create', 'update'] as const) {
    it(`${context} preserves complete metadata and does not default omitted metadata`, () => {
      const input = context === 'create' ? base : {};
      expect(mapApiInputToProductRow({ ...input, marketing_fields: translated }, context).marketing_fields).toEqual(translated);
      expect(mapApiInputToProductRow(input, context)).not.toHaveProperty('marketing_fields');
    });
    it.each(invalid)(`${context} rejects invalid metadata %#`, marketing_fields => {
      expect(() => mapApiInputToProductRow({ ...base, marketing_fields }, context)).toThrow();
    });
  }
  it.each([empty, translated, boundary(8191), boundary(8192), { ...empty, en: { ...copy, result: '😀'.repeat(240), tools: ['A, B: C', 'Editor \"A\"'] } }, ...invalid])('matches the shared validator in MCP %#', value => {
    const expected = marketingFieldsSchema.safeParse(value).success;
    for (const shape of [productCreateShape, productUpdateShape]) {
      const schema = shape['marketing_fields' as keyof typeof shape];
      expect(schema, 'MCP marketing field').toBeDefined();
      expect(schema.safeParse(value).success).toBe(expected);
    }
  });
  it('keeps the standalone structural schema aligned with the shared contract', () => {
    expect(z.toJSONSchema(productCreateShape.marketing_fields.unwrap())).toEqual(z.toJSONSchema(marketingFieldsShapeSchema));
  });
  it('keeps public editorial reads bounded to declared fields', () => {
    expect(PRODUCT_API_FIELDS.split(', ')).toContain('marketing_fields');
    expect(marketingProjectionSchema.parse({ id, marketing_fields: translated, content_config: 'private', license_tier: 'private', customer: 'private' })).toEqual({ id, marketing_fields: translated });
  });
});

let row: Record<string, unknown>;
let writes: Record<string, unknown>[];
let from: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  row = { id, ...base, product_type: 'one_time', is_bundle: false, is_active: true, marketing_fields: translated };
  writes = [];
  from = vi.fn(() => {
    let selected = '';
    let slugCheck = false;
    const result = () => ({ data: Object.fromEntries(Object.entries(row).filter(([key]) => selected.split(/,\s*/).includes(key))), error: null });
    const query = {
      select: vi.fn((fields: string) => { selected = fields; return query; }),
      eq: vi.fn((field: string) => { slugCheck = field === 'slug'; return query; }),
      order: vi.fn(() => query), limit: vi.fn(() => query),
      insert: vi.fn((values: Record<string, unknown>[]) => { writes.push(values[0]); row = { ...row, ...values[0] }; return query; }),
      update: vi.fn((values: Record<string, unknown>) => { writes.push(values); row = { ...row, ...values }; return query; }),
      maybeSingle: vi.fn(async () => ({ data: slugCheck ? null : result().data, error: null })),
      single: vi.fn(async () => result()),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [result().data], count: 1, error: null }).then(resolve),
    };
    return query;
  });
  mocks.rpc.mockImplementation((_name: string, args: { product_data: Record<string, unknown> }) => {
    writes.push(args.product_data); row = { ...row, ...args.product_data };
    return from('products');
  });
  mocks.authenticate.mockResolvedValue({ supabase: { from, rpc: mocks.rpc }, admin: { userId: id } });
});

describe('product metadata routes', () => {
  it('creates, reads and lists metadata through the explicit API selection', async () => {
    const created = await POST(request('POST', { ...base, marketing_fields: translated }));
    expect(created.status).toBe(201);
    expect((await created.json()).data.marketing_fields).toEqual(translated);
    expect(writes[0].marketing_fields).toEqual(translated);
    expect(mocks.rpc).toHaveBeenCalledWith('mutate_product_with_audit', expect.objectContaining({ operation_param: 'INSERT', actor_id: id, product_data: expect.objectContaining({ marketing_fields: translated }) }));
    expect((await (await GET(request('GET'), params)).json()).data.marketing_fields).toEqual(translated);
    const listed = await LIST(new NextRequest('http://localhost/api/v1/products'));
    expect((await listed.json()).data[0].marketing_fields).toEqual(translated);
    expect(mocks.authenticate).toHaveBeenLastCalledWith(expect.anything(), [API_SCOPES.PRODUCTS_READ]);
  });
  it('replaces the complete object and retains it when omitted from a later PATCH', async () => {
    expect((await PATCH(request('PATCH', { marketing_fields: empty }), params)).status).toBe(200);
    expect(row.marketing_fields).toEqual(empty);
    expect(writes[0]).toEqual({ marketing_fields: empty });
    expect(mocks.rpc).toHaveBeenCalledWith('mutate_product_with_audit', { operation_param: 'UPDATE', actor_id: id, product_id: id, product_data: { marketing_fields: empty } });
    expect((await PATCH(request('PATCH', { description: 'Updated' }), params)).status).toBe(200);
    expect(row.marketing_fields).toEqual(empty);
    expect(writes[1]).not.toHaveProperty('marketing_fields');
    expect(mocks.authenticate).toHaveBeenLastCalledWith(expect.anything(), [API_SCOPES.PRODUCTS_WRITE]);
  });
  it.each(invalid)('rejects invalid metadata before writing %#', async marketing_fields => {
    expect((await POST(request('POST', { ...base, marketing_fields }))).status).toBe(400);
    expect((await PATCH(request('PATCH', { marketing_fields }), params)).status).toBe(400);
    expect(from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)('retains %s handling before product queries', async code => {
    mocks.authenticate.mockRejectedValue(new ApiAuthError(code, 'Denied'));
    const expected = code === 'UNAUTHORIZED' ? 401 : 403;
    expect((await POST(request('POST', { ...base, marketing_fields: empty }))).status).toBe(expected);
    expect((await PATCH(request('PATCH', { marketing_fields: empty }), params)).status).toBe(expected);
    expect((await GET(request('GET'), params)).status).toBe(expected);
    expect(from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
