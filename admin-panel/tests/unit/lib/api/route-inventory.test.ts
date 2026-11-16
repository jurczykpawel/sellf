/**
 * The contract gate's route reader (W221ar findings 2 and 3): handlers, scopes and query
 * parameters come from the TypeScript AST of executed code, not from text that a comment,
 * an export alias or a renamed destructuring can fool. Unrecognised flows are reported.
 * @see ./route-inventory.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inventoryRoutes } from './route-inventory';

const roots: string[] = [];
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'route-inventory-'));
  roots.push(root);
  for (const [rel, src] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
    fs.writeFileSync(path.join(root, rel, 'route.ts'), src);
  }
  return root;
}
const head = `import { authenticate, handleCorsPreFlight, API_SCOPES } from '@/lib/api';\nimport type { NextRequest } from 'next/server';\n`;
const one = (src: string, rel = 'probe') => inventoryRoutes(tree({ [rel]: head + src }));

describe('route inventory (AST)', () => {
  it('sees HEAD and a non-preflight OPTIONS handler; skips only the standard CORS preflight', () => {
    const routes = one(`
export async function HEAD(request: NextRequest) { await authenticate(request, [API_SCOPES.PRODUCTS_READ]); return new Response(null); }
export async function OPTIONS(request: NextRequest) { await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]); return Response.json({ ok: true }); }`);
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(['HEAD /probe', 'OPTIONS /probe']);
    expect(routes[0].scopes).toEqual(['PRODUCTS_READ']);

    expect(one(`export async function OPTIONS(request: NextRequest) { return handleCorsPreFlight(request); }`)).toEqual([]);
    expect(one(`export const OPTIONS = handleCorsPreFlight;`)).toEqual([]);
    expect(one(`export function OPTIONS() { return new Response(null, { status: 204 }); }`)).toEqual([]);
  });

  it('resolves `export { handle as GET }` and `export const GET = async () => …` to their implementation', () => {
    const routes = one(`
async function handle(request: NextRequest) { await authenticate(request, [API_SCOPES.COUPONS_READ]); return Response.json({}); }
export { handle as GET };
export const DELETE = async (request: NextRequest) => { await authenticate(request, [API_SCOPES.COUPONS_WRITE]); return new Response(null); };`);
    expect(routes.map((r) => [r.method, r.scopes])).toEqual([['GET', ['COUPONS_READ']], ['DELETE', ['COUPONS_WRITE']]]);
    expect(routes.every((r) => r.unresolved.length === 0)).toBe(true);
  });

  it('reports an export whose implementation cannot be followed', () => {
    const [route] = one(`const wrap = (f: unknown) => f;\nexport const GET = wrap(async () => new Response(null));`);
    expect(route.method).toBe('GET');
    expect(route.unresolved).toEqual([expect.stringContaining('handler')]);
  });

  it('ignores a scope check that only exists in a comment', () => {
    const [route] = one(`export async function GET(request: NextRequest) {
  await authenticate(request, []) /* authenticate(request, [API_SCOPES.PRODUCTS_READ]) */;
  // requireScope(auth, API_SCOPES.PRODUCTS_READ)
  return Response.json({});
}`);
    expect(route.scopes).toEqual([]);
  });

  it('reports a scope argument it cannot read statically', () => {
    const [route] = one(`const scopes = [API_SCOPES.PRODUCTS_READ];\nexport async function GET(request: NextRequest) { await authenticate(request, scopes); return Response.json({}); }`);
    expect(route.unresolved).toEqual([expect.stringContaining('scope')]);
  });

  it('reads query parameters through renamed destructuring and aliases', () => {
    const [route] = one(`export async function GET(request: NextRequest) {
  await authenticate(request, [API_SCOPES.PRODUCTS_READ]);
  const { searchParams: params } = new URL(request.url);
  const alias = params;
  return Response.json({ a: params.get('extra'), b: alias.getAll('tag'), c: request.nextUrl.searchParams.has('flag') });
}`);
    expect([...route.query].sort()).toEqual(['extra', 'flag', 'tag']);
    expect(route.unresolved).toEqual([]);
  });

  it('reports query parameters read in a way it cannot follow', () => {
    const [route] = one(`declare function parse(p: URLSearchParams): unknown;
export async function GET(request: NextRequest) {
  await authenticate(request, [API_SCOPES.PRODUCTS_READ]);
  const key = 'x';
  return Response.json({ a: parse(request.nextUrl.searchParams), b: request.nextUrl.searchParams.get(key) });
}`);
    expect(route.unresolved).toHaveLength(2);
    expect(route.unresolved.every((reason) => reason.includes('query'))).toBe(true);
  });
});
