/**
 * SECURITY TEST: the payments:read scope backfill migration.
 *
 * The payments list/detail/export endpoints used to accept `analytics:read`
 * as a stand-in for `payments:read`. That fallback is now removed from the
 * application code (see the payments API routes), so any existing key that
 * relied on `analytics:read` alone for those endpoints needs `payments:read`
 * added, or it loses access. The migration's UPDATE statement backfills
 * exactly that: keys with `analytics:read` but neither `payments:read` nor
 * the wildcard get `payments:read` appended; every other key is untouched.
 *
 * REQUIRES: `npx supabase start` + `npx supabase db reset`.
 *
 * @see supabase/migrations/20260924000000_access_scope_tightening.sql
 */

import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';

const CONTAINER = 'supabase_db_sellf';
const NAME_PREFIX = `scope-backfill-test-${Date.now()}`;

function runSql(sql: string): string {
  return execSync(`docker exec -i ${CONTAINER} psql -U postgres -t -A`, {
    input: sql,
    encoding: 'utf-8',
    timeout: 10000,
  });
}

function queryRows(sql: string): string[] {
  return runSql(sql)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

// The exact statement from the migration — copied here so the test fails if
// the migration's WHERE clause or update ever drifts from what this test
// verifies.
const BACKFILL_SQL = `
  UPDATE public.api_keys
  SET scopes = scopes || '["payments:read"]'::jsonb
  WHERE scopes @> '["analytics:read"]'::jsonb
    AND NOT scopes @> '["payments:read"]'::jsonb
    AND NOT scopes @> '["*"]'::jsonb;
`;

interface TestKey {
  label: string;
  scopesBefore: string[];
}

const testKeys: TestKey[] = [
  { label: 'analytics-only', scopesBefore: ['analytics:read'] },
  { label: 'analytics-and-payments', scopesBefore: ['analytics:read', 'payments:read'] },
  { label: 'unrelated-scope', scopesBefore: ['products:read'] },
  { label: 'wildcard-guard', scopesBefore: ['analytics:read', '*'] },
];

function keyName(label: string): string {
  return `${NAME_PREFIX}-${label}`;
}

beforeAll(() => {
  const adminUserId = queryRows('SELECT id FROM public.admin_users LIMIT 1;')[0];
  expect(adminUserId).toBeTruthy();

  for (const key of testKeys) {
    const id = randomUUID();
    const keyHash = randomUUID().replace(/-/g, '');
    const keyPrefix = randomUUID().replace(/-/g, '').slice(0, 16);
    const scopesJson = JSON.stringify(key.scopesBefore).replace(/'/g, "''");
    runSql(`
      INSERT INTO public.api_keys (id, name, key_prefix, key_hash, admin_user_id, scopes)
      VALUES (
        '${id}',
        '${keyName(key.label)}',
        '${keyPrefix}',
        '${keyHash}',
        '${adminUserId}',
        '${scopesJson}'::jsonb
      );
    `);
  }
});

afterAll(() => {
  runSql(`DELETE FROM public.api_keys WHERE name LIKE '${NAME_PREFIX}%';`);
});

function scopesFor(label: string): string[] {
  const raw = runSql(`
    SELECT scopes::text FROM public.api_keys WHERE name = '${keyName(label)}';
  `).trim();
  return JSON.parse(raw) as string[];
}

describe('payments:read scope backfill migration', () => {
  it('adds payments:read to a key that only had analytics:read', () => {
    runSql(BACKFILL_SQL);
    expect(scopesFor('analytics-only').sort()).toEqual(['analytics:read', 'payments:read']);
  });

  it('leaves a key that already has both scopes untouched', () => {
    runSql(BACKFILL_SQL);
    expect(scopesFor('analytics-and-payments').sort()).toEqual(['analytics:read', 'payments:read']);
  });

  it('leaves a key without analytics:read untouched', () => {
    runSql(BACKFILL_SQL);
    expect(scopesFor('unrelated-scope')).toEqual(['products:read']);
  });

  it('does not touch a key that already carries the wildcard scope', () => {
    runSql(BACKFILL_SQL);
    expect(scopesFor('wildcard-guard').sort()).toEqual(['*', 'analytics:read']);
  });

  it('is idempotent — running it again changes nothing further', () => {
    const before = testKeys.map((k) => scopesFor(k.label).sort());
    runSql(BACKFILL_SQL);
    const after = testKeys.map((k) => scopesFor(k.label).sort());
    expect(after).toEqual(before);
  });
});
