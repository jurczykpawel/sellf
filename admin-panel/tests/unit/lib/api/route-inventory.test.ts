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

  it('requires a registry entry for an OPTIONS handler that is not an empty CORS preflight (W221br P2)', () => {
    // 200 with a cookie is not a preflight, even though the body is null.
    const [cookie] = one(`export function OPTIONS() { return new Response(null, { status: 200, headers: { 'Set-Cookie': 'x=y' } }); }`);
    expect(cookie?.method).toBe('OPTIONS');
    // Status other than 204, missing status, or extra init keys are not the recognised preflight.
    expect(one(`export function OPTIONS() { return new Response(null, { status: 200 }); }`)).toHaveLength(1);
    expect(one(`export function OPTIONS() { return new Response(null); }`)).toHaveLength(1);
    expect(one(`export function OPTIONS() { return new Response(null, { status: 204, statusText: 'x' }); }`)).toHaveLength(1);
    expect(one(`const H = { 'Access-Control-Allow-Origin': '*', 'Set-Cookie': 'x=y' };\nexport function OPTIONS() { return new Response(null, { status: 204, headers: { ...H } }); }`)).toHaveLength(1);
    expect(one(`declare const h: Record<string, string>;\nexport function OPTIONS() { return new Response(null, { status: 204, headers: h }); }`)).toHaveLength(1);
    // The recognised preflight: empty 204 with CORS headers only (inline or via a const spread).
    expect(one(`const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } }); }`)).toEqual([]);
  });

  it('ignores the body of a nested function that is never called (W221br P1)', () => {
    // The reviewer's probe: the only real check passes no scope; the scoped one is dead code.
    const [dead] = one(`export async function GET(request: NextRequest) {
  await authenticate(request, []);
  async function unused() { await authenticate(request, [API_SCOPES.PRODUCTS_READ]); }
  void unused;
  return Response.json({});
}`);
    expect(dead.scopes).toEqual([]);
    expect(dead.unresolved).toEqual([expect.stringContaining('execution')]);

    const [uncalled] = one(`export async function GET(request: NextRequest) {
  await authenticate(request, []);
  const later = async () => authenticate(request, [API_SCOPES.PRODUCTS_READ]);
  return Response.json({});
}`);
    expect(uncalled.scopes).toEqual([]);
    expect(uncalled.unresolved).toEqual([]);
  });

  it('credits a nested function only when its call is reachable from the executed body (W221cr P2)', () => {
    // Reviewer probe 1: `check` is called only from `unused`, which never runs.
    const [deadCaller] = one(`export async function GET(request: NextRequest) {
  await authenticate(request, []);
  async function check() { await authenticate(request, [API_SCOPES.PRODUCTS_READ]); }
  async function unused() { await check(); }
  return Response.json({});
}`);
    expect(deadCaller.scopes).toEqual([]);
    expect(deadCaller.unresolved).toEqual([]);

    // Reviewer probe 2: `check` is called only from a callback handed to a function that drops it.
    const [dropped] = one(`export async function GET(request: NextRequest) {
  await authenticate(request, []);
  async function check() { await authenticate(request, [API_SCOPES.PRODUCTS_READ]); }
  const neverRuns = (_f: unknown) => {};
  neverRuns(async () => { await check(); });
  return Response.json({});
}`);
    expect(dropped.scopes).toEqual([]);
    expect(dropped.unresolved).toEqual([expect.stringContaining('execution')]);
  });

  it('follows reachable calls through nested functions, recursively and without looping on cycles', () => {
    const [chain] = one(`export async function GET(request: NextRequest) {
  await outer();
  async function outer() { await inner(); }
  async function inner() { await authenticate(request, [API_SCOPES.PRODUCTS_READ]); if (Math.random() > 2) await outer(); }
  async function ping(): Promise<void> { await pong(); }
  async function pong(): Promise<void> { await ping(); }
  return Response.json({});
}`);
    expect(chain.scopes).toEqual(['PRODUCTS_READ']);
    expect(chain.unresolved).toEqual([]);

    // A function passed on under another name (alias) is not proven to run.
    const [alias] = one(`export async function GET(request: NextRequest) {
  await authenticate(request, []);
  async function check() { await authenticate(request, [API_SCOPES.PRODUCTS_READ]); }
  const run = check;
  return Response.json({ run });
}`);
    expect(alias.scopes).toEqual([]);
    expect(alias.unresolved).toEqual([expect.stringContaining('execution')]);
  });

  it('marks a nested function whose execution it cannot prove as unresolved', () => {
    const [callback] = one(`declare function later(f: () => unknown): void;
export async function GET(request: NextRequest) {
  later(async () => authenticate(request, [API_SCOPES.PRODUCTS_READ]));
  return Response.json({});
}`);
    expect(callback.scopes).toEqual([]);
    expect(callback.unresolved).toEqual([expect.stringContaining('execution')]);
  });

  it('follows a nested function that the handler calls, and an immediately invoked one', () => {
    const [called] = one(`export async function GET(request: NextRequest) {
  const check = async () => authenticate(request, [API_SCOPES.PRODUCTS_READ]);
  async function read() { return request.nextUrl.searchParams.get('q'); }
  await check();
  await (async () => { await read(); })();
  return Response.json({});
}`);
    expect(called.scopes).toEqual(['PRODUCTS_READ']);
    expect(called.query).toEqual(['q']);
    expect(called.unresolved).toEqual([]);
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
