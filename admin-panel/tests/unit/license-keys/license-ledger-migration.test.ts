import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(process.cwd(), '../supabase/migrations/20260612120000_license_revocation_crl.sql'), 'utf8');

describe('issued license ledger migration', () => {
  it('adds a constrained issuance source without a destructive rewrite', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS issuance_source TEXT NOT NULL DEFAULT 'purchase'/);
    expect(sql).toMatch(/CHECK \(issuance_source IN \('purchase', 'manual'\)\)/);
  });

  it('stores the normalized public domain separately from the bearer token', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS license_domain TEXT/);
    expect(sql).toMatch(/idx_issued_licenses_domain/);
  });
});
