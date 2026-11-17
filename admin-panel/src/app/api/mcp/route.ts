/**
 * POST /api/mcp — built-in MCP endpoint (stateless Streamable HTTP), a thin layer over API v1.
 *
 * Tools come from the OpenAPI document (`mcpOperations(buildOpenApiSpec())`); every tool call is an
 * HTTP request to this same instance's `/api/v1/...` route with the caller's own Authorization
 * header, so authentication, scopes, rate limits, demo mode and audit are the API's — MCP bypasses
 * nothing. Only API keys are accepted here: a panel session cookie never drives an agent and is
 * never forwarded.
 *
 * `/api/mcp` exposes one tool per operation; `/api/mcp?mode=compact` exposes `search_operations` +
 * `call_operation` (the full tool list is large).
 *
 * @see src/lib/mcp/operations.ts
 * @see src/lib/api/openapi/operations.ts (the registry the tools are generated from)
 */
import { Server, WebStandardStreamableHTTPServerTransport, type CallToolResult, type Tool } from '@modelcontextprotocol/server';
import { ApiAuthError, authenticateApiKeyPrincipal } from '@/lib/api/middleware';
import { buildOpenApiSpec } from '@/lib/api/openapi/spec';
import { buildApiRequest, mcpOperations, scopeAllows, searchOperations, type McpOperation, type OpenApiDocument } from '@/lib/mcp/operations';
import { APP_VERSION } from '@/lib/version';
import type { NextRequest } from 'next/server';

let operations: McpOperation[] | null = null;
const allOperations = () => (operations ??= mcpOperations(buildOpenApiSpec() as unknown as OpenApiDocument));

/** Headers the API's auth and rate limiter read; cookies are deliberately not among them. */
const FORWARDED_HEADERS = ['authorization', 'user-agent', 'x-forwarded-for', 'x-real-ip'];
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
};
const CALL_TIMEOUT_MS = 60_000;

/** This server process itself, never an address derived from request headers (no SSRF via Host). */
function internalOrigin(): string {
  return process.env.SELLF_INTERNAL_URL?.replace(/\/+$/, '') || `http://127.0.0.1:${process.env.PORT || 3000}`;
}

const COMPACT_TOOLS: Tool[] = [
  {
    name: 'search_operations',
    description: 'Search the Sellf API operations this key may call. Every word must match the operation name, path, summary, description or group; an empty query matches all; at most 20 results. Returns each operation\'s operationId and input schema for call_operation.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    annotations: { title: 'Search API operations', readOnlyHint: true },
  },
  {
    name: 'call_operation',
    description: 'Call an API operation found with search_operations. `params` follows that operation\'s input schema (path and query parameters by name, JSON request body under `body`).',
    inputSchema: { type: 'object', properties: { operationId: { type: 'string' }, params: { type: 'object' } }, required: ['operationId'], additionalProperties: false },
    annotations: { title: 'Call an API operation', readOnlyHint: false },
  },
];

const toolError = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true });
const asTool = (op: McpOperation): Tool => ({ name: op.name, description: op.description, inputSchema: op.inputSchema, annotations: op.annotations });

function rpcError(status: number, message: string): Response {
  const headers: Record<string, string> = { ...CORS };
  if (status === 401) headers['WWW-Authenticate'] = 'Bearer realm="sellf-mcp"';
  return Response.json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }, { status, headers });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}

/** Stateless server: no server-initiated stream (GET) and no session to end (DELETE). */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: 'POST' } });
}
export const DELETE = GET;

export async function POST(request: NextRequest): Promise<Response> {
  if (!/^bearer\s+\S/i.test(request.headers.get('authorization') ?? '')) {
    return rpcError(401, 'Unauthorized: send Authorization: Bearer <Sellf API key>');
  }
  let scopes: string[];
  try {
    ({ scopes } = await authenticateApiKeyPrincipal(request));
  } catch (error) {
    if (error instanceof ApiAuthError && error.code === 'RATE_LIMITED') return rpcError(429, error.message);
    return rpcError(401, 'Unauthorized: invalid or inactive API key');
  }

  const allowed = allOperations().filter((op) => scopeAllows(scopes, op.scope));
  const byName = new Map(allowed.map((op) => [op.name, op]));
  const compact = request.nextUrl.searchParams.get('mode') === 'compact';
  const forwarded = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) forwarded.set(name, value);
  }

  async function callApi(op: McpOperation | undefined, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!op) return toolError('Unknown operation, or not permitted for this API key\'s scopes.');
    let apiRequest: ReturnType<typeof buildApiRequest>;
    try { apiRequest = buildApiRequest(op, args); } catch (error) { return toolError(error instanceof Error ? error.message : 'Invalid arguments'); }
    const headers = new Headers(forwarded);
    if (apiRequest.body !== undefined) headers.set('content-type', 'application/json');
    try {
      const response = await fetch(`${internalOrigin()}${apiRequest.path}`, {
        method: op.method, headers, body: apiRequest.body, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      const text = (await response.text()) || `HTTP ${response.status}`;
      return { content: [{ type: 'text', text }], isError: !response.ok };
    } catch (error) {
      console.error('[mcp] internal API call failed:', error instanceof Error ? error.message : 'Unknown error');
      return toolError('The Sellf API could not be reached from the MCP endpoint.');
    }
  }

  const server = new Server(
    { name: 'Sellf', version: APP_VERSION },
    { capabilities: { tools: {} }, instructions: `Sellf API v1 (${allowed.length} operations for this key). Tool results are the API's JSON responses. Prices are in major currency units unless an operation says otherwise.` },
  );
  server.setRequestHandler('tools/list', () => ({ tools: compact ? COMPACT_TOOLS : allowed.map(asTool) }));
  server.setRequestHandler('tools/call', async ({ params }) => {
    const args = params.arguments ?? {};
    if (!compact) return callApi(byName.get(params.name), args);
    if (params.name === 'search_operations') {
      const listing = searchOperations(allowed, String(args.query ?? '')).map((op) => ({
        operationId: op.name, method: op.method, path: op.path, summary: op.summary, inputSchema: op.inputSchema, annotations: op.annotations,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(listing) }] };
    }
    if (params.name === 'call_operation') return callApi(byName.get(String(args.operationId)), (args.params ?? {}) as Record<string, unknown>);
    return toolError(`Unknown tool: ${params.name}`);
  });

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  for (const [name, value] of Object.entries(CORS)) response.headers.set(name, value);
  return response;
}
