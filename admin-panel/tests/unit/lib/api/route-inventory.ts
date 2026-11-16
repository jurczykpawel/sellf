/**
 * Static inventory of the `src/app/api/v1` route tree for the OpenAPI contract test.
 *
 * Reads route sources through the TypeScript AST (no imports, no server), so comments and
 * strings never count: which HTTP handlers each file exports (any method, any export form),
 * which API-key scope each handler demands, and which query parameters it reads. Functions
 * the handler calls with its `request` (local or `@/` imports) are followed one level.
 *
 * Detection rules (documented in docs-site "API description for agents"):
 * - handlers: `export function|const X`, `export { local as X }` for every HTTP method; only the
 *   standard CORS preflight OPTIONS (`handleCorsPreFlight` or an empty 204 response) is skipped.
 * - scope: `authenticate(request, [API_SCOPES.X])`, `authenticateApiKeyPrincipal(…)`,
 *   `requireScope(auth, API_SCOPES.X)`; `templateHttp(request, 'op')` maps through
 *   `templateOperationScope(op)`; `requireAdminApi(` means a session-only (panel) endpoint.
 * - query: `<searchParams>.get|getAll|has('name')`, where `<searchParams>` is any `.searchParams`
 *   or a const/destructured alias of it.
 * Anything else (a computed scope list, a searchParams object passed on, a non-literal name, an
 * export that does not resolve to a function) lands in `unresolved`, which the contract test fails.
 *
 * @see ./openapi-contract.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const SRC_DIR = path.resolve(__dirname, '../../../../src');
export const V1_DIR = path.join(SRC_DIR, 'app/api/v1');
export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export type HttpMethod = typeof HTTP_METHODS[number];

export interface RouteHandler {
  method: HttpMethod;
  path: string;
  file: string;
  scopes: string[];
  session: boolean;
  templateOperation: string | null;
  query: string[];
  /** Flows the reader could not prove (scope, query or handler); the contract test fails on them. */
  unresolved: string[];
}

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
interface Detected { scopes: Set<string>; session: boolean; templateOperation: string | null; query: Set<string>; unresolved: string[] }

const AUTH_CALLS = new Set(['authenticate', 'authenticateApiKeyPrincipal']);
const PRIMITIVES = new Set([...AUTH_CALLS, 'requireScope', 'templateHttp', 'requireAdminApi']);
const QUERY_METHODS = new Set(['get', 'getAll', 'has']);

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

const sourceCache = new Map<string, ts.SourceFile>();
function parse(file: string): ts.SourceFile {
  let sf = sourceCache.get(file);
  if (!sf) {
    sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    sourceCache.set(file, sf);
  }
  return sf;
}

const isFunctionLike = (node: ts.Node | undefined): node is FunctionLike =>
  !!node && (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node));
const hasExport = (node: ts.Node) => !!ts.getModifiers(node as ts.HasModifiers)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const calleeName = (call: ts.CallExpression) => (ts.isIdentifier(call.expression) ? call.expression.text : null);

/** Top-level function or const-initialiser named `name`. */
function localDefinition(sf: ts.SourceFile, name: string): ts.Node | undefined {
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) return stmt;
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) return decl.initializer;
      }
    }
  }
  return undefined;
}

/** Exported HTTP handlers: method → implementation (or null when it cannot be followed). */
function exportedHandlers(sf: ts.SourceFile): Array<{ method: HttpMethod; impl: ts.Node | null }> {
  const out: Array<{ method: HttpMethod; impl: ts.Node | null }> = [];
  const isMethod = (name: string): name is HttpMethod => (HTTP_METHODS as readonly string[]).includes(name);
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && hasExport(stmt) && stmt.name && isMethod(stmt.name.text)) out.push({ method: stmt.name.text, impl: stmt });
    if (ts.isVariableStatement(stmt) && hasExport(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && isMethod(decl.name.text)) out.push({ method: decl.name.text, impl: decl.initializer ?? null });
      }
    }
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const spec of stmt.exportClause.elements) {
        if (!isMethod(spec.name.text)) continue;
        const local = (spec.propertyName ?? spec.name).text;
        out.push({ method: spec.name.text, impl: stmt.moduleSpecifier ? null : localDefinition(sf, local) ?? null });
      }
    }
  }
  return out;
}

/** The standard CORS preflight: `handleCorsPreFlight` itself, or a body that only returns it / an empty response. */
function isPreflight(impl: ts.Node | null): boolean {
  if (!impl) return false;
  if (ts.isIdentifier(impl)) return impl.text === 'handleCorsPreFlight';
  if (!isFunctionLike(impl) || !impl.body) return false;
  const expr = ts.isBlock(impl.body)
    ? impl.body.statements.length === 1 && ts.isReturnStatement(impl.body.statements[0]) ? impl.body.statements[0].expression : undefined
    : impl.body;
  if (!expr) return false;
  if (ts.isCallExpression(expr)) return calleeName(expr) === 'handleCorsPreFlight';
  return ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) && ['Response', 'NextResponse'].includes(expr.expression.text)
    && expr.arguments?.[0]?.kind === ts.SyntaxKind.NullKeyword;
}

const scopeName = (node: ts.Expression): string | null =>
  ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'API_SCOPES' ? node.name.text : null;
