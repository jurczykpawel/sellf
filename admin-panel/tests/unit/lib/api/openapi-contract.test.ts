/**
 * API v1 contract gate (runs in CI, `bun run test:api-contract`).
 *
 * Fails when a route under src/app/api/v1 has no entry in the operation registry (or
 * the reverse), when the generated document is not valid OpenAPI 3.1, when an
 * operationId repeats, or when the documented scope / query parameters disagree with
 * what the route source actually checks and reads.
 *
 * @see src/lib/api/openapi/operations.ts
 * @see ./route-inventory.ts (static detection rules)
 */
import { describe, expect, it } from 'vitest';
import { Validator } from '@seriousme/openapi-schema-validator';
import { API_OPERATIONS, API_TAGS, FULL_SCHEMA_TAGS } from '@/lib/api/openapi/operations';
import { buildOpenApiSpec } from '@/lib/api/openapi/spec';
import { API_SCOPES } from '@/lib/api/scope-constants';
import { templateOperationScope, type TemplateHttpOperation } from '@/lib/storefront-templates/http';
import { inventoryRoutes } from './route-inventory';

const key = (method: string, path: string) => `${method} ${path}`;
const routes = inventoryRoutes();
const registry = new Map(API_OPERATIONS.map((op) => [key(op.method, op.path), op]));

describe('API v1 operation registry ↔ route tree', () => {
  it('found the route tree', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('every route handler has a registry entry', () => {
    const missing = routes.map((r) => key(r.method, r.path)).filter((k) => !registry.has(k));
    expect(missing, 'add these to src/lib/api/openapi/operations.ts').toEqual([]);
  });

  it('every registry entry has a route handler', () => {
    const present = new Set(routes.map((r) => key(r.method, r.path)));
    const stale = API_OPERATIONS.map((op) => key(op.method, op.path)).filter((k) => !present.has(k));
    expect(stale, 'registry entries without a route').toEqual([]);
  });

  it('registers each method+path once', () => {
    expect(registry.size).toBe(API_OPERATIONS.length);
  });

  it('documents the scope the route checks', () => {
    const scopeName = (scope: string) => Object.entries(API_SCOPES).find(([, v]) => v === scope)?.[0];
    const mismatches = routes.flatMap((route) => {
      const op = registry.get(key(route.method, route.path));
      if (!op) return [];
      let actual: string;
      if (route.session) actual = 'session';
      else if (route.templateOperation) actual = scopeName(templateOperationScope(route.templateOperation as TemplateHttpOperation)) ?? '?';
      else if (route.scopes.length === 1) actual = route.scopes[0];
      else if (route.scopes.length === 0) actual = 'public';
      else actual = `ambiguous:${route.scopes.join('+')}`;
      const documented = op.auth ?? (op.scope ? scopeName(op.scope) : undefined) ?? 'none';
      return actual === documented ? [] : [`${key(route.method, route.path)}: route=${actual} registry=${documented}`];
    });
    expect(mismatches).toEqual([]);
  });

  it('can follow every handler, scope check and query read (an unrecognised flow needs an explicit entry)', () => {
    const unproven = routes.flatMap((route) => {
      const op = registry.get(key(route.method, route.path));
      // `queryFromRoute`: the registry query object is the zod schema the route itself parses.
      const reasons = route.unresolved.filter((reason) => !(op?.queryFromRoute && reason.startsWith('query:')));
      return reasons.map((reason) => `${key(route.method, route.path)}: ${reason}`);
    });
    expect(unproven).toEqual([]);
  });

  it('documents exactly the query parameters the route reads', () => {
    const mismatches = routes.flatMap((route) => {
      const op = registry.get(key(route.method, route.path));
      if (!op || op.queryFromRoute) return [];
      const documented = Object.keys(op.query?.shape ?? {}).sort();
      const read = [...route.query].sort();
      return JSON.stringify(documented) === JSON.stringify(read) ? [] : [`${key(route.method, route.path)}: route=${read} registry=${documented}`];
    });
    expect(mismatches).toEqual([]);
  });
});

describe('generated OpenAPI document', () => {
  const spec = buildOpenApiSpec();
  const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item as Record<string, Record<string, unknown>>).map(([method, op]) => ({ path, method, op })));

  it('is valid OpenAPI 3.1', async () => {
    const validator = new Validator();
    const result = await validator.validate(spec as unknown as object);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
    expect(validator.version).toBe('3.1');
  });

  it('contains every registry operation', () => {
    expect(operations.length).toBe(API_OPERATIONS.length);
  });

  it('has unique, tool-safe operationIds', () => {
    const ids = operations.map(({ op }) => op.operationId as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
  });

  it('marks every API-key operation with x-required-scope and BearerAuth', () => {
    for (const { path, method, op } of operations) {
      const reg = registry.get(key(method.toUpperCase(), path))!;
      if (reg.auth) {
        expect(op['x-required-scope'], `${method} ${path}`).toBeUndefined();
        expect((op['x-mcp'] as { exclude?: boolean } | undefined)?.exclude, `${method} ${path} must be hidden from MCP`).toBe(true);
      } else {
        expect(op['x-required-scope'], `${method} ${path}`).toBe(reg.scope);
        expect(op.security).toEqual([{ BearerAuth: [] }]);
      }
    }
  });

  it('gives every operation a summary and a declared tag', () => {
    const declared = new Set((spec.tags as Array<{ name: string }>).map((t) => t.name));
    for (const { op } of operations) {
      expect(String(op.summary).length).toBeGreaterThan(5);
      for (const tag of op.tags as string[]) expect(declared.has(tag)).toBe(true);
    }
    expect([...declared].sort()).toEqual(Object.keys(API_TAGS).sort());
  });

  it('declares every path parameter', () => {
    for (const { path, op } of operations) {
      const names = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const declared = ((op.parameters ?? []) as Array<{ in: string; name: string }>).filter((p) => p.in === 'path').map((p) => p.name).sort();
      expect(declared, path).toEqual(names);
    }
  });

  it('carries full zod schemas for products, offers and templates', () => {
    for (const reg of API_OPERATIONS.filter((op) => FULL_SCHEMA_TAGS.includes(op.tag))) {
      const write = ['POST', 'PUT', 'PATCH'].includes(reg.method);
      if (write && !reg.noBody) expect(reg.body, `${reg.operationId} body`).toBeDefined();
      if (reg.envelope !== 'empty') expect(reg.response, `${reg.operationId} response`).toBeDefined();
    }
  });

  it('builds product bodies from the route validators (no hand-written copy)', () => {
    const create = operations.find(({ op }) => op.operationId === 'create_product')!.op;
    const ref = (create.requestBody as { content: Record<string, { schema: { $ref: string } }> }).content['application/json'].schema.$ref;
    const schema = (spec.components.schemas as Record<string, { properties?: Record<string, unknown>; required?: string[] }>)[ref.split('/').pop()!];
    expect(Object.keys(schema.properties ?? {})).toEqual(expect.arrayContaining(['name', 'slug', 'price', 'checkout_profile', 'categories', 'bundleItemIds']));
    expect(schema.required).toEqual(expect.arrayContaining(['name', 'slug', 'price']));
  });

  it('exposes no secrets', () => {
    const text = JSON.stringify(spec);
    expect(text).not.toMatch(/sk_(live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|sf_live_[A-Za-z0-9]{8}/);
  });
});
