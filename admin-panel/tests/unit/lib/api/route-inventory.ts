/**
 * Static inventory of the `src/app/api/v1` route tree for the OpenAPI contract test.
 *
 * Reads route sources as text (no imports, no server): which HTTP handlers each file
 * exports, which API-key scope each handler demands, and which query parameters it
 * reads. A handler that only delegates (`return fn(request, ...)`) is followed one level
 * into the imported function.
 *
 * Detection rules (documented in docs-site "API description for agents"):
 * - scope: `authenticate(request, [API_SCOPES.X])` or `requireScope(auth, API_SCOPES.X)`;
 *   `templateHttp(request, 'op')` maps through `templateOperationScope(op)`;
 *   `requireAdminApi(` means a session-only (panel) endpoint.
 * - query: `<searchParams alias>.get('name')` / `.getAll('name')`.
 *
 * @see ./openapi-contract.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';

export const SRC_DIR = path.resolve(__dirname, '../../../../src');
export const V1_DIR = path.join(SRC_DIR, 'app/api/v1');
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = typeof HTTP_METHODS[number];

export interface RouteHandler {
  method: HttpMethod;
  path: string;
  file: string;
  scopes: string[];
  session: boolean;
  templateOperation: string | null;
  query: string[];
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

/** `src/app/api/v1/products/[id]/route.ts` → `/products/{id}` */
export function toApiPath(file: string, root = V1_DIR): string {
  const rel = path.relative(root, path.dirname(file)).split(path.sep).filter(Boolean);
  return '/' + rel.map((seg) => seg.replace(/^\[(\w+)\]$/, '{$1}')).join('/');
}

const HANDLER_RE = /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;

/** Body text of each exported handler: from its declaration to the next top-level `export`. */
export function handlerBodies(src: string): Array<{ method: HttpMethod; body: string }> {
  const hits = [...src.matchAll(HANDLER_RE)];
  return hits.map((hit, i) => {
    const start = hit.index ?? 0;
    const nextExport = src.slice(start + 1).search(/\nexport\s/);
    const end = Math.min(hits[i + 1]?.index ?? src.length, nextExport === -1 ? src.length : start + 1 + nextExport);
    return { method: hit[1] as HttpMethod, body: src.slice(start, end) };
  });
}

interface Detected { scopes: string[]; session: boolean; templateOperation: string | null; query: string[] }

function detect(body: string): Detected {
  const scopes = new Set<string>();
  for (const m of body.matchAll(/authenticate\(\s*request\s*,\s*\[([^\]]*)\]/g)) {
    for (const s of m[1].matchAll(/API_SCOPES\.([A-Z_]+)/g)) scopes.add(s[1]);
  }
  for (const m of body.matchAll(/requireScope\(\s*\w+\s*,\s*API_SCOPES\.([A-Z_]+)/g)) scopes.add(m[1]);
  const template = /templateHttp\(\s*request\s*,\s*'(\w+)'/.exec(body);
  const aliases = new Set<string>(['request.nextUrl.searchParams']);
  if (/\{\s*searchParams\s*\}\s*=/.test(body)) aliases.add('searchParams');
  for (const m of body.matchAll(/const\s+(\w+)\s*=\s*(?:request\.nextUrl\.searchParams|new URL\(request\.url\)\.searchParams|\w+\.searchParams)\b/g)) aliases.add(m[1]);
  const query = new Set<string>();
  for (const alias of aliases) {
    const re = new RegExp(`${alias.replace(/\./g, '\\.')}\\.get(?:All)?\\(\\s*['"]([\\w-]+)['"]`, 'g');
    for (const m of body.matchAll(re)) query.add(m[1]);
  }
  return { scopes: [...scopes], session: /requireAdminApi\(/.test(body), templateOperation: template?.[1] ?? null, query: [...query] };
}

/** Follow `return fn(request…)` / `await fn(request…)` into the imported module, one level. */
function delegated(src: string, body: string): string | null {
  const call = /(?:return|await)\s+(\w+)\(\s*request\b/.exec(body);
  if (!call || ['authenticate', 'templateHttp', 'requireAdminApi'].includes(call[1])) return null;
  const name = call[1];
  const imp = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'@/([^']+)'`).exec(src);
  if (!imp) return null;
  const file = [`${imp[1]}.ts`, `${imp[1]}/index.ts`].map((p) => path.join(SRC_DIR, p)).find((p) => fs.existsSync(p));
  if (!file) return null;
  const target = fs.readFileSync(file, 'utf8');
  const start = target.search(new RegExp(`export\\s+async\\s+function\\s+${name}\\b`));
  if (start === -1) return null;
  const next = target.slice(start + 1).search(/\nexport\s/);
  return target.slice(start, next === -1 ? target.length : start + 1 + next);
}

export function inventoryRoutes(root = V1_DIR): RouteHandler[] {
  return walk(root).sort().flatMap((file) => {
    const src = fs.readFileSync(file, 'utf8');
    return handlerBodies(src).map(({ method, body }) => {
      let found = detect(body);
      if (!found.scopes.length && !found.session && !found.templateOperation) {
        const inner = delegated(src, body);
        if (inner) {
          const deep = detect(inner);
          found = { ...deep, query: [...new Set([...found.query, ...deep.query])] };
        }
      }
      return { method, path: toApiPath(file, root), file, ...found };
    });
  });
}
