/**
 * MCP tools derived from the OpenAPI document (W221b): one tool per API-key operation,
 * scope filtering identical to the API, compact search, $ref inlining, request building.
 * @see src/lib/mcp/operations.ts
 */
import { describe, expect, it } from 'vitest';
import { buildApiRequest, mcpOperations, scopeAllows, searchOperations, type OpenApiDocument } from '@/lib/mcp/operations';
import { buildOpenApiSpec } from '@/lib/api/openapi/spec';
import { API_OPERATIONS } from '@/lib/api/openapi/operations';
import { ALL_SCOPES } from '@/lib/api/scope-constants';

const bearer = [{ BearerAuth: [] }];
const sample: OpenApiDocument = {
  servers: [{ url: '/api/v1' }],
  components: {
    schemas: {
      Tag: { type: 'object', properties: { name: { type: 'string' }, parent: { $ref: '#/components/schemas/Tag' } } },
    },
  },
  paths: {
    '/tags': {
      get: { operationId: 'list_tags', 'x-required-scope': 'products:read', summary: 'List tags', tags: ['Catalog'], security: bearer, parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer' }, description: 'Page size' }] },
      post: { operationId: 'create_tag', 'x-required-scope': 'products:write', summary: 'Create a tag', description: 'Long text', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Tag' } } } } },
    },
    '/tags/{id}': {
      delete: { operationId: 'delete_tag', 'x-required-scope': 'products:write', summary: 'Delete a tag', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] },
      patch: { operationId: 'update_tag', 'x-required-scope': 'products:write', summary: 'Update a tag', security: bearer, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { required: true, description: 'Fields: name?, slug?', content: { 'application/json': { schema: { type: 'object' } } } } },
    },
    '/templates': { get: { operationId: 'get_template', 'x-required-scope': 'templates:read', summary: 'Read template', security: bearer } },
    '/api-keys': { get: { operationId: 'list_api_keys', summary: 'Keys', security: [{ SessionCookie: [] }] } },
    '/export': { post: { operationId: 'export_payments', 'x-required-scope': 'payments:read', security: bearer, 'x-mcp': { exclude: true } } },
    '/openapi.json': { get: { operationId: 'get_openapi_spec', security: [] } },
  },
};

describe('mcpOperations (sample spec)', () => {
  const ops = mcpOperations(sample);
  const byName = Object.fromEntries(ops.map((op) => [op.name, op]));

  it('keeps Bearer operations with a scope; drops excluded, session-only and public ones', () => {
    expect(ops.map((op) => op.name).sort()).toEqual(['create_tag', 'delete_tag', 'get_template', 'list_tags', 'update_tag']);
  });

  it('builds a self-contained inputSchema from path/query parameters and the JSON body', () => {
    expect(byName.list_tags.inputSchema).toEqual({ type: 'object', properties: { limit: { type: 'integer', description: 'Page size' } }, additionalProperties: false });
    expect(byName.delete_tag.inputSchema).toEqual({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false });
    const props = byName.create_tag.inputSchema.properties as Record<string, unknown>;
    expect(props.body).toEqual({ type: 'object', properties: { name: { type: 'string' }, parent: {} } }); // cycle cut
    expect(byName.create_tag.inputSchema.required).toEqual(['body']);
    expect(JSON.stringify(ops)).not.toContain('$ref');
  });

  it('carries a hand-validated body description into the body schema', () => {
    expect((byName.update_tag.inputSchema.properties as Record<string, unknown>).body).toEqual({ type: 'object', description: 'Fields: name?, slug?' });
  });

  it('maps summary/description, absolute path and annotations', () => {
    expect(byName.create_tag.description).toBe('Create a tag\n\nLong text');
    expect(byName.list_tags.path).toBe('/api/v1/tags');
    expect(byName.list_tags.annotations).toEqual({ title: 'List tags', readOnlyHint: true });
    expect(byName.delete_tag.annotations).toEqual({ title: 'Delete a tag', readOnlyHint: false, destructiveHint: true });
    expect(byName.create_tag.annotations.destructiveHint).toBeUndefined();
  });

  it('filters by scope exactly like the API (write implies read, except templates)', () => {
    const visible = (scopes: string[]) => ops.filter((op) => scopeAllows(scopes, op.scope)).map((op) => op.name).sort();
    expect(visible(['products:read'])).toEqual(['list_tags']);
    expect(visible(['products:write'])).toEqual(['create_tag', 'delete_tag', 'list_tags', 'update_tag']);
    expect(visible(['templates:write'])).toEqual([]);
    expect(visible([])).toEqual([]);
  });

  it('compact search matches every word against name, path, summary, description and tags', () => {
    expect(searchOperations(ops, 'tag create').map((op) => op.name)).toEqual(['create_tag']);
    expect(searchOperations(ops, 'CATALOG').map((op) => op.name)).toEqual(['list_tags']);
    expect(searchOperations(ops, '')).toHaveLength(ops.length);
    expect(searchOperations(ops, '', 2)).toHaveLength(2);
    expect(searchOperations(ops, 'nothing-like-this')).toEqual([]);
  });

  it('maps tool arguments onto the documented HTTP request', () => {
    expect(buildApiRequest(byName.delete_tag, { id: 'a/b' })).toEqual({ path: '/api/v1/tags/a%2Fb' });
    expect(buildApiRequest(byName.list_tags, { limit: 5, ignored: 1 })).toEqual({ path: '/api/v1/tags?limit=5' });
    expect(buildApiRequest(byName.list_tags, {})).toEqual({ path: '/api/v1/tags' });
    expect(buildApiRequest(byName.create_tag, { body: { name: 'x' } })).toEqual({ path: '/api/v1/tags', body: '{"name":"x"}' });
    expect(() => buildApiRequest(byName.delete_tag, {})).toThrow('Missing path parameter: id');
  });
});

describe('mcpOperations (real API v1 document)', () => {
  const ops = mcpOperations(buildOpenApiSpec() as unknown as OpenApiDocument);

  it('exposes every API-key operation not marked x-mcp.exclude, and nothing else', () => {
    const expected = API_OPERATIONS.filter((op) => !op.auth && !op.mcpExclude).map((op) => op.operationId).sort();
    expect(ops.map((op) => op.name).sort()).toEqual(expected);
    expect(ops.map((op) => op.name)).not.toContain('list_api_keys');
    expect(ops.map((op) => op.name)).not.toContain('export_payments');
  });

  it('gives each tool a unique valid name, a known scope, required path params and no $ref', () => {
    expect(new Set(ops.map((op) => op.name)).size).toBe(ops.length);
    for (const op of ops) {
      expect(op.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(ALL_SCOPES).toContain(op.scope);
      for (const [, name] of op.path.matchAll(/\{(\w+)\}/g)) expect(op.inputSchema.required).toContain(name);
    }
    expect(JSON.stringify(ops.map((op) => op.inputSchema))).not.toContain('$ref');
  });

  it('a full-scope key sees all of them; a products:read key only product/catalog reads', () => {
    expect(ops.filter((op) => scopeAllows([...ALL_SCOPES], op.scope))).toHaveLength(ops.length);
    const reads = ops.filter((op) => scopeAllows(['products:read'], op.scope));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((op) => op.scope === 'products:read' && op.method === 'GET')).toBe(true);
    expect(reads.map((op) => op.name)).toContain('list_products');
  });
});
