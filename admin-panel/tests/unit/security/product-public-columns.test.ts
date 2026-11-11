import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

import { PRODUCT_PAGE_FIELDS } from '@/lib/constants';
import { PRODUCT_PUBLIC_COLUMNS } from '@/lib/product-columns';
import { readMigrationSource } from '../../../scripts/migration-source';

const MIGRATION = join(
  __dirname,
  '../../../../supabase/migrations/20260924000000_access_scope_tightening.sql',
);

function grantedProductColumns(): string[] {
  const sql = readFileSync(MIGRATION, 'utf-8');
  const match = sql.match(/GRANT SELECT \(([^)]+)\) ON public\.products TO anon, authenticated/);
  if (!match) throw new Error('products column grant not found');
  const phase1 = readMigrationSource('20261016000000_release_2026_10_6.sql');
  const profiles = readMigrationSource('20261023001721_checkout_profiles.sql');
  const events = readMigrationSource('20261023080000_event_reservations.sql');
  const additions = [...(phase1 + profiles + events).matchAll(/GRANT SELECT \(([^)]+)\) ON public\.products TO anon, authenticated/g)].flatMap(m => m[1].split(','));
  return [...match[1].split(','), ...additions].map(c => c.trim()).filter(Boolean);
}

describe('products public columns', () => {
  it('matches the column-level grant in the migration', () => {
    expect([...grantedProductColumns()].sort()).toEqual([...PRODUCT_PUBLIC_COLUMNS].sort());
  });

  it('keeps delivered content out of the public set', () => {
    expect(PRODUCT_PUBLIC_COLUMNS).not.toContain('content_config');
  });

  it('product page fields are all public columns', () => {
    const fields = PRODUCT_PAGE_FIELDS.split(',').map((f) => f.trim());
    const publicSet = new Set<string>(PRODUCT_PUBLIC_COLUMNS);
    expect(fields.filter((f) => !publicSet.has(f))).toEqual([]);
  });
});
