import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

// The ledger columns + the prefix CRL live in a SEPARATE migration from 20260612120000
// (which already shipped), because migrations are applied once by name — see the file header.
const migrations = resolve(process.cwd(), '../supabase/migrations');
const sql = readFileSync(resolve(migrations, '20260616120000_license_ledger_and_crl_prefix.sql'), 'utf8');
const originalCrl = readFileSync(resolve(migrations, '20260612120000_license_revocation_crl.sql'), 'utf8');

describe('issued license ledger migration', () => {
  it('adds a constrained issuance source without a destructive rewrite', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS issuance_source TEXT NOT NULL DEFAULT 'purchase'/);
    expect(sql).toMatch(/CHECK \(issuance_source IN \('purchase', 'manual'\)\)/);
  });

  it('stores the normalized public domain separately from the bearer token', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS license_domain TEXT/);
    expect(sql).toMatch(/idx_issued_licenses_domain/);
  });

  it('hardens the CRL to a service-role-only prefix range query', () => {
    expect(sql).toMatch(/seller_revoked_orders\(seller UUID, hash_prefix TEXT\)/);
    expect(sql).toMatch(/hash_prefix ~ '\^\[0-9a-f\]\{1,64\}\$'/); // wildcard guard
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.seller_revoked_orders\(UUID, TEXT\) TO service_role/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.seller_revoked_orders\(UUID, TEXT\) FROM PUBLIC, anon, authenticated/);
  });

  it('publishes the order hash as lowercase hex SHA-256 (cross-repo CRL contract)', () => {
    // CONTRACT: offline consumers (PostStack/ReplyStack `src/lib/license/revocation.ts`) hash the
    // token's `order` claim with SHA-256 → lowercase hex and match it against this list. Changing
    // this expression silently breaks their revocation (fail-open) — they keep honouring a revoked
    // token. Pinned on BOTH sides: the consumer pins the byte value of SHA-256('cs_test_123') =
    // 9ee7e06645426cb1d3597dc641a1410e77e88a1d423b4e802948e427189f2df1; this side pins the SQL that
    // must produce exactly that. A drift on either side turns the test red on the side that drifted.
    expect(sql).toContain("encode(extensions.digest(convert_to(l.order_id, 'UTF8'), 'sha256'), 'hex')");
  });

  it('does NOT mutate the already-shipped 20260612120000 migration (immutability)', () => {
    expect(originalCrl).not.toMatch(/hash_prefix/);
    expect(originalCrl).not.toMatch(/ADD COLUMN/);
    expect(originalCrl).toMatch(/seller_revoked_orders\(seller UUID\)/); // original single-arg signature
  });
});
