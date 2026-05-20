import { describe, it, expect } from 'vitest';

import { lintSqlForMissingRevoke } from '@/../scripts/lint-migrations';

describe('lintSqlForMissingRevoke', () => {
  it('ignores plain CREATE OR REPLACE (grants preserved or covered by default privileges)', () => {
    const sql = `
      CREATE OR REPLACE FUNCTION seller_main.foo() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;
    `;
    expect(lintSqlForMissingRevoke('test.sql', sql)).toHaveLength(0);
  });

  it('flags DROP + CREATE in seller_main without REVOKE', () => {
    const sql = `
      DROP FUNCTION IF EXISTS seller_main.foo();
      CREATE OR REPLACE FUNCTION seller_main.foo() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;
    `;
    const missing = lintSqlForMissingRevoke('test.sql', sql);
    expect(missing.map((m) => m.qualified)).toEqual(['seller_main.foo']);
  });

  it('flags DROP + CREATE in public without REVOKE', () => {
    const sql = `
      DROP FUNCTION IF EXISTS public.bar(int);
      CREATE FUNCTION public.bar(p int) RETURNS int AS $$ SELECT $1 $$ LANGUAGE sql;
    `;
    const missing = lintSqlForMissingRevoke('test.sql', sql);
    expect(missing.map((m) => m.qualified)).toEqual(['public.bar']);
  });

  it('passes when DROP + CREATE has matching REVOKE', () => {
    const sql = `
      DROP FUNCTION IF EXISTS seller_main.foo();
      CREATE OR REPLACE FUNCTION seller_main.foo() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;
      REVOKE EXECUTE ON FUNCTION seller_main.foo() FROM PUBLIC, anon, authenticated;
    `;
    expect(lintSqlForMissingRevoke('test.sql', sql)).toHaveLength(0);
  });

  it('ignores DROP + CREATE in other schemas (e.g. auth)', () => {
    const sql = `
      DROP FUNCTION IF EXISTS auth.something();
      CREATE OR REPLACE FUNCTION auth.something() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;
    `;
    expect(lintSqlForMissingRevoke('test.sql', sql)).toHaveLength(0);
  });

  it('reports multiple DROP + CREATE definitions independently', () => {
    const sql = `
      DROP FUNCTION IF EXISTS seller_main.a();
      DROP FUNCTION IF EXISTS public.b();
      CREATE OR REPLACE FUNCTION seller_main.a() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;
      CREATE OR REPLACE FUNCTION public.b() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;
      REVOKE EXECUTE ON FUNCTION seller_main.a() FROM PUBLIC, anon, authenticated;
    `;
    const missing = lintSqlForMissingRevoke('test.sql', sql);
    expect(missing.map((m) => m.qualified)).toEqual(['public.b']);
  });
});
