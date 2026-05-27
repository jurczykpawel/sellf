/**
 * ============================================================================
 * SECURITY TEST: Admin RPCs in public have an explicit REVOKE EXECUTE
 * ============================================================================
 *
 * Static SQL analysis (no live DB required). For every `CREATE [OR REPLACE]
 * FUNCTION public.<name>(<args>)` whose name matches an admin/internal
 * pattern, this test asserts that SOME migration file contains a matching
 * `REVOKE EXECUTE ON FUNCTION public.<name>(<args>)`.
 *
 * Why this matters
 * ----------------
 * 1. The catch-all `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM PUBLIC`
 *    installed by 20260302000000_restrict_rpc_function_access only fires for
 *    NEW functions. A `DROP FUNCTION + CREATE FUNCTION` with a changed
 *    signature re-creates the function fresh (a different oid) — Postgres
 *    grants default EXECUTE to anon and authenticated, and any earlier
 *    REVOKE attached to the old signature is silently invalidated.
 *
 * 2. The `lock_graphql_introspection` style migration that ships REVOKE +
 *    COMMENT directives must reference the function by its CURRENT argument
 *    list — when downsell columns were added to admin_save_oto_offer
 *    (20260515110000), both the REVOKE and the @graphql include:false
 *    directive that originally targeted the 6-arg signature stopped
 *    matching, and the 10-arg signature leaked to pg_graphql as an anon
 *    Mutation. This test catches that class of bug at PR time.
 *
 * OWASP angle
 * -----------
 * API5:2023 Broken Function Level Authorization — without REVOKE, anon
 * can call admin RPCs directly via PostgREST RPC endpoint.
 * API3:2023 Broken Object Property Level Authorization — without REVOKE,
 * pg_graphql exposes the function in `__schema { mutationType { fields } }`
 * which leaks the existence + signature of admin operations to anon
 * (reconnaissance value even if the call itself would fail).
 *
 * Companion tests
 * ---------------
 *   - graphql-introspection-runtime.integration.test.ts — runtime probe
 *     that the live pg_graphql schema reflects the REVOKEs (catches cache
 *     lag + comment syntax errors).
 *   - tests/unit/scripts/lint-migrations.test.ts — generic DROP+CREATE
 *     coverage (this test is the admin-pattern-specific tightening).
 * ============================================================================
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');

/**
 * Function names that MUST have an explicit REVOKE EXECUTE on every signature.
 * Mirrors the FORBIDDEN_PATTERNS in graphql-introspection-runtime; keep in sync.
 */
const ADMIN_PATTERNS: RegExp[] = [
  /^admin_/i,
  /^get_admin_/i,
  /dashboard/i,
  /revenue/i,
  /payment_statistics/i,
  /sales_chart/i,
  /abandoned/i,
  /payment_history/i,
  /^process_refund/i,
  /^process_stripe/i,
  /^validate_payment_transaction/i,
  /^cleanup_/i,
  /^migrate_guest/i,
  /^mark_expired/i,
  /grant_product_access_service_role/i,
  /^increment_/i,
];

/**
 * Functions intentionally exposed despite matching one of ADMIN_PATTERNS.
 * Empty by design — every admin-shaped function currently in tree should
 * have a matching REVOKE. Add an entry here ONLY if a function name has
 * to retain a forbidden prefix for storefront reasons (rare); the value
 * must be a one-line justification that survives code review.
 */
const EXEMPT: Record<string, string> = {};

/**
 * The catch-all REVOKE migration (20260302000000_restrict_rpc_function_access)
 * uses a dynamic `DO $$ … REVOKE … $$` loop over every function in `public` +
 * an `ALTER DEFAULT PRIVILEGES` so future CREATEs inherit the deny. Static
 * grep cannot match the DO block, but the runtime result is equivalent to an
 * explicit REVOKE on every function that existed at that point.
 *
 * Functions defined in migrations dated AT OR BEFORE this timestamp are
 * therefore covered. Only later CREATEs (and DROP+CREATE rewrites in any
 * migration after the catch-all) need an inline REVOKE — they bypass the
 * one-shot DO block.
 *
 * Mirrors ENFORCE_FROM_TIMESTAMP in admin-panel/scripts/lint-migrations.ts.
 */
const CATCH_ALL_REVOKE_TIMESTAMP = '20260302000001';

function migrationTimestamp(filename: string): string | null {
  const m = filename.match(/^(\d{14})_/);
  return m ? m[1] : null;
}

interface FunctionDef {
  file: string;
  name: string;
  /** Normalised arg list (types only, lowercased, whitespace collapsed) */
  argsNormalized: string;
  /** Raw arg text for error messages */
  argsRaw: string;
}

