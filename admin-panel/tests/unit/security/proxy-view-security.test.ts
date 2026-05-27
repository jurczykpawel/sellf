/**
 * ============================================================================
 * SECURITY TEST: Proxy View Security — Area 1 of Security Audit
 * ============================================================================
 *
 * All ~34 proxy views in `public` forward queries to `public` tables.
 * If a view is missing `security_invoker = on`, it runs as the view owner
 * (postgres) and BYPASSES RLS — any anon user can read all data.
 *
 * This test statically verifies every CREATE VIEW in migration files:
 *   1. Every public.* → public.* proxy view uses `security_invoker = on`
 *   2. No proxy view uses `SECURITY DEFINER` (functions, not views — but guarded)
 *   3. Internal public views also use `security_invoker = on` where present
 *
 * Static analysis: no live DB required, runs in CI.
 *
 * @see supabase/migrations/ — all view definitions
 * @see AREA 1 in priv/SECURITY-AUDIT-PROMPT.md
 * ============================================================================
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');

interface ViewDef {
  file: string;
  line: number;
  schema: string;
  name: string;
  /** Raw CREATE VIEW statement (single line) */
  statement: string;
}

function getMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

/**
 * Extract all CREATE [OR REPLACE] VIEW statements from SQL.
 * Only captures views in `public` or `public` schemas.
 */
function extractViews(sql: string, filename: string): ViewDef[] {

  const views: ViewDef[] = [];
  const lines = sql.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: CREATE [OR REPLACE] VIEW <schema>.<name> ...
    const m = line.match(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(public|public)\.([\w]+)/i);
    if (m) {
      views.push({
        file: filename,
        line: i + 1,
        schema: m[1].toLowerCase(),
        name: m[2],
        statement: line,
      });
    }
  }

  return views;
}

describe('Proxy View Security (Area 1)', () => {
  const migrationFiles = getMigrationFiles();

  it('migration files exist', () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
  });

  // After the seller_main → public unification, every view in public targets
  // public — the original "is it a proxy?" heuristic (statement contains
  // "public.") matches every view trivially. We keep the security_invoker
  // requirement as defense-in-depth for views that COULD bypass RLS, but
  // whitelist views that intentionally run as definer because they expose a
  // narrowed projection over a table that is REVOKE'd from anon (the view IS
  // the access boundary). Each entry below is the documented reason.
  const DEFINER_VIEW_ALLOWLIST: Record<string, string> = {
    omnibus_price_history:
      'Narrowed projection over public.product_price_history (REVOKE\'d from anon). ' +
      'View must run as definer so anon can read the active+listed subset without raw table access. ' +
      'See: 20260429100000_narrow_price_history_public_view.sql',
  };

  it('every public view either uses security_invoker = on OR is in the documented definer allowlist', () => {
    const violations: string[] = [];

    for (const filename of migrationFiles) {
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
      const views = extractViews(sql, filename);

      for (const view of views) {
        if (view.schema !== 'public') continue;

        const hasSI = /WITH\s*\(\s*security_invoker\s*=\s*on\s*\)/i.test(view.statement);
        if (!hasSI && !(view.name in DEFINER_VIEW_ALLOWLIST)) {
          violations.push(
            `  ${view.file}:${view.line}  public.${view.name}  — missing (security_invoker = on)`
          );
        }
      }
    }

    expect(
      violations,
      `Public views missing security_invoker:\n${violations.join('\n')}\n\n` +
      `Without security_invoker = on, the view runs as its owner (postgres) ` +
      `and bypasses RLS — anon users can read all data.\n` +
      `Fix: CREATE OR REPLACE VIEW public.foo WITH (security_invoker = on) AS SELECT * FROM public.foo;\n` +
      `If a definer view is intentional (e.g. narrowed projection over a REVOKE'd table), ` +
      `add it to DEFINER_VIEW_ALLOWLIST in this test with a justification.`
    ).toHaveLength(0);
  });

  it('no proxy view definition uses SECURITY DEFINER (functions only, not views)', () => {
    // Views don't support SECURITY DEFINER directly but this guards against
    // future copy-paste of a function definition into a view block.
    const violations: string[] = [];

    for (const filename of migrationFiles) {
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
      const lines = sql.split('\n');

      // Look for a SECURITY DEFINER that appears right after a CREATE VIEW
      let inViewBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(public|public)\./i.test(line)) {
          inViewBlock = true;
        }
        // A new statement (non-indented) or semicolon closes the view block
        if (inViewBlock && /^\w/.test(line) && !/^CREATE/i.test(line) && !/^\s*$/.test(line)) {
          inViewBlock = false;
        }
        if (inViewBlock && /SECURITY\s+DEFINER/i.test(line)) {
          violations.push(`  ${filename}:${i + 1}  — SECURITY DEFINER in view context`);
        }
      }
    }

    expect(violations).toHaveLength(0);
  });

  it('proxy views in public schema are idempotent (OR REPLACE or preceded by DROP)', () => {
    // Ensures views can be re-applied without errors on schema reset.
    // Acceptable patterns:
    //   1. CREATE OR REPLACE VIEW ...
    //   2. DROP VIEW IF EXISTS ...; CREATE VIEW ...  (DROP on line immediately before)
    const violations: string[] = [];

    for (const filename of migrationFiles) {
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
      const lines = sql.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match CREATE VIEW (without OR REPLACE) in public/public
        if (
          /^\s*CREATE\s+VIEW\s+(public|public)\./i.test(line) &&
          !/CREATE\s+OR\s+REPLACE/i.test(line)
        ) {
          // Check if preceded by DROP VIEW IF EXISTS on a nearby line (within 3 lines)
          const precedingLines = lines.slice(Math.max(0, i - 3), i).join('\n');
          const hasDropBefore = /DROP\s+VIEW\s+IF\s+EXISTS/i.test(precedingLines);
          if (!hasDropBefore) {
            violations.push(`  ${filename}:${i + 1}  — CREATE VIEW without OR REPLACE and no preceding DROP`);
          }
        }
      }
    }

    expect(
      violations,
      `Views not idempotent (missing OR REPLACE and no DROP IF EXISTS before):\n${violations.join('\n')}`
    ).toHaveLength(0);
  });
});
