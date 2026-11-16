/**
 * GET /api/v1/openapi.json — OpenAPI 3.1 description of API v1 for agents and tools.
 *
 * Public on purpose: it describes operations, scopes and schemas, never data or secrets.
 * The server URL is relative (`/api/v1`), so a forged Host header cannot leak into a
 * cached copy. Built once per process from the operation registry. next.config.ts re-asserts
 * the public Cache-Control over the generic /api no-store rule.
 *
 * @see src/lib/api/openapi/operations.ts
 */
import { NextResponse } from 'next/server';
import { openApiJson } from '@/lib/api/openapi/spec';
import { checkRateLimit } from '@/lib/rate-limiting';
import type { NextRequest } from 'next/server';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const CACHE = { ...CORS, 'Cache-Control': 'public, max-age=300, s-maxage=300', 'X-Content-Type-Options': 'nosniff' };

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await checkRateLimit('openapi_spec', 60, 1))) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429, headers: { ...CORS, 'Retry-After': '60' } });
  }
  const { body, etag } = openApiJson();
  if (request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ...CACHE, ETag: etag } });
  }
  return new NextResponse(body, { status: 200, headers: { ...CACHE, ETag: etag, 'Content-Type': 'application/json; charset=utf-8' } });
}
