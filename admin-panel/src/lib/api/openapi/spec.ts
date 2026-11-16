/**
 * Builds the OpenAPI 3.1 document of API v1 from the operation registry.
 *
 * zod → JSON Schema goes through one zod registry, so a schema used by several
 * operations (e.g. the storefront config) is emitted once under components and
 * referenced. Conventions consumed by agents and the generated MCP layer (W221b):
 * `operationId` on every operation, `x-required-scope` on API-key operations,
 * `x-mcp: { exclude: true }` for operations an agent should not call.
 *
 * @see ./operations.ts
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { API_OPERATIONS, API_SCHEMAS, API_TAGS, type ApiOperation } from '@/lib/api/openapi/operations';

type JsonObject = Record<string, unknown>;
export interface OpenApiDocument {
  openapi: string;
  info: JsonObject;
  servers: JsonObject[];
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, Record<string, JsonObject>>;
  components: { securitySchemes: JsonObject; schemas: Record<string, JsonObject>; responses: JsonObject };
}

const SCHEMA_REF = (id: string) => `#/components/schemas/${id}`;
const ref = (id: string) => ({ $ref: SCHEMA_REF(id) });

const pagination = {
  type: 'object', required: ['cursor', 'next_cursor', 'has_more', 'limit'],
  properties: { cursor: { type: ['string', 'null'] }, next_cursor: { type: ['string', 'null'] }, has_more: { type: 'boolean' }, limit: { type: 'integer' }, total: { type: 'integer' } },
};
const apiError = {
  type: 'object', required: ['error'],
  properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } } } } },
};
const templateError = {
  type: 'object', required: ['code', 'message'],
  properties: { code: { type: 'string', enum: ['UNAUTHORIZED', 'FORBIDDEN', 'CONFLICT', 'INVALID', 'NOT_FOUND', 'UNAVAILABLE', 'LIMIT', 'RATE_LIMITED'] }, message: { type: 'string' }, validation: { oneOf: [ref('ValidationResult'), { type: 'null' }] }, currentRevision: { type: ['integer', 'null'] } },
};

function stripMeta(schema: JsonObject): JsonObject {
  const rest = { ...schema };
  for (const key of ['$schema', '$id', 'id']) delete rest[key];
  return rest;
}

/** zod schemas of the registry → components.schemas, with cross-references between them. */
function convertSchemas(operations: readonly ApiOperation[]): { schemas: Record<string, JsonObject>; idOf: Map<z.ZodType, string> } {
  const registry = z.registry<{ id: string }>();
  const idOf = new Map<z.ZodType, string>();
  const add = (schema: z.ZodType, id: string) => {
    if (idOf.has(schema)) return;
    idOf.set(schema, id);
    registry.add(schema, { id });
  };
  // Shared schemas get readable component names; the rest is named after its first operation.
  for (const [id, schema] of Object.entries(API_SCHEMAS)) add(schema, id);
  for (const op of operations) {
    if (op.body) add(op.body, `${op.operationId}_body`);
    if (op.response) add(op.response, `${op.operationId}_response`);
  }
  const out = z.toJSONSchema(registry, { io: 'input', unrepresentable: 'any', uri: SCHEMA_REF }) as { schemas: Record<string, JsonObject> };
  const schemas = Object.fromEntries(Object.entries(out.schemas).map(([id, schema]) => [id, stripMeta(schema)]));
  return { schemas, idOf };
}

function successContent(op: ApiOperation, idOf: Map<z.ZodType, string>): JsonObject | undefined {
  const envelope = op.envelope ?? 'data';
  if (envelope === 'empty') return undefined;
  if (envelope === 'csv') return { 'text/csv': { schema: { type: 'string' } } };
  const payload = op.response ? ref(idOf.get(op.response)!) : {};
  const schema = envelope === 'raw' ? payload
    : envelope === 'list' ? { type: 'object', required: ['data', 'pagination'], properties: { data: { type: 'array', items: payload }, pagination: ref('Pagination') } }
      : { type: 'object', required: ['data'], properties: { data: payload } };
  return { 'application/json': { schema } };
}

