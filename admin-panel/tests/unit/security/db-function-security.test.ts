/**
 * ============================================================================
 * SECURITY TEST: Database Function Security Invariants
 * ============================================================================
 *
 * Statically analyses migration SQL files to verify that every
 * SECURITY DEFINER function has `SET search_path` configured.
 *
 * Without `SET search_path = ''` (or an explicit schema list), a SECURITY
 * DEFINER function is vulnerable to search_path hijacking: an attacker who
 * can create objects in any schema on the default search_path can shadow
 * trusted functions/tables and escalate privileges.
 *
 * This test is intentionally static (no live DB required) so it runs in CI
 * without a Supabase instance and catches regressions at commit time.
 *
 * Run with: bun run test:unit
 * ============================================================================
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');

interface FunctionDef {
  file: string;
  name: string;
  /** The full CREATE FUNCTION … END; block */
  body: string;
}

/**
 * Extract all SECURITY DEFINER function definitions from a SQL string.
 * Returns each function's name and full body.
 */
function extractSecurityDefinerFunctions(sql: string, filename: string): FunctionDef[] {
  const results: FunctionDef[] = [];

  // Match: CREATE [OR REPLACE] FUNCTION <name>(...) ... SECURITY DEFINER ... END; $$ ...
  // We capture from CREATE FUNCTION up to the closing $$ delimiter + LANGUAGE clause.
  // Strategy: find all SECURITY DEFINER occurrences, then walk back to find the function name.
  const createFnRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = createFnRe.exec(sql)) !== null) {
    const fnName = match[1];
    const startIdx = match.index;

    // Find the end of this function body (next $$ LANGUAGE ... ; after SECURITY DEFINER)
    // We look for the pattern: LANGUAGE plpgsql ... ; within reasonable distance
    const snippet = sql.slice(startIdx, startIdx + 8000);

    if (/SECURITY\s+DEFINER/i.test(snippet)) {
      results.push({ file: filename, name: fnName, body: snippet });
    }
  }

  return results;
}

/**
 * Returns true if the function body contains a SET search_path directive,
 * either inline (`SET search_path = ...`) or as a separate statement after
 * the function definition (`ALTER FUNCTION ... SET search_path`).
 *
 * We check for both forms:
 *   1. Inline:   $$ LANGUAGE plpgsql SECURITY DEFINER\n   SET search_path = ...
 *   2. Post-def: ALTER FUNCTION foo() SET search_path TO ...
 */
function hasSearchPath(fnDef: FunctionDef, fullSql: string): boolean {
  // 1. Inline SET search_path in the function definition body
  if (/SET\s+search_path\s*[=\s]/i.test(fnDef.body)) {
    return true;
  }

  // 2. Separate ALTER FUNCTION ... SET search_path statement in the same file
  //    (some older patterns set it this way)
  const alterRe = new RegExp(
    `ALTER\\s+FUNCTION\\s+${fnDef.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\([^)]*\\)\\s+SET\\s+search_path`,
    'i'
  );
  if (alterRe.test(fullSql)) {
    return true;
  }

  return false;
}

describe('SECURITY DEFINER functions must have SET search_path', () => {
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  it('migration files exist', () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
  });

  it('no SECURITY DEFINER function is missing SET search_path', () => {
    const violations: string[] = [];

    for (const filename of migrationFiles) {
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
      const fns = extractSecurityDefinerFunctions(sql, filename);

      for (const fn of fns) {
        if (!hasSearchPath(fn, sql)) {
          violations.push(`  ${fn.file}: ${fn.name}`);
        }
      }
    }

    expect(
      violations,
      `Found SECURITY DEFINER functions missing SET search_path:\n${violations.join('\n')}\n\n` +
      `Fix: add  SET search_path = ''  (or explicit schema list) after SECURITY DEFINER.`
    ).toHaveLength(0);
  });
});