interface RevokeDef {
  file: string;
  name: string;
  argsNormalized: string;
  argsRaw: string;
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Extract bare argument types from a CREATE FUNCTION arg list. We strip
 * argument names + DEFAULTs because REVOKE/COMMENT only need types to match.
 *
 * "p_user_id uuid, p_email text DEFAULT NULL" → "uuid,text"
 */
function normaliseArgs(raw: string): string {
  // Strip SQL line comments first — inline `-- foo, bar` would otherwise
  // contribute its commas to the top-level split below.
  const noComments = raw
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  if (!noComments.trim()) return '';
  // Split on commas not inside parens (e.g. numeric(10,2))
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of noComments) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf);

  return parts
    .map((p) => {
      // Strip DEFAULT clause. Trim first so the `$` anchor works on a single
      // logical line (parts from multi-line CREATE args have a trailing \n
      // which would otherwise prevent `.*$` from matching past "DEFAULT").
      let s = p.trim().replace(/\s+DEFAULT\s+.*$/i, '').trim();
      // Strip OUT/INOUT/VARIADIC mode prefix
      s = s.replace(/^(OUT|INOUT|VARIADIC|IN)\s+/i, '');
      // Strip argument name: "p_email text" → "text". Heuristic: last whitespace-separated chunk
      // is the type. But types like "timestamp with time zone" have spaces — fall back to
      // first-word-is-name only if first word doesn't look like a SQL type.
      // Use trim() first so leading newlines (multi-line arg lists in CREATE FUNCTION)
      // don't yield a leading empty token.
      const tokens = s.trim().split(/\s+/);
      const SQL_TYPE_FIRST_TOKENS = new Set([
        'integer',
        'int',
        'int4',
        'bigint',
        'int8',
        'smallint',
        'int2',
        'numeric',
        'decimal',
        'real',
        'double',
        'text',
        'varchar',
        'char',
        'character',
        'uuid',
        'boolean',
        'bool',
        'bytea',
        'date',
        'time',
        'timestamp',
        'timestamptz',
        'interval',
        'json',
        'jsonb',
        'inet',
        'cidr',
        'macaddr',
        'oid',
        'tsvector',
        'tsquery',
      ]);
      if (tokens.length > 1 && !SQL_TYPE_FIRST_TOKENS.has(tokens[0].toLowerCase())) {
        // First token is the argument name; drop it.
        s = tokens.slice(1).join(' ');
      }
      // Collapse whitespace + lowercase + strip array bracket spaces
      return s.toLowerCase().replace(/\s+/g, ' ').replace(/\s*\[\s*\]/g, '[]').trim();
    })
    .join(',');
}

