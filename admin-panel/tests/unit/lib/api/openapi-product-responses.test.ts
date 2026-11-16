/**
 * Product responses conform to the published OpenAPI document (W221ar finding 1).
 *
 * The real route handlers run against a database stub returning a row exactly as SQL allows
 * it (every nullable column NULL, NOT NULL columns at their defaults); each response body is
 * validated with Ajv (JSON Schema 2020-12) against the spec schema for that operation and
 * status. A second test ties the read schema's nullability to supabase/schema.snapshot.sql.
 * Offers and templates are checked against a running app in tests/api/openapi-responses.test.ts.
 * @see src/lib/api/dto/product.ts (ProductResponseDTO)
 */
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOpenApiSpec } from '@/lib/api/openapi/spec';
import { ProductResponseDTO } from '@/lib/api/dto/product';
import { PRODUCT_API_FIELDS } from '@/lib/validations/product';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/api', async () => ({ ...await vi.importActual<typeof import('@/lib/api')>('@/lib/api'), authenticate: mocks.authenticate }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { POST, GET as LIST } from '@/app/api/v1/products/route';
import { PATCH, GET } from '@/app/api/v1/products/[id]/route';
import { POST as RESTORE } from '@/app/api/v1/products/[id]/restore/route';

const SNAPSHOT = path.resolve(__dirname, '../../../../../supabase/schema.snapshot.sql');
const id = '11111111-1111-4111-8111-111111111111';
const tagId = '22222222-2222-4222-8222-222222222222';
const spec = buildOpenApiSpec();
const ajv = new Ajv2020({ strict: false, allErrors: true });

/** Columns of public.products from the schema snapshot: name → nullable. */
function productColumns(): Map<string, boolean> {
  const sql = fs.readFileSync(SNAPSHOT, 'utf8');
  const table = sql.slice(sql.indexOf('CREATE TABLE public.products ('));
  const body = table.slice(0, table.indexOf('\n);'));
  const out = new Map<string, boolean>();
  for (const line of body.split('\n').slice(1)) {
    const m = /^\s{4}(\w+)\s/.exec(line);
    if (m && m[1] !== 'CONSTRAINT') out.set(m[1], !/\bNOT NULL\b/.test(line));
  }
  return out;
}
/** Top-level plain columns of the select list (embedded relations like `sessions:product_sessions(…)` skipped). */
function topLevelColumns(select: string): string[] {
  const out: string[] = [];
  let depth = 0, current = '';
  for (const ch of select + ',') {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(current.trim()); current = ''; } else current += ch;
  }
  return out.filter((field) => /^\w+$/.test(field));
}
const selectedColumns = topLevelColumns(PRODUCT_API_FIELDS);

/** A product row as SQL may return it: nullable columns NULL, the rest at their schema defaults. */
const sqlRow: Record<string, unknown> = {
  id, name: 'Minimal', slug: 'Minimal_Slug', price: 0, currency: 'USD', created_at: '2026-11-16T10:00:00.000Z', updated_at: '2026-11-16T10:00:00.000Z',
  event_mode: false, allow_repeat_purchase: false, is_active: true, is_featured: false, is_listed: true, is_bundle: false, is_refundable: false,
  enable_waitlist: false, allow_custom_price: false, show_price_presets: true, price_includes_vat: true, vat_exempt: false, omnibus_exempt: false,
  pass_params_to_redirect: false, lead_consent_required: false, embed_enabled: false, issue_license_on_purchase: false,
  layout_template: 'default', checkout_template: 'default', content_delivery_type: 'content', product_type: 'one_time',
  lead_consent_version: '1', lead_consent_text_pl: 'Zgoda', lead_consent_text_en: 'Consent',
  content_config: {}, preview_video_config: {}, custom_checkout_fields: [],
  marketing_fields: { format: null, sourceLocale: 'en', en: { result: null, tools: [], requirements: [] } },
  sessions: [],
};
for (const [column, nullable] of productColumns()) if (nullable && selectedColumns.includes(column)) sqlRow[column] = null;