function buildOperation(op: ApiOperation, idOf: Map<z.ZodType, string>): JsonObject {
  const pathParams = [...op.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
  const queryParams = Object.entries(op.query?.shape ?? {}).map(([name, field]) => {
    const { description, ...schema } = stripMeta(z.toJSONSchema(field as z.ZodType, { io: 'input', unrepresentable: 'any' }) as JsonObject) as JsonObject & { description?: string };
    return { name, in: 'query', required: !(field as z.ZodType).safeParse(undefined).success, schema, ...(description ? { description } : {}) };
  });
  const template = op.tag === 'Offers' || op.tag === 'Templates';
  const errorSchema = template ? ref('TemplateError') : ref('Error');
  const statuses = op.status ?? [200];
  const responses: JsonObject = {};
  for (const status of statuses) {
    const content = status === 204 ? undefined : successContent(op, idOf);
    responses[String(status)] = { description: status === 204 ? 'No content' : 'Success', ...(content ? { content } : {}) };
  }
  if (op.auth !== 'public') {
    responses['401'] = { description: 'Missing or invalid credentials', content: { 'application/json': { schema: errorSchema } } };
    responses['403'] = { description: op.scope ? `Key lacks scope ${op.scope}` : 'Not allowed', content: { 'application/json': { schema: errorSchema } } };
  }
  responses['429'] = { description: 'Rate limited', content: { 'application/json': { schema: errorSchema } } };
  responses.default = { description: 'Error', content: { 'application/json': { schema: errorSchema } } };

  const requestBody = op.body
    ? { required: true, content: { 'application/json': { schema: ref(idOf.get(op.body)!) } } }
    : op.bodyHint ? { required: true, description: `Fields: ${op.bodyHint}`, content: { 'application/json': { schema: { type: 'object' } } } } : undefined;

  return {
    operationId: op.operationId,
    summary: op.summary,
    ...(op.description ? { description: op.description } : {}),
    tags: [op.tag],
    ...(pathParams.length || queryParams.length ? { parameters: [...pathParams, ...queryParams] } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses,
    security: op.auth === 'public' ? [] : op.auth === 'session' ? [{ SessionCookie: [] }] : [{ BearerAuth: [] }],
    ...(op.scope && !op.auth ? { 'x-required-scope': op.scope } : {}),
    ...(op.mcpExclude ? { 'x-mcp': { exclude: true } } : {}),
  };
}

export function buildOpenApiSpec(operations: readonly ApiOperation[] = API_OPERATIONS): OpenApiDocument {
  const { schemas, idOf } = convertSchemas(operations);
  const paths: OpenApiDocument['paths'] = {};
  for (const op of operations) {
    (paths[op.path] ??= {})[op.method.toLowerCase()] = buildOperation(op, idOf);
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Sellf API v1',
      version: '1',
      description: 'Admin API of a Sellf instance. Authenticate with `Authorization: Bearer <API key>` (Settings → API Keys). Each operation lists the scope it needs in `x-required-scope`. Amounts are in major currency units unless stated otherwise.',
    },
    servers: [{ url: '/api/v1', description: 'This Sellf instance' }],
    tags: Object.entries(API_TAGS).map(([name, description]) => ({ name, description })),
    paths,
    components: {
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer', description: 'API key created in Settings → API Keys (sf_live_…)' },
        SessionCookie: { type: 'apiKey', in: 'cookie', name: 'sb-access-token', description: 'Admin panel session (browser only)' },
      },
      schemas: { ...schemas, Pagination: pagination, Error: apiError, TemplateError: templateError },
      responses: {},
    },
  };
}

let cached: { body: string; etag: string } | null = null;

/** Serialized document, built once per server process (the registry is static). */
export function openApiJson(): { body: string; etag: string } {
  if (!cached) {
    const body = JSON.stringify(buildOpenApiSpec());
    cached = { body, etag: `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"` };
  }
  return cached;
}
