/**
 * MCP as a thin layer over the OpenAPI document of API v1: every tool is derived from the
 * spec this version serves. No hand-written tools, no copied schemas, no business logic.
 *
 * Curation lives in the spec (built from the operation registry): `x-required-scope`
 * (visibility per API key), BearerAuth security (session-only and public operations drop out)
 * and `x-mcp.exclude`.
 *
 * @see src/lib/api/openapi/spec.ts
 * @see src/app/api/mcp/route.ts
 */
import { hasScope } from '@/lib/api/api-keys';
import type { ApiScope } from '@/lib/api/scope-constants';

type Json = Record<string, unknown>;

interface SpecParameter { name: string; in: string; required?: boolean; description?: string; schema?: Json }
interface SpecOperation {
  operationId?: string; summary?: string; description?: string; tags?: string[];
  parameters?: SpecParameter[]; security?: Array<Record<string, unknown>>;
  requestBody?: { required?: boolean; description?: string; content?: Record<string, { schema?: Json }> };
  'x-required-scope'?: string;
  'x-mcp'?: { exclude?: boolean };
}
export interface OpenApiDocument { servers?: Array<{ url: string }>; components?: Json; paths: Record<string, Record<string, unknown>> }

export interface McpOperation {
  name: string;
  method: string;
  /** Absolute app path template, e.g. `/api/v1/products/{id}`. */
  path: string;
  scope: string;
  summary: string;
  description: string;
  tags: string[];
  params: Array<{ name: string; in: 'path' | 'query' }>;
  hasBody: boolean;
  inputSchema: Json & { type: 'object' };
  annotations: { title: string; readOnlyHint: boolean; destructiveHint?: boolean };
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Inline local `$ref`s so each tool's inputSchema is self-contained; a cycle becomes an open schema. */
function resolveRefs(node: unknown, spec: OpenApiDocument, seen: string[] = []): unknown {
  if (Array.isArray(node)) return node.map((item) => resolveRefs(item, spec, seen));
  if (!node || typeof node !== 'object') return node;
  const ref = (node as Json).$ref;
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    if (seen.includes(ref)) return {};
    const target = ref.slice(2).split('/').reduce<unknown>((acc, key) => (acc as Json | undefined)?.[key], spec);
    return resolveRefs(target ?? {}, spec, [...seen, ref]);
  }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, resolveRefs(value, spec, seen)]));
}

const acceptsApiKey = (op: SpecOperation) => !!op.security?.some((entry) => 'BearerAuth' in entry);

/** Every operation an API key could call, as MCP tool definitions. */
export function mcpOperations(spec: OpenApiDocument): McpOperation[] {
  const base = spec.servers?.[0]?.url ?? '';
  const out: McpOperation[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method] as SpecOperation | undefined;
      const scope = op?.['x-required-scope'];
      if (!op?.operationId || !scope || op['x-mcp']?.exclude || !acceptsApiKey(op)) continue;
      const json = op.requestBody?.content?.['application/json'];
      if (op.requestBody && !json) continue; // non-JSON bodies cannot be tool arguments
      const params = (op.parameters ?? []).filter((p) => p.in === 'path' || p.in === 'query');
      const properties: Json = {};
      const required: string[] = [];
      for (const p of params) {
        properties[p.name] = resolveRefs({ ...p.schema, ...(p.description ? { description: p.description } : {}) }, spec);
        if (p.required || p.in === 'path') required.push(p.name);
      }
      if (json) {
        const description = op.requestBody?.description;
        properties.body = resolveRefs({ ...(json.schema ?? { type: 'object' }), ...(description ? { description } : {}) }, spec);
        if (op.requestBody?.required) required.push('body');
      }
      const summary = op.summary ?? '';
      out.push({
        name: op.operationId,
        method: method.toUpperCase(),
        path: `${base}${path}`,
        scope,
        summary,
        description: [summary, op.description].filter(Boolean).join('\n\n'),
        tags: op.tags ?? [],
        params: params.map((p) => ({ name: p.name, in: p.in as 'path' | 'query' })),
        hasBody: !!json,
        inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false },
        annotations: { title: summary, readOnlyHint: method === 'get', ...(method === 'delete' ? { destructiveHint: true } : {}) },
      });
    }
  }
  return out;
}

/** Same rule as the API itself (`hasScope`): write implies read, except for templates. */
export function scopeAllows(keyScopes: readonly string[], scope: string): boolean {
  return hasScope([...keyScopes], scope as ApiScope);
}

/** Compact mode search: every query word must occur in the name, method, path, summary, description or tags. */
export function searchOperations(ops: McpOperation[], query: string, limit = 20): McpOperation[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return ops
    .filter((op) => {
      const haystack = [op.name, op.method, op.path, op.summary, op.description, ...op.tags].join(' ').toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, limit);
}

/** Map tool arguments onto the HTTP request the API documents. A missing path parameter is a caller error. */
export function buildApiRequest(op: McpOperation, args: Json): { path: string; body?: string } {
  let path = op.path;
  const query = new URLSearchParams();
  for (const p of op.params) {
    const value = args[p.name];
    if (p.in === 'path') {
      if (value === undefined || value === null || value === '') throw new Error(`Missing path parameter: ${p.name}`);
      path = path.replace(`{${p.name}}`, encodeURIComponent(String(value)));
    } else if (value !== undefined && value !== null) {
      for (const v of Array.isArray(value) ? value : [value]) query.append(p.name, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
  }
  const qs = query.toString();
  return { path: qs ? `${path}?${qs}` : path, ...(op.hasBody && args.body !== undefined ? { body: JSON.stringify(args.body) } : {}) };
}
