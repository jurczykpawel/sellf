/**
 * license.updated reports changes to an issued license, including expiry deadlines.
 * Any new code that changes issued_licenses besides issuance, revocation/restoration and the
 * expiry marker must emit license.updated, or this guard fails.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '../../../..');
// Functions whose changes already have their own event: license.revoked / license.restored / license.expired.
const ALLOWED_SQL = new Set(['revoke_issued_licenses', 'apply_payment_dispute', 'capture_expired_licenses']);

function latestSqlFunctions(): Map<string, string> {
  const dir = path.join(repo, 'supabase/migrations');
  const latest = new Map<string, string>();
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(path.join(dir, file), 'utf8');
    for (const m of sql.matchAll(/CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/gi)) {
      latest.set(m[1], m[4]);
    }
  }
  return latest;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .filter((f): f is string => typeof f === 'string' && /\.tsx?$/.test(f))
    .map(f => path.join(dir, f));
}

it('every SQL function that changes an issued license emits a license event', () => {
  const offenders = [...latestSqlFunctions()]
    .filter(([name, body]) => /UPDATE\s+public\.issued_licenses/i.test(body) && !ALLOWED_SQL.has(name) && !body.includes('license.updated'))
    .map(([name]) => name);
  expect(offenders).toEqual([]);
});

it('application code changes issued_licenses only through issuance or emits license.updated', () => {
  const offenders = sourceFiles(path.join(repo, 'admin-panel/src')).filter(file => {
    const text = readFileSync(file, 'utf8');
    return /from\(['"]issued_licenses['"]\)\s*\.(update|upsert)\(/.test(text.replace(/\s+/g, ' ').replace(/\)\s+\./g, ').'))
      && !text.includes("'license.updated'");
  });
  expect(offenders.map(f => path.relative(repo, f))).toEqual([]);
});

it('detects an unannounced change', () => {
  const body = 'BEGIN UPDATE public.issued_licenses SET expires_at=now(); END';
  expect(/UPDATE\s+public\.issued_licenses/i.test(body) && !body.includes('license.updated')).toBe(true);
  expect(/from\(['"]issued_licenses['"]\)\s*\.(update|upsert)\(/.test("db.from('issued_licenses').update({ tier })")).toBe(true);
});