function balancedParen(sql: string, openIdx: number): number | null {
  let depth = 0;
  for (let i = openIdx; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

/**
 * Match CREATE [OR REPLACE] FUNCTION public.<name>( … ) and capture the arg
 * list with balanced-paren scanning (the regex can't handle nested parens
 * inside types like numeric(10,2)).
 */
function extractCreatedFunctions(sql: string, file: string): FunctionDef[] {
  const result: FunctionDef[] = [];
  // Accept both `CREATE FUNCTION public.foo(` and unqualified `CREATE FUNCTION foo(`.
  // Migrations execute with search_path containing public; an unqualified CREATE
  // lands there. Skip CREATEs in other named schemas (auth., graphql., etc).
  const header = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(\w+)\.)?(\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = header.exec(sql)) !== null) {
    const schema = m[1]?.toLowerCase();
    if (schema && schema !== 'public') continue;
    const openIdx = m.index + m[0].length - 1; // position of "("
    const closeIdx = balancedParen(sql, openIdx);
    if (closeIdx === null) continue;
    const argsRaw = sql.slice(openIdx + 1, closeIdx);
    result.push({
      file,
      name: m[2],
      argsNormalized: normaliseArgs(argsRaw),
      argsRaw,
    });
  }

  // `ALTER FUNCTION public.old(args) RENAME TO new` produces a function with
  // the same arg list under a new name — treat the RENAME target as a CREATE
  // for the purpose of matching subsequent REVOKEs.
  const renameHeader =
    /ALTER\s+FUNCTION\s+(?:(\w+)\.)?(\w+)\s*\(/gi;
  while ((m = renameHeader.exec(sql)) !== null) {
    const schema = m[1]?.toLowerCase();
    if (schema && schema !== 'public') continue;
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = balancedParen(sql, openIdx);
    if (closeIdx === null) continue;
    // Look for RENAME TO <new_name> after the closing paren
    const tail = sql.slice(closeIdx + 1, closeIdx + 200);
    const renameMatch = tail.match(/^\s*RENAME\s+TO\s+(\w+)/i);
    if (!renameMatch) continue;
    const argsRaw = sql.slice(openIdx + 1, closeIdx);
    result.push({
      file,
      name: renameMatch[1],
      argsNormalized: normaliseArgs(argsRaw),
      argsRaw,
    });
  }
  return result;
}

function extractRevokes(sql: string, file: string): RevokeDef[] {
  const result: RevokeDef[] = [];
  // REVOKE [ALL [PRIVILEGES]] [EXECUTE] ON FUNCTION public.<name>( … ) FROM …
  const header = /REVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+public\.(\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = header.exec(sql)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = balancedParen(sql, openIdx);
    if (closeIdx === null) continue;
    const argsRaw = sql.slice(openIdx + 1, closeIdx);
    result.push({
      file,
      name: m[1],
      argsNormalized: normaliseArgs(argsRaw),
      argsRaw,
    });
  }

  // Also accept the no-args form `REVOKE ALL ON FUNCTION public.foo FROM …`
  // (no parens — applies to every overload of foo).
  const noArgs =
    /REVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+public\.(\w+)\s+FROM\b/gi;
  while ((m = noArgs.exec(sql)) !== null) {
    result.push({ file, name: m[1], argsNormalized: '*', argsRaw: '<no-args form>' });
  }
  return result;
}

describe('Admin RPCs in public must have explicit REVOKE EXECUTE', () => {
  const files = listMigrationFiles();
  const allCreated: FunctionDef[] = [];
  const allRevoked: RevokeDef[] = [];

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    allCreated.push(...extractCreatedFunctions(sql, file));
    allRevoked.push(...extractRevokes(sql, file));
  }

  it('parses migration SQL into at least one CREATE FUNCTION', () => {
    expect(allCreated.length).toBeGreaterThan(0);
  });

  it('every admin-pattern CREATE FUNCTION has a matching REVOKE on its current signature', () => {
    // For each function name + signature pair that matches an admin pattern,
    // require a REVOKE that either matches the exact signature OR uses the
    // no-args overload-everything form. Functions defined in migrations at or
    // before CATCH_ALL_REVOKE_TIMESTAMP are covered by the DO-block REVOKE in
    // 20260302000000 and don't need an inline REVOKE.
    const adminCreates = allCreated.filter(
      (fn) => ADMIN_PATTERNS.some((p) => p.test(fn.name)) && !EXEMPT[fn.name],
    );

    // For overload-everything REVOKEs (no-args form), record covered names.
    const blanketRevokes = new Set(
      allRevoked.filter((r) => r.argsNormalized === '*').map((r) => r.name),
    );

    // Latest CREATE wins for each (name, args) pair — earlier definitions may
    // have been DROP'd. We assert against the LAST occurrence per pair.
    const dedupCreates = new Map<string, FunctionDef>();
    for (const fn of adminCreates) {
      dedupCreates.set(`${fn.name}(${fn.argsNormalized})`, fn);
    }

    const missing: string[] = [];

    for (const fn of dedupCreates.values()) {
      const ts = migrationTimestamp(fn.file);
      if (ts && ts < CATCH_ALL_REVOKE_TIMESTAMP) continue;
      if (blanketRevokes.has(fn.name)) continue;
      const matched = allRevoked.find(
        (r) => r.name === fn.name && r.argsNormalized === fn.argsNormalized,
      );
      if (!matched) {
        missing.push(
          `  public.${fn.name}(${fn.argsRaw.trim()})  defined in ${fn.file}`,
        );
      }
    }

    expect(
      missing,
      `Admin-pattern functions missing matching REVOKE EXECUTE:\n${missing.join('\n')}\n\n` +
      `Either add REVOKE EXECUTE ON FUNCTION public.<name>(<args>) FROM anon, authenticated, PUBLIC; ` +
      `to the same migration that defines the function, OR add the function to the EXEMPT map in ` +
      `this test with a justification.\n\n` +
      `Note: when a DROP FUNCTION + CREATE FUNCTION changes the signature, any pre-existing REVOKE ` +
      `attached to the OLD signature is silently invalidated.`,
    ).toEqual([]);
  });

  it('every REVOKE EXECUTE in migrations resolves to an existing CREATE FUNCTION', () => {
    // Catches the reverse drift: a REVOKE that no longer matches anything
    // (because the function was DROP'd or its signature changed). Stale
    // REVOKEs are silent failures — Postgres raises ERROR at migration time
    // for an unknown signature, so anything in here means migrations would
    // have actually failed. The catch-all DO-block in 20260302000000 emits
    // REVOKEs for whatever exists at that point, so an orphan there usually
    // means the original CREATE was later DROP'd or rewritten with a new
    // signature, leaving the explicit REVOKE in this static file dangling.
    //
    // Allowed exception: blanket REVOKE (no-args form) on the function NAME
    // — Postgres errors if the name has more than one overload, but if there
    // is only one signature in DB the blanket form is just shorthand.
    const blanketCreates = new Set(allCreated.map((c) => c.name));
    const orphans: string[] = [];

    for (const r of allRevoked) {
      if (r.argsNormalized === '*') {
        if (!blanketCreates.has(r.name)) {
          orphans.push(`  ${r.file}: public.${r.name} (blanket REVOKE, no matching CREATE)`);
        }
        continue;
      }
      const matched = allCreated.find(
        (c) => c.name === r.name && c.argsNormalized === r.argsNormalized,
      );
      if (!matched) {
        orphans.push(`  ${r.file}: public.${r.name}(${r.argsRaw.trim()})`);
      }
    }

    expect(
      orphans,
      `REVOKE EXECUTE statements with no matching CREATE FUNCTION:\n${orphans.join('\n')}\n\n` +
      `These would actually ERROR at migration time when the named signature does not exist.\n` +
      `Either remove the stale REVOKE or update its signature to match the current CREATE.`,
    ).toEqual([]);
  });
});
