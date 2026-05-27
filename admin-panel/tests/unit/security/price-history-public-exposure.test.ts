/**
 * Static SQL grep coverage for the public Omnibus price-history surface:
 * verifies the migration defines public.omnibus_price_history with the
 * expected projection + filters, and locks the underlying table down to
 * service_role.
 *
 * Live end-to-end coverage lives in
 * `price-history-runtime.integration.test.ts`.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');

function getAllMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf-8'))
    .join('\n');
}

describe('Narrowed public price-history view', () => {
  const allSql = getAllMigrationSql();

  it('defines public.omnibus_price_history with the safe-column projection', () => {
    const matches = [...allSql.matchAll(
      /CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.omnibus_price_history\b[^;]*;/gi
    )];
    expect(matches.length).toBeGreaterThanOrEqual(1);
    const lastView = matches[matches.length - 1][0].toLowerCase();

    // Exposed columns
    expect(lastView).toMatch(/product_id/);
    expect(lastView).toMatch(/\bprice\b/);
    expect(lastView).toMatch(/sale_price/);
    expect(lastView).toMatch(/currency/);
    expect(lastView).toMatch(/effective_from/);

    // Internal columns must not appear
    expect(lastView).not.toMatch(/changed_by/);
    expect(lastView).not.toMatch(/change_reason/);
    expect(lastView).not.toMatch(/vat_rate/);
    expect(lastView).not.toMatch(/price_includes_vat/);
    expect(lastView).not.toMatch(/effective_until/);

    // Explicit projection — no SELECT *
    expect(lastView).not.toMatch(/select\s+\*/);
  });

  it('filters the public view to active + listed products', () => {
    const matches = [...allSql.matchAll(
      /CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.omnibus_price_history\b[^;]*;/gi
    )];
    const lastView = matches[matches.length - 1][0].toLowerCase();
    expect(lastView).toMatch(/products/);
    expect(lastView).toMatch(/is_active\s*=\s*true/);
    expect(lastView).toMatch(/is_listed\s*=\s*true/);
  });

  // Pre-unification there was a public.product_price_history proxy view over
  // seller_main.product_price_history that had to be dropped before the narrowed
  // omnibus_price_history view was created. After the seller_main → public
  // unification the proxy never existed (the table is in public directly), so
  // there is nothing to DROP. The REVOKE in the next test still applies — that
  // is what actually keeps the raw table off the public REST API.

  it('revokes anon/authenticated SELECT on raw public.product_price_history', () => {
    expect(allSql).toMatch(
      /REVOKE\s+SELECT\s+ON\s+public\.product_price_history\s+FROM\s+anon\s*,\s*authenticated/i
    );
  });

  it('grants SELECT on the narrowed public view to anon/authenticated', () => {
    const grantMatches = [...allSql.matchAll(
      /GRANT\s+SELECT\s+ON\s+public\.omnibus_price_history\s+TO\s+([^;]+);/gi
    )];
    expect(grantMatches.length).toBeGreaterThanOrEqual(1);
    const lastGrant = grantMatches[grantMatches.length - 1][0].toLowerCase();
    expect(lastGrant).toMatch(/anon/);
    expect(lastGrant).toMatch(/authenticated/);
  });

  it('explicitly revokes ALL on the narrowed public view before granting SELECT (no default INSERT/UPDATE/DELETE)', () => {
    // Public-schema relations inherit broad default privileges in this app
    // via `ALTER DEFAULT PRIVILEGES`. Lock the view down to SELECT-only
    // explicitly so a future default-grants change cannot widen the surface.
    expect(allSql).toMatch(
      /REVOKE\s+ALL\s+ON\s+public\.omnibus_price_history\s+FROM\s+(?=[^;]*\banon\b)(?=[^;]*\bauthenticated\b)/i,
    );
  });
});
