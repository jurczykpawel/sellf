/**
 * ============================================================================
 * SECURITY TEST: Input Validation — Area 10
 * ============================================================================
 *
 * Verifies that every API route that parses a request body (request.json())
 * performs input validation before using that data.
 *
 * STRATEGY — Static source analysis:
 *   1. Find every route.ts that calls request.json().
 *   2. Verify at least one validation pattern is present in the same file.
 *   3. Verify no route passes raw user input directly to dangerous sinks
 *      without type checks (eval, dynamic SQL, shell exec, etc.).
 *   4. Verify that unstructured "filter bags" (like export filters) use
 *      safe parameterized queries, not string interpolation.
 *
 * ACCEPTABLE VALIDATION PATTERNS:
 *   - Zod: .parse() / .safeParse()
 *   - Manual type guards: typeof x !== 'string', !x, Array.isArray()
 *   - Regex validation: /pattern/.test(x)
 *   - Allowlist checks: ['a','b'].includes(x)
 *   - parseInt / Number() followed by isNaN/isFinite
 *   - Field presence checks: !body.field
 *
 * @see AREA 10 in priv/SECURITY-AUDIT-PROMPT.md
 * ============================================================================
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const API_DIR = join(__dirname, '../../../src/app/api');

// ============================================================================
// Helpers
// ============================================================================

function findRoutes(dir: string, base = dir): Array<{ rel: string; source: string }> {
  const results: Array<{ rel: string; source: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRoutes(full, base));
    } else if (entry.name === 'route.ts') {
      results.push({
        rel: full.replace(base + '/', ''),
        source: readFileSync(full, 'utf-8'),
      });
    }
  }
  return results;
}

const allRoutes = findRoutes(API_DIR);

/** Routes that call request.json() */
const bodyParsingRoutes = allRoutes.filter(r => /request\.json\(\)/.test(r.source));

/**
 * Returns true when the source shows at least one validation pattern
 * applied to parsed body data.
 */