let tagError: { message: string } | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  tagError = null;
  const from = vi.fn((table: string) => {
    let selected = '';
    const rows = () => Object.fromEntries(Object.entries(sqlRow).filter(([key]) => selected === '' || selected.includes(key)));
    const query: Record<string, unknown> = {};
    for (const name of ['eq', 'order', 'limit', 'is', 'not', 'in', 'or', 'ilike', 'gt', 'lt', 'range', 'insert', 'update', 'delete']) query[name] = vi.fn(() => query);
    query.select = vi.fn((fields?: string) => { selected = fields ?? ''; return query; });
    query.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    query.single = vi.fn(async () => ({ data: rows(), error: null }));
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(
      table === 'product_tags' ? { data: null, error: tagError } : { data: table === 'products' ? [rows()] : [], count: 1, error: null },
    ).then(resolve);
    return query;
  });
  mocks.rpc.mockImplementation(() => ({ ...(from('products') as object), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve) }));
  mocks.authenticate.mockResolvedValue({ supabase: { from, rpc: mocks.rpc }, admin: { userId: id } });
});

function expectConforms(pathKey: string, method: string, status: number, body: unknown): void {
  const op = (spec.paths[pathKey] as Record<string, { responses: Record<string, { content?: Record<string, { schema: object }> }> }>)[method];
  const schema = op.responses[String(status)]?.content?.['application/json']?.schema;
  expect(schema, `${method.toUpperCase()} ${pathKey} documents status ${status}`).toBeDefined();
  const validate = ajv.compile({ ...schema, components: spec.components });
  expect(validate(body), `${method.toUpperCase()} ${pathKey} ${status}: ${ajv.errorsText(validate.errors)}`).toBe(true);
}

const params = { params: Promise.resolve({ id }) };
const json = (method: string, url: string, body?: unknown) => new NextRequest(url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });

describe('product responses vs the published schema', () => {
  it('GET one, list, create, update and restore return bodies the spec accepts (SQL nulls included) @J701', async () => {
    const one = await GET(json('GET', `http://localhost/api/v1/products/${id}`), params);
    expect(one.status).toBe(200);
    const body = await one.json();
    expect(body.data.description).toBeNull();
    expectConforms('/products/{id}', 'get', 200, body);

    const list = await LIST(json('GET', 'http://localhost/api/v1/products'));
    expectConforms('/products', 'get', list.status, await list.json());

    const created = await POST(json('POST', 'http://localhost/api/v1/products', { name: 'Minimal', slug: 'minimal', price: 0 }));
    expectConforms('/products', 'post', created.status, await created.json());

    const updated = await PATCH(json('PATCH', `http://localhost/api/v1/products/${id}`, { name: 'Renamed' }), params);
    expect(updated.status).toBe(200);
    expectConforms('/products/{id}', 'patch', 200, await updated.json());

    const restored = await RESTORE(json('POST', `http://localhost/api/v1/products/${id}/restore`), params);
    expectConforms('/products/{id}/restore', 'post', restored.status, await restored.json());
  });

  it('PATCH with a failed relation write answers 207 with _warnings, as documented', async () => {
    tagError = { message: 'boom' };
    const res = await PATCH(json('PATCH', `http://localhost/api/v1/products/${id}`, { tags: [tagId] }), params);
    expect(res.status).toBe(207);
    const body = await res.json();
    expect(body.data._warnings).toEqual(['failed to clear existing tags']);
    expectConforms('/products/{id}', 'patch', 207, body);
  });

  it('the read schema matches SQL: every selected column present, nullable exactly where the column is', () => {
    const columns = productColumns();
    const shape = ProductResponseDTO.shape as Record<string, { safeParse(v: unknown): { success: boolean } }>;
    const mismatches = selectedColumns.flatMap((column) => {
      if (!columns.has(column)) return [`${column}: not a products column`];
      if (!shape[column]) return [`${column}: missing from ProductResponseDTO`];
      if (shape[column].safeParse(undefined).success) return [`${column}: optional, but always selected`];
      return shape[column].safeParse(null).success === columns.get(column) ? [] : [`${column}: nullable SQL=${columns.get(column)}`];
    });
    expect(mismatches).toEqual([]);
  });
});
