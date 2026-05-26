// Guards against ALL_SCOPES (TS) drifting from the api_keys.scopes SQL DEFAULT.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_SCOPES } from '@/lib/api/scope-constants';

const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../../../../supabase/migrations/20260525140000_expand_api_key_wildcard_scopes.sql',
);

function extractScopesFromMigration(sql: string): string[] {
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