function hasBodyValidation(source: string): boolean {
  return (
    // Zod
    /\.parse\s*\(/.test(source) ||
    /\.safeParse\s*\(/.test(source) ||
    // Named validate* function calls (e.g. validateAccessCheck, validateRequest, validateNIPChecksum, validateUUID)
    /\bvalidate[A-Z]\w*\s*\(/.test(source) ||
    /\.validateRequest\s*\(/.test(source) ||
    // Manual type guards
    /typeof\s+\w+\s*!==?\s*['"`]/.test(source) ||
    /typeof\s+\w+\s*===?\s*['"`]/.test(source) ||
    /!\s*(?:body|data|filters|params|input)\s*\./.test(source) ||
    /Array\.isArray\s*\(/.test(source) ||
    // Presence / length checks (e.g. !email, !productId, !endpointId)
    /if\s*\(\s*!\w+\b/.test(source) ||
    // Regex validation
    /\/\^.*\$\/[gimu]*\.test\s*\(/.test(source) ||
    // Allowlist enum check
    /\[['"`][a-z]+['"`].*\]\.includes\s*\(/.test(source) ||
    // parseInt / Number with validation
    /parseInt\s*\(/.test(source) ||
    /Number\s*\(/.test(source) ||
    // Explicit validation block
    /Validate\s+required|validate\s+required|Missing required/i.test(source) ||
    // TypeScript typed cast (route accepts typed body: Type = await request.json())
    /:\s*(?:Partial<|Required<)?\w+(?:FormData|Request|Body|Input|Config)\s*=\s*await\s+request\.json/.test(source) ||
    // Undefined-check conditionals on body fields
    /!== undefined/.test(source) ||
    // Content-type validation before JSON parse
    /content.?type.*application\/json/.test(source)
  );
}

/**
 * Returns true when the source contains a dangerous sink pattern:
 * eval(), Function(), raw SQL string concatenation, shell exec, etc.
 */
function hasDangerousSink(source: string): boolean {
  return (
    /\beval\s*\(/.test(source) ||
    /new Function\s*\(/.test(source) ||
    // Direct SQL string concat with user input variables in template literal
    /`[^`]*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*\$\{(?:body|filters|params|input)\b[^}]*\}[^`]*`/.test(source) ||
    // Traditional string concatenation of SQL keywords with user input
    /['"`](?:SELECT|INSERT|UPDATE|DELETE)\b[^'"`]*['"`]\s*\+\s*(?:body|filters|params|input)\b/.test(source)
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Area 10: Input Validation — every request.json() route', () => {

  it('every route that parses request body applies input validation', () => {
    const violations: string[] = [];

    for (const route of bodyParsingRoutes) {
      if (!hasBodyValidation(route.source)) {
        violations.push(`  ${route.rel}`);
      }
    }

    expect(
      violations,
      `Routes that call request.json() but have no detectable input validation:\n` +
      violations.join('\n') + '\n\n' +
      `Every route parsing a request body must validate inputs using Zod, ` +
      `type guards, regex, allowlist checks, or explicit presence checks.\n` +
      `See Area 10 in priv/SECURITY-AUDIT-PROMPT.md`
    ).toHaveLength(0);
  });

  it('no route passes raw user input to dangerous sinks (eval, string-concat SQL)', () => {
    const violations: string[] = [];

    for (const route of bodyParsingRoutes) {
      if (hasDangerousSink(route.source)) {
        violations.push(`  ${route.rel}`);
      }
    }

    expect(
      violations,
      `Routes with dangerous sink usage (eval / string-concat SQL):\n` +
      violations.join('\n') + '\n\n' +
      `Never use eval(), new Function(), or concatenate user input into SQL strings.`
    ).toHaveLength(0);
  });

  it('filter-bag routes use parameterized query builder, not raw string interpolation', () => {
    // The export route passes request.json() as an arbitrary filter object.
    // Verify it uses the Supabase query builder (.eq, .gte etc.) not string SQL.
    const exportRoute = bodyParsingRoutes.find(r => r.rel === 'admin/payments/export/route.ts');
    expect(exportRoute, 'export route must exist').toBeDefined();

    if (exportRoute) {
      // Must use the query builder pattern
      expect(exportRoute.source).toMatch(/query\.eq\s*\(|query\.gte\s*\(|\.eq\s*\(\s*'status'|\.gte\s*\(\s*'created_at'/);
      // Must NOT use string template literals that include filter values in SQL
      const templateSqlPattern = /`[^`]*(SELECT|INSERT|UPDATE|DELETE)[^`]*\$\{[^}]*filter/i;
      expect(exportRoute.source).not.toMatch(templateSqlPattern);
    }
  });

  it('routes with action-based dispatch validate action against an allowlist', () => {
    // Routes that dispatch on an "action" field must check it against known values,
    // not execute arbitrary code based on it.
    const actionRoutes = bodyParsingRoutes.filter(r =>
      /\baction\b/.test(r.source) && /\['.*'\]\.includes\(action\)|action\s*===?\s*'|action\s*!==?\s*'/i.test(r.source)
    );

    for (const route of actionRoutes) {
      // Each route that has an action must have an allowlist or direct equality check
      const hasAllowlistOrEq = (
        /\[['"`][a-z_]+['"`].*\]\.includes\s*\(\s*action\s*\)/.test(route.source) ||
        /action\s*===\s*['"`][a-z_]+['"`]/.test(route.source) ||
        /action\s*!==\s*['"`][a-z_]+['"`]/.test(route.source)
      );
      expect(
        hasAllowlistOrEq,
        `${route.rel}: routes with "action" dispatch must validate against an allowlist`
      ).toBe(true);
    }
  });

  it('email fields are validated before use', () => {
    // All routes that extract an email from request body must validate its format.
    const emailBodyRoutes = bodyParsingRoutes.filter(r =>
      /(?:const|let)\s*\{[^}]*\bemail\b[^}]*\}\s*=\s*(?:await\s+)?request\.json\(\)|(?:const|let)\s*\{[^}]*\bemail\b[^}]*\}\s*=\s*(?:await\s+)?(?:body|data|req)/
        .test(r.source)
    );

    const violations: string[] = [];
    for (const route of emailBodyRoutes) {
      // Acceptable: regex test, typeof check, !email guard, named validateEmail fn, or Zod/parse
      const hasEmailValidation = (
        /emailRegex|email_regex|\/\^\[\\^\s@\]/i.test(route.source) ||
        /typeof\s+email\s*!==/.test(route.source) ||
        /!email\b/.test(route.source) ||
        /validateEmail\s*\(|isValidEmail\b/.test(route.source) ||
        /\.parse\s*\(|\.safeParse\s*\(/.test(route.source)
      );
      if (!hasEmailValidation) {
        violations.push(`  ${route.rel}`);
      }
    }

    expect(
      violations,
      `Routes that destructure email from request body but skip email validation:\n` +
      violations.join('\n') + '\n\n' +
      `Validate email with a regex, typeof check, or Zod schema.`
    ).toHaveLength(0);
  });

  it('body-parsing routes guard against malformed JSON (catch or .catch)', () => {
    // A route that crashes on malformed JSON leaks an unhandled 500 and may
    // reveal stack traces. All routes should have a try/catch wrapper.
    const violations: string[] = [];

    for (const route of bodyParsingRoutes) {
      const hasTryCatch = /try\s*\{/.test(route.source);
      const hasJsonCatch = /request\.json\(\)\.catch/.test(route.source);
      if (!hasTryCatch && !hasJsonCatch) {
        violations.push(`  ${route.rel}`);
      }
    }

    expect(
      violations,
      `Routes that parse request.json() without a try/catch wrapper:\n` +
      violations.join('\n') + '\n\n' +
      `Wrap request handlers in try/catch to prevent unhandled 500s on malformed JSON.`
    ).toHaveLength(0);
  });
});
