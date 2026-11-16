/**
 * API integration: real responses of products, product offers and the storefront template
 * conform to the published OpenAPI document (W221ar finding 1). Each body is validated with Ajv
 * (JSON Schema 2020-12) against the schema the spec documents for that operation and status.
 * Storefront: read-only calls (the instance template is shared); offers: a full draft lifecycle
 * on a product created for this test.
 * Run: bun run test:api (requires dev server + supabase running)
 * @see src/lib/api/openapi/operations.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { afterAll, describe, expect, it } from 'vitest';
import { apiRequest, cleanup } from './setup';

type Spec = { paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: object }> }> }>>; components: object };
const ajv = new Ajv2020({ strict: false, allErrors: true });
const example = (name: string) => JSON.parse(readFileSync(path.resolve(__dirname, '../../../skills/sellf-template-author/examples', name), 'utf8'));
const created: string[] = [];
let spec: Spec;

afterAll(async () => { await cleanup({ products: created }); });

/** Call the API and check the body against the spec entry for `METHOD /path` at the returned status. */
async function call(method: string, specPath: string, url: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  spec ??= (await apiRequest<Spec>('/api/v1/openapi.json')).data;
  const res = await apiRequest<Record<string, unknown>>(`/api/v1${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const responses = spec.paths[specPath][method.toLowerCase()].responses;
  const schema = (responses[String(res.status)] ?? responses.default).content?.['application/json']?.schema;
  expect(schema, `${method} ${specPath} ${res.status} has a documented JSON body`).toBeDefined();
  const validate = ajv.compile({ ...schema, components: spec.components });
  expect(validate(res.data), `${method} ${specPath} ${res.status}: ${ajv.errorsText(validate.errors)}`).toBe(true);
  return res;
}

describe('responses conform to /api/v1/openapi.json @J701', () => {
  it('products: create, read (SQL nulls), list, update', async () => {
    const product = await call('POST', '/products', '/products', { name: 'Spec probe', slug: `spec-probe-${Date.now()}`, price: 0, currency: 'PLN' });
    expect(product.status).toBe(201);
    const id = (product.data.data as { id: string }).id;
    created.push(id);
    expect((await call('GET', '/products/{id}', `/products/${id}`)).status).toBe(200);
    expect((await call('GET', '/products', '/products?limit=5')).status).toBe(200);
    expect((await call('PATCH', '/products/{id}', `/products/${id}`, { description: 'Updated', long_description: null })).status).toBe(200);
  });

  it('product offer: read, draft, validate, diff, history, preview', async () => {
    const product = await call('POST', '/products', '/products', { name: 'Offer spec probe', slug: `offer-spec-${Date.now()}`, price: 149, currency: 'PLN', is_active: true });
    const id = (product.data.data as { id: string }).id;
    created.push(id);
    const base = `/products/${id}/offer`;
    const read = await call('GET', '/products/{id}/offer/config', `${base}/config`);
    expect(read.status).toBe(200);
    const offer = example('offer.json');
    const draft = await call('PUT', '/products/{id}/offer/draft', `${base}/draft`, { expectedRevision: read.data.revision, config: offer });
    expect(draft.status).toBe(200);
    expect((await call('POST', '/products/{id}/offer/validate', `${base}/validate`, { config: offer, mode: 'publish' })).status).toBe(200);
    expect((await call('POST', '/products/{id}/offer/diff', `${base}/diff`, { fromRevision: 0, toRevision: 1 })).status).toBe(200);
    expect((await call('POST', '/products/{id}/offer/history', `${base}/history`, { limit: 10 })).status).toBe(200);
    expect((await call('POST', '/products/{id}/offer/preview', `${base}/preview`, { revision: 1, locale: 'en', fixture: 'published-products' })).status).toBe(200);
    expect((await call('PUT', '/products/{id}/offer/draft', `${base}/draft`, { expectedRevision: 0, config: offer })).status).toBe(409);
  });

  it('storefront template: capabilities, config, validate, licenses (read-only)', async () => {
    expect((await call('GET', '/templates/capabilities', '/templates/capabilities')).status).toBe(200);
    expect((await call('GET', '/templates/config', '/templates/config')).status).toBe(200);
    expect((await call('POST', '/templates/validate', '/templates/validate', { config: example('default.json'), mode: 'draft' })).status).toBe(200);
    expect((await call('GET', '/templates/licenses', '/templates/licenses')).status).toBe(200);
  });
});
