/**
 * Guards against scope-list drift between the TS source of truth
 * (`ALL_SCOPES`) and the hardcoded SQL literal that backs the
 * `api_keys.scopes` column DEFAULT. The migration sits outside the TS
 * build so a stale DEFAULT would silently grant fewer scopes to rows
 * inserted via raw SQL — this test fails CI before that can ship.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_SCOPES } from '@/lib/api/scope-constants';

const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../../../../supabase/migrations/20260525140000_expand_api_key_wildcard_scopes.sql',
);

function extractScopesFromMigration(sql: string): string[] {
  // Pull every quoted scope literal inside the DEFAULT clause that uses
  // jsonb_build_array(...). The migration is the only one in scope today;
  // future migrations that change the DEFAULT should update this test too.
  const defaultMatch = sql.match(/SET DEFAULT jsonb_build_array\(([\s\S]+?)\)/);
  if (!defaultMatch) throw new Error('jsonb_build_array DEFAULT not found in migration');
  return Array.from(defaultMatch[1].matchAll(/'([^']+)'/g), (m) => m[1]);
}

describe('scope-constants parity with migration', () => {
  const migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
  const migrationScopes = extractScopesFromMigration(migrationSql);

  it('migration DEFAULT lists every concrete scope from ALL_SCOPES', () => {
    expect(new Set(migrationScopes)).toEqual(new Set(ALL_SCOPES));
  });

  it('migration DEFAULT has no duplicates', () => {
    expect(migrationScopes.length).toBe(new Set(migrationScopes).size);
  });
});