const stringLiteral = (node: ts.Expression | undefined): string | null =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

/** Resolve an imported `@/…` function to its declaration in the source tree. */
function importedDefinition(sf: ts.SourceFile, name: string): { sf: ts.SourceFile; node: ts.Node } | null {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || stmt.importClause?.isTypeOnly) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const spec = bindings.elements.find((el) => el.name.text === name);
    const from = (stmt.moduleSpecifier as ts.StringLiteral).text;
    if (!spec || !from.startsWith('@/')) continue;
    const base = path.join(SRC_DIR, from.slice(2));
    const file = [`${base}.ts`, `${base}/index.ts`].find((p) => fs.existsSync(p));
    if (!file) return null;
    const target = parse(file);
    const node = localDefinition(target, (spec.propertyName ?? spec.name).text);
    return node ? { sf: target, node } : null;
  }
  return null;
}

function detect(impl: ts.Node, sf: ts.SourceFile, requestName: string | null, depth: number, found: Detected): void {
  const searchParamsNames = new Set<string>();
  /** A reference (not a declaration or a property name) to a searchParams value. */
  const isSearchParams = (node: ts.Node): boolean => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text === 'searchParams';
    if (!ts.isIdentifier(node) || !searchParamsNames.has(node.text)) return false;
    const parent = node.parent;
    return !((ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node)
      || ts.isBindingElement(parent) || ts.isParameter(parent) || (ts.isVariableDeclaration(parent) && parent.name === node));
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      // Aliases: `const sp = <searchParams>` and `const { searchParams[: alias] } = …`.
      if (ts.isIdentifier(node.name) && node.initializer && isSearchParams(node.initializer)) {
        searchParamsNames.add(node.name.text);
        if (ts.isPropertyAccessExpression(node.initializer)) visit(node.initializer.expression);
        return;
      }
      if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : null;
          if (prop === 'searchParams' && ts.isIdentifier(el.name)) searchParamsNames.add(el.name.text);
        }
      }
      if (node.initializer) visit(node.initializer);
      return;
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name && AUTH_CALLS.has(name)) {
        const list = node.arguments[1];
        if (list && !(ts.isArrayLiteralExpression(list) && list.elements.every((el) => scopeName(el)))) found.unresolved.push(`scope: ${name}() with a non-literal scope list`);
        else if (list) for (const el of (list as ts.ArrayLiteralExpression).elements) found.scopes.add(scopeName(el)!);
      } else if (name === 'requireScope') {
        const scope = node.arguments[1] && scopeName(node.arguments[1]);
        if (scope) found.scopes.add(scope); else found.unresolved.push('scope: requireScope() with a non-literal scope');
      } else if (name === 'templateHttp') {
        const op = stringLiteral(node.arguments[1]);
        if (op) found.templateOperation = op; else found.unresolved.push('scope: templateHttp() with a non-literal operation');
      } else if (name === 'requireAdminApi') {
        found.session = true;
      } else if (name && depth > 0 && requestName) {
        // Follow functions handed this handler's request, one level.
        const index = node.arguments.findIndex((arg) => ts.isIdentifier(arg) && arg.text === requestName);
        const local = index === -1 ? undefined : localDefinition(sf, name);
        const target = index === -1 ? null : local ? { sf, node: local } : importedDefinition(sf, name);
        if (target && isFunctionLike(target.node)) {
          const param = target.node.parameters[index]?.name;
          detect(target.node, target.sf, param && ts.isIdentifier(param) ? param.text : null, depth - 1, found);
        }
      }
      // Query reads: `<searchParams>.get('literal')`.
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && isSearchParams(callee.expression)) {
        const key = stringLiteral(node.arguments[0]);
        if (QUERY_METHODS.has(callee.name.text) && key) found.query.add(key);
        else found.unresolved.push(`query: ${callee.name.text}() on searchParams${key ? '' : ' with a non-literal name'}`);
        if (ts.isPropertyAccessExpression(callee.expression)) visit(callee.expression.expression);
        node.arguments.forEach(visit);
        return;
      }
    }
    // Any other use of a searchParams value escapes the reader.
    if (isSearchParams(node)) {
      found.unresolved.push(`query: searchParams passed on (${ts.SyntaxKind[node.parent.kind]})`);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(impl);
}

export function inventoryRoutes(root = V1_DIR): RouteHandler[] {
  return walk(root).sort().flatMap((file) => {
    const sf = parse(file);
    return exportedHandlers(sf).flatMap(({ method, impl }) => {
      if (method === 'OPTIONS' && isPreflight(impl)) return [];
      const found: Detected = { scopes: new Set(), session: false, templateOperation: null, query: new Set(), unresolved: [] };
      const fn = impl && ts.isIdentifier(impl) ? localDefinition(sf, impl.text) : impl;
      if (isFunctionLike(fn)) {
        const param = fn.parameters[0]?.name;
        detect(fn, sf, param && ts.isIdentifier(param) ? param.text : null, 1, found);
      } else {
        found.unresolved.push('handler: export does not resolve to a function in this file');
      }
      return [{ method, path: toApiPath(file, root), file, scopes: [...found.scopes], session: found.session, templateOperation: found.templateOperation, query: [...found.query], unresolved: found.unresolved }];
    });
  });
}
